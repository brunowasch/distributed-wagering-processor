import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { createHash } from 'node:crypto';
import { DatabaseUnitOfWork } from '../shared/infrastructure/database/database-unit-of-work.js';
import { MetricsService } from '../shared/infrastructure/observability/metrics.service.js';
import { IntegrationEvent, WalletBalanceChanged, WagerTransactionProcessed } from '../shared/domain/integration-events.js';
import { Money } from '../shared/domain/money.js';
import { OutboxRepository } from '../shared/infrastructure/messaging/outbox.repository.js';
import { WagerTransaction, WagerTransactionKind } from '../wagering/domain/wager-transaction.js';
import { WagerTransactionRepository } from '../wagering/wager-transaction.repository.js';
import { WalletLedgerDirection, WalletLedgerEntry } from './domain/wallet-ledger-entry.js';
import { Wallet } from './domain/wallet.js';
import { WalletLedgerEntryRepository } from './repositories/wallet-ledger-entry.repository.js';
import { WalletRepository } from './wallet.repository.js';

/** Resultado da comparação entre saldo materializado, ledger e transações processadas. */
export interface WalletReconciliationResult {
    /** Identifica a carteira verificada. */
    walletId: string;
    /** Saldo materializado atualmente armazenado na carteira. */
    storedBalance: Money;
    /** Saldo reconstruído pela soma cronológica dos lançamentos. */
    calculatedBalance: Money;
    /** Diferença entre o saldo armazenado e o reconstruído. */
    difference: Money;
    /** Só é verdadeiro quando saldo e conjunto de transações batem com o ledger. */
    consistent: boolean;
    /** Número de lançamentos examinados. */
    checkedEntries: number;
    /** Número de transações processadas comparadas com o ledger. */
    checkedTransactions: number;
}

/** Casos de uso de abertura, consulta e reconciliação da carteira. */
@Injectable()
export class WalletApplicationService {
    private readonly logger = new Logger(WalletApplicationService.name);
    /** Injeta repositórios e a unidade de trabalho usados nos casos de uso da carteira. */
    constructor(
        private readonly wallets: WalletRepository,
        private readonly ledger: WalletLedgerEntryRepository,
        private readonly transactions: WagerTransactionRepository,
        private readonly outbox: OutboxRepository,
        private readonly unitOfWork: DatabaseUnitOfWork,
        private readonly metrics: MetricsService,
    ) {}

    /** A abertura da wallet, transação OPENING, ledger e eventos formam um commit único. */
    async openWallet(props: { playerId: string; initialBalance: Money }): Promise<Wallet> {
        const wallet = Wallet.open({ playerId: props.playerId, initialBalance: props.initialBalance });
        try {
        await this.unitOfWork.execute(async (em) => {
            await this.wallets.create(wallet, em);
            await em.flush();

            if (props.initialBalance.isPositive()) {
                const transaction = WagerTransaction.create({
                    providerId: 'internal',
                    externalTransactionId: `opening-${wallet.id}`,
                    idempotencyKey: `opening:${wallet.id}`,
                    payloadHash: createHash('sha256').update(`${wallet.id}:${props.initialBalance.toJSON().amount}:${wallet.currency}`).digest('hex'),
                    walletId: wallet.id,
                    playerId: wallet.playerId,
                    roundId: 'wallet-opening',
                    gameId: 'internal',
                    kind: WagerTransactionKind.OPENING,
                    money: props.initialBalance,
                });
                transaction.markProcessed();
                await this.transactions.create(transaction, em, wallet.balance);
                await em.flush();

                const entry = WalletLedgerEntry.create({
                    walletId: wallet.id,
                    transactionId: transaction.id,
                    direction: WalletLedgerDirection.CREDIT,
                    money: props.initialBalance,
                    balanceBefore: Money.zero(wallet.currency),
                    balanceAfter: wallet.balance,
                });
                await this.ledger.create(entry, em);
                await this.enqueue(WagerTransactionProcessed.from(transaction, { correlationId: transaction.id }), em);
                await this.enqueue(WalletBalanceChanged.from(transaction, entry, wallet.version, { correlationId: transaction.id }), em);
                await em.flush();
            }
        });
        } catch (error) {
            if (error instanceof UniqueConstraintViolationException) {
                throw new ConflictException('A wallet already exists for this player and currency.');
            }
            throw error;
        }
        return wallet;
    }

    /** Busca uma carteira por ID ou lança NotFoundException. */
    async getWallet(walletId: string): Promise<Wallet> {
        const wallet = await this.wallets.findById(walletId);
        if (!wallet) throw new NotFoundException('Wallet not found.');
        return wallet;
    }

    /** Recalcula o saldo pelo ledger e verifica cobertura das transações sem corrigir histórico. */
    async reconcile(walletId: string): Promise<WalletReconciliationResult> {
        const result = await this.unitOfWork.execute(async (em) => {
            const wallet = await this.wallets.findByIdForUpdate(walletId, em);
            if (!wallet) throw new NotFoundException('Wallet not found.');

            const entries = await this.ledger.findAllByWalletId(walletId, em);
            const processedTransactions = await this.transactions.findProcessedByWalletId(walletId, em);
            let calculatedBalance = Money.zero(wallet.currency);
            for (const entry of entries) {
                calculatedBalance = entry.direction === WalletLedgerDirection.CREDIT
                    ? calculatedBalance.add(entry.money)
                    : calculatedBalance.subtract(entry.money);
            }

            const ledgerTransactionIds = new Set(entries.map(({ transactionId }) => transactionId));
            const processedById = new Map(processedTransactions.map((transaction) => [transaction.id, transaction]));
            const expectedLedgerTransactions = processedTransactions.filter((transaction) => transaction.affectsBalance());
            const expectedLedgerTransactionIds = new Set(expectedLedgerTransactions.map(({ id }) => id));
            const ledgerByTransactionId = new Map(entries.map((entry) => [entry.transactionId, entry]));
            let ledgerMatchesTransactions = ledgerTransactionIds.size === expectedLedgerTransactionIds.size
                && [...ledgerTransactionIds].every((id) => expectedLedgerTransactionIds.has(id));

            for (const transaction of expectedLedgerTransactions) {
                const entry = ledgerByTransactionId.get(transaction.id);
                let expectedDirection: WalletLedgerDirection | undefined;
                switch (transaction.kind) {
                    case WagerTransactionKind.OPENING:
                    case WagerTransactionKind.WIN:
                    case WagerTransactionKind.REFUND:
                        expectedDirection = WalletLedgerDirection.CREDIT;
                        break;
                    case WagerTransactionKind.BET:
                        expectedDirection = WalletLedgerDirection.DEBIT;
                        break;
                    case WagerTransactionKind.ROLLBACK: {
                        const reference = transaction.referenceTransactionId
                            ? processedById.get(transaction.referenceTransactionId)
                            : undefined;
                        expectedDirection = reference?.kind === WagerTransactionKind.BET
                            ? WalletLedgerDirection.CREDIT
                            : reference?.kind === WagerTransactionKind.WIN || reference?.kind === WagerTransactionKind.REFUND
                                ? WalletLedgerDirection.DEBIT
                                : undefined;
                        break;
                    }
                    case WagerTransactionKind.LOSS:
                        break;
                }

                if (!entry
                    || !expectedDirection
                    || entry.direction !== expectedDirection
                    || !entry.money.equals(transaction.money)
                    || entry.money.getCurrency() !== transaction.money.getCurrency()) {
                    ledgerMatchesTransactions = false;
                    break;
                }
            }

            return {
                walletId,
                storedBalance: wallet.balance,
                calculatedBalance,
                difference: wallet.balance.subtract(calculatedBalance),
                consistent: wallet.balance.equals(calculatedBalance) && ledgerMatchesTransactions,
                checkedEntries: entries.length,
                checkedTransactions: processedTransactions.length,
            };
        });
        if (!result.consistent) {
            this.metrics.increment('wallet_reconciliation_divergences_total');
            this.logger.error(JSON.stringify({
                event: 'wallet_reconciliation_divergence',
                walletId: result.walletId,
                checkedEntries: result.checkedEntries,
                checkedTransactions: result.checkedTransactions,
            }));
        }
        return result;
    }

    /** Registra um evento de integração na mesma transação SQL da alteração de carteira. */
    private async enqueue(event: IntegrationEvent<unknown>, em: EntityManager): Promise<void> {
        await this.outbox.enqueue({
            eventId: event.eventId,
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            payload: event.toJSON(),
            occurredAt: event.occurredAt,
        }, em);
    }
}
