import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { OptimisticLockError, UniqueConstraintViolationException } from '@mikro-orm/core';
import { DatabaseUnitOfWork } from '../shared/infrastructure/database/database-unit-of-work.js';
import { IntegrationEvent, WalletBalanceChanged, WagerTransactionPendingReference, WagerTransactionProcessed, WagerTransactionRejected } from '../shared/domain/integration-events.js';
import { OutboxRepository } from '../shared/infrastructure/messaging/outbox.repository.js';
import { MetricsService } from '../shared/infrastructure/observability/metrics.service.js';
import { Money } from '../shared/domain/money.js';
import { WalletLedgerEntry, WalletLedgerDirection } from '../wallet/domain/wallet-ledger-entry.js';
import { WalletRepository } from '../wallet/wallet.repository.js';
import { WalletLedgerEntryRepository } from '../wallet/repositories/wallet-ledger-entry.repository.js';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from './domain/wager-transaction.js';
import { WagerTransactionRepository } from './wager-transaction.repository.js';
import {
    isPermanentInfrastructureFailure,
    PermanentWageringProcessingError,
    PERMANENT_INFRASTRUCTURE_FAILURE,
} from './permanent-processing-failure.js';

/** Quantidade máxima de consultas persistidas antes de rejeitar referência ausente. */
const MAX_REFERENCE_ATTEMPTS = 12;

/** Dados de negócio necessários para processar uma operação recebida de um provedor. */
export interface ProcessWagerTransactionProps {
    /** Identidade do provedor que enviou a operação. */
    providerId: string;
    /** Identificador estável da operação no sistema do provedor. */
    externalTransactionId: string;
    /** Chave persistente usada para reconhecer replay e payload conflitante. */
    idempotencyKey: string;
    /** Jogador proprietário da carteira que será afetada. */
    playerId: string;
    /** Carteira alvo; também define a unidade de concorrência financeira. */
    walletId: string;
    /** Rodada à qual a operação e sua referência devem pertencer. */
    roundId: string;
    /** Jogo que originou a operação. */
    gameId: string;
    /** Tipo externo permitido; OPENING é reservado à abertura interna de carteira. */
    kind: Exclude<WagerTransactionKind, WagerTransactionKind.OPENING>;
    /** Quantia positiva e moeda da operação. */
    money: Money;
    /** ID externo da operação relacionada, obrigatório para reversões. */
    referenceExternalTransactionId?: string;
}

/** Resultado estável usado tanto pela API quanto pelo consumidor de mensagens. */
export interface ProcessWagerTransactionResult {
    /** Identificador interno da transação processada ou retomada. */
    transactionId: string;
    /** Estado alcançado ou preservado pela operação. */
    status: WagerTransactionStatus;
    /** Código estável para o provedor interpretar uma rejeição de negócio. */
    failureCode?: string;
    /** Saldo observado e persistido para reproduzir respostas em replay. */
    balance: Money;
    /** Indica se a resposta foi recuperada de uma operação já registrada. */
    idempotentReplay: boolean;
}

/**
 * Orquestra idempotência, regras de referência e efeitos financeiros em uma unidade
 * de trabalho, mantendo a lógica de aplicação fora dos repositórios.
 */
@Injectable()
export class WageringService {
    private readonly logger = new Logger(WageringService.name);
    /** Injeta os repositórios e serviços necessários ao processamento atômico. */
    constructor(
        private readonly wagerTransactionRepository: WagerTransactionRepository,
        private readonly walletRepository: WalletRepository,
        private readonly ledgerRepository: WalletLedgerEntryRepository,
        private readonly unitOfWork: DatabaseUnitOfWork,
        private readonly outboxRepository: OutboxRepository,
        private readonly metrics: MetricsService,
    ) {}

    /**
     * Processa uma operação com idempotência persistente e efeitos atômicos.
     * Quando recebe um EntityManager, participa da transação aberta pelo consumidor Inbox;
     * caso contrário, cria sua própria unidade de trabalho.
     */
    async processTransaction(
        props: ProcessWagerTransactionProps,
        transactionEm?: EntityManager,
    ): Promise<ProcessWagerTransactionResult> {
        const payloadHash = this.hashPayload(props);
        const startedAt = performance.now();

        const work = async (em: EntityManager): Promise<ProcessWagerTransactionResult> => {
            const prior = await this.wagerTransactionRepository.findByIdempotencyKey(props.idempotencyKey, em);
            if (prior) {
                if (!prior.matchesPayload(payloadHash)) {
                    throw new ConflictException('Idempotency key was already used with a different payload.');
                }
                if (prior.status !== WagerTransactionStatus.PENDING_REFERENCE) return this.replay(prior, payloadHash, em);
            }

            const wallet = await this.walletRepository.findByIdForUpdate(props.walletId, em);
            if (!wallet) throw new NotFoundException('Wallet not found.');
            if (wallet.playerId !== props.playerId) {
                throw new ConflictException('Wallet does not belong to the provided player.');
            }

            // A segunda verificação fecha a corrida entre duas requisições idênticas
            // que consultaram a idempotency key antes de obter o lock da carteira.
            const repeated = await this.wagerTransactionRepository.findByIdempotencyKey(props.idempotencyKey, em);
            if (repeated && repeated.status !== WagerTransactionStatus.PENDING_REFERENCE) {
                return this.replay(repeated, payloadHash, em);
            }
            const persistedTransaction = repeated ?? prior;
            const alreadyPersisted = persistedTransaction !== null && persistedTransaction !== undefined;

            const transaction = persistedTransaction ?? WagerTransaction.create({
                providerId: props.providerId,
                externalTransactionId: props.externalTransactionId,
                idempotencyKey: props.idempotencyKey,
                payloadHash,
                walletId: props.walletId,
                playerId: props.playerId,
                roundId: props.roundId,
                gameId: props.gameId,
                kind: props.kind,
                money: props.money,
                referenceExternalTransactionId: props.referenceExternalTransactionId,
            });

            if (transaction.money.getCurrency() !== wallet.currency) {
                transaction.reject('CURRENCY_MISMATCH');
                await this.saveTransaction(transaction, alreadyPersisted, wallet.balance, em);
                await this.enqueue(WagerTransactionRejected.from(transaction, { correlationId: transaction.id }), em);
                await em.flush();
                return {
                    transactionId: transaction.id,
                    status: transaction.status,
                    ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
                    balance: wallet.balance,
                    idempotentReplay: false,
                };
            }

            let reference: WagerTransaction | null = null;
            const hasOptionalWinReference = transaction.kind === WagerTransactionKind.WIN
                && Boolean(props.referenceExternalTransactionId);
            const awaitsReference = transaction.requiresReference() || hasOptionalWinReference;
            if (awaitsReference) {
                reference = props.referenceExternalTransactionId
                    ? await this.wagerTransactionRepository.findByProviderAndExternalId(
                        props.providerId,
                        props.referenceExternalTransactionId,
                        em,
                    )
                    : null;

                if (!reference) {
                    if (transaction.status === WagerTransactionStatus.PENDING) {
                        transaction.markPendingReference();
                        await this.wagerTransactionRepository.create(transaction, em, wallet.balance);
                        await this.enqueue(WagerTransactionPendingReference.from(transaction, { correlationId: transaction.id }), em);
                    } else {
                        const attempts = await this.wagerTransactionRepository.scheduleReferenceRetry(transaction.id, new Date(), em);
                        if (attempts >= MAX_REFERENCE_ATTEMPTS) {
                            transaction.reject('REFERENCE_NOT_FOUND');
                            await this.wagerTransactionRepository.update(transaction, em, wallet.balance);
                            await this.enqueue(WagerTransactionRejected.from(transaction, { correlationId: transaction.id }), em);
                        }
                    }
                    await em.flush();
                    return {
                        transactionId: transaction.id,
                        status: transaction.status,
                        ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
                        balance: wallet.balance,
                        idempotentReplay: false,
                    };
                }

                try {
                    this.validateReference(transaction, reference, wallet.currency);
                } catch {
                    transaction.reject('REFERENCE_NOT_ELIGIBLE');
                    await this.saveTransaction(transaction, alreadyPersisted, wallet.balance, em);
                    await this.enqueue(WagerTransactionRejected.from(transaction, { correlationId: transaction.id }), em);
                    await em.flush();
                    return {
                        transactionId: transaction.id,
                        status: transaction.status,
                        ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
                        balance: wallet.balance,
                        idempotentReplay: false,
                    };
                }

                if (await this.wagerTransactionRepository.hasProcessedReversal(reference.id, transaction.kind, em)) {
                    transaction.reject('REFERENCE_ALREADY_REVERSED');
                    await this.saveTransaction(transaction, alreadyPersisted, wallet.balance, em);
                    await this.enqueue(WagerTransactionRejected.from(transaction, { correlationId: transaction.id }), em);
                    await em.flush();
                    return {
                        transactionId: transaction.id,
                        status: transaction.status,
                        ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
                        balance: wallet.balance,
                        idempotentReplay: false,
                    };
                }
            }

            const ledgerDirection = transaction.ledgerDirectionFor(reference?.kind);
            if (ledgerDirection === undefined) {
                transaction.markProcessed();
                await this.saveTransaction(transaction, alreadyPersisted, wallet.balance, em);
                await this.enqueue(WagerTransactionProcessed.from(transaction, { correlationId: transaction.id }), em);
                await em.flush();
                return {
                    transactionId: transaction.id,
                    status: transaction.status,
                    ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
                    balance: wallet.balance,
                    idempotentReplay: false,
                };
            }
            const direction = ledgerDirection === 'DEBIT'
                ? WalletLedgerDirection.DEBIT
                : WalletLedgerDirection.CREDIT;

            try {
                const before = wallet.balance;
                if (direction === WalletLedgerDirection.DEBIT) wallet.debit(transaction.money);
                else wallet.credit(transaction.money);

                await this.walletRepository.updateBalance(wallet, em);
                transaction.markProcessed(reference?.id);
                await this.saveTransaction(transaction, alreadyPersisted, wallet.balance, em);
                await em.flush();

                const entry = WalletLedgerEntry.create({
                    walletId: wallet.id,
                    transactionId: transaction.id,
                    direction,
                    money: transaction.money,
                    balanceBefore: before,
                    balanceAfter: wallet.balance,
                });
                await this.ledgerRepository.create(entry, em);
                await this.enqueue(WagerTransactionProcessed.from(transaction, { correlationId: transaction.id }), em);
                await this.enqueue(WalletBalanceChanged.from(transaction, entry, wallet.version, { correlationId: transaction.id }), em);
                await em.flush();

                return {
                    transactionId: transaction.id,
                    status: transaction.status,
                    ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
                    balance: wallet.balance,
                    idempotentReplay: false,
                };
            } catch (error) {
                if (!(error instanceof Error) || error.message !== 'Insufficient funds.') throw error;

                transaction.reject(transaction.kind === WagerTransactionKind.ROLLBACK
                    ? 'ROLLBACK_WOULD_OVERDRAW'
                    : 'INSUFFICIENT_FUNDS');
                await this.saveTransaction(transaction, alreadyPersisted, wallet.balance, em);
                await this.enqueue(WagerTransactionRejected.from(transaction, { correlationId: transaction.id }), em);
                await em.flush();
                return {
                    transactionId: transaction.id,
                    status: transaction.status,
                    ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
                    balance: wallet.balance,
                    idempotentReplay: false,
                };
            }
        };
        try {
            const result = transactionEm ? await work(transactionEm) : await this.unitOfWork.execute(work);
            this.metrics.increment(`wager_transactions_total{status="${result.status}"}`);
            if (result.idempotentReplay) this.metrics.increment('wager_idempotent_replays_total');
            this.metrics.observe('wager_processing_duration_ms', performance.now() - startedAt);
            this.logger.log(JSON.stringify({
                event: 'wager_transaction_handled',
                correlationId: `${props.providerId}:${props.externalTransactionId}`,
                transactionId: result.transactionId,
                walletId: props.walletId,
                providerId: props.providerId,
                status: result.status,
                idempotentReplay: result.idempotentReplay,
            }));
            return result;
        } catch (error) {
            if (error instanceof ConflictException || error instanceof OptimisticLockError) {
                this.metrics.increment('wager_conflicts_total');
            }
            this.logger.error(JSON.stringify({
                event: 'wager_transaction_failed',
                correlationId: `${props.providerId}:${props.externalTransactionId}`,
                walletId: props.walletId,
                providerId: props.providerId,
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
            }));
            if (error instanceof UniqueConstraintViolationException) {
                // Não execute novas consultas na transação PostgreSQL abortada; deixe o
                // Inbox rolar junto e resolva a repetição na próxima entrega da mensagem.
                if (transactionEm) throw error;
                const existing = await this.wagerTransactionRepository.findByIdempotencyKey(props.idempotencyKey);
                if (existing) {
                    if (!existing.matchesPayload(payloadHash)) {
                        this.metrics.increment('wager_conflicts_total');
                        throw new ConflictException('Idempotency key was already used with a different payload.');
                    }
                    this.metrics.increment('wager_idempotent_replays_total');
                    return this.replay(existing, payloadHash);
                }
                const external = await this.wagerTransactionRepository.findByProviderAndExternalId(
                    props.providerId,
                    props.externalTransactionId,
                );
                if (external) {
                    this.metrics.increment('wager_conflicts_total');
                    throw new ConflictException('Provider transaction ID was already used.');
                }
            }
            if (isPermanentInfrastructureFailure(error)) {
                // A falha ocorreu dentro da UoW e todos os seus efeitos foram revertidos.
                // O consumidor precisa persistir FAILED em uma UoW nova, junto ao Inbox;
                // na chamada HTTP fazemos essa gravação aqui, também após o rollback.
                if (transactionEm) throw new PermanentWageringProcessingError(error);
                const result = await this.unitOfWork.execute((em) =>
                    this.recordPermanentFailure(props, em, PERMANENT_INFRASTRUCTURE_FAILURE),
                );
                this.metrics.increment('wager_transactions_total{status="FAILED"}');
                return result;
            }
            throw error;
        }
    }

    /** Persiste a falha terminal depois do rollback dos efeitos financeiros tentados. */
    async recordPermanentFailure(
        props: ProcessWagerTransactionProps,
        em: EntityManager,
        failureCode = PERMANENT_INFRASTRUCTURE_FAILURE,
    ): Promise<ProcessWagerTransactionResult> {
        const payloadHash = this.hashPayload(props);
        const prior = await this.wagerTransactionRepository.findByIdempotencyKey(props.idempotencyKey, em);
        if (prior) {
            if (!prior.matchesPayload(payloadHash)) {
                throw new ConflictException('Idempotency key was already used with a different payload.');
            }
            if (prior.isTerminal()) return this.replay(prior, payloadHash, em);
        } else {
            const external = await this.wagerTransactionRepository.findByProviderAndExternalId(
                props.providerId,
                props.externalTransactionId,
                em,
            );
            if (external) throw new ConflictException('Provider transaction ID was already used.');
        }

        const wallet = await this.walletRepository.findByIdForUpdate(props.walletId, em);
        if (!wallet) throw new NotFoundException('Wallet not found.');
        if (wallet.playerId !== props.playerId) {
            throw new ConflictException('Wallet does not belong to the provided player.');
        }

        const transaction = prior ?? WagerTransaction.create({
            providerId: props.providerId,
            externalTransactionId: props.externalTransactionId,
            idempotencyKey: props.idempotencyKey,
            payloadHash,
            walletId: props.walletId,
            playerId: props.playerId,
            roundId: props.roundId,
            gameId: props.gameId,
            kind: props.kind,
            money: props.money,
            referenceExternalTransactionId: props.referenceExternalTransactionId,
        });
        transaction.fail(failureCode);
        await this.saveTransaction(transaction, Boolean(prior), wallet.balance, em);
        await em.flush();

        return {
            transactionId: transaction.id,
            status: transaction.status,
            failureCode: transaction.failureCode,
            balance: wallet.balance,
            idempotentReplay: false,
        };
    }

    /** Busca pelo ID interno ou lança NotFoundException quando não há correspondência. */
    async getTransactionById(id: string): Promise<WagerTransaction> {
        const transaction = await this.wagerTransactionRepository.findById(id);

        if (!transaction) {
            throw new NotFoundException('Wager transaction not found.');
        }

        return transaction;
    }

    /** Busca pelo par provedor/ID externo ou lança NotFoundException. */
    async getTransactionByProvider(
        providerId: string,
        externalTransactionId: string,
    ): Promise<WagerTransaction> {
        const transaction =
            await this.wagerTransactionRepository.findByProviderAndExternalId(
                providerId,
                externalTransactionId,
            );

        if (!transaction) {
            throw new NotFoundException('Wager transaction not found.');
        }

        return transaction;
    }

    /** Calcula SHA-256 sobre os campos de negócio serializados em ordem canônica. */
    private hashPayload(props: ProcessWagerTransactionProps): string {
        const canonicalPayload = JSON.stringify({
            externalTransactionId: props.externalTransactionId,
            gameId: props.gameId,
            kind: props.kind,
            money: props.money.toJSON(),
            playerId: props.playerId,
            providerId: props.providerId,
            referenceExternalTransactionId: props.referenceExternalTransactionId ?? null,
            roundId: props.roundId,
            walletId: props.walletId,
        });
        return createHash('sha256').update(canonicalPayload).digest('hex');
    }

    /** Reproduz o resultado originalmente persistido, sem aplicar efeitos financeiros. */
    private async replay(
        transaction: WagerTransaction,
        payloadHash: string,
        em?: EntityManager,
    ): Promise<ProcessWagerTransactionResult> {
        if (!transaction.matchesPayload(payloadHash)) {
            throw new ConflictException('Idempotency key was already used with a different payload.');
        }
        const balance = await this.wagerTransactionRepository.findResultBalance(transaction.id, em);
        if (!balance) {
            const wallet = await this.walletRepository.findById(transaction.walletId, em);
            if (!wallet) throw new NotFoundException('Wallet not found.');
            return {
                transactionId: transaction.id,
                status: transaction.status,
                ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
                balance: wallet.balance,
                idempotentReplay: true,
            };
        }
        return {
            transactionId: transaction.id,
            status: transaction.status,
            ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
            balance,
            idempotentReplay: true,
        };
    }

    /** Garante elegibilidade, escopo e valor da operação referenciada. */
    private validateReference(
        transaction: WagerTransaction,
        reference: WagerTransaction,
        walletCurrency: string,
    ): void {
        const allowedKinds = transaction.kind === WagerTransactionKind.REFUND || transaction.kind === WagerTransactionKind.WIN
            ? [WagerTransactionKind.BET]
            : [WagerTransactionKind.BET, WagerTransactionKind.WIN, WagerTransactionKind.REFUND];
        if (reference.status !== WagerTransactionStatus.PROCESSED
            || !allowedKinds.includes(reference.kind)
            || reference.providerId !== transaction.providerId
            || reference.playerId !== transaction.playerId
            || reference.walletId !== transaction.walletId
            || reference.roundId !== transaction.roundId
            || reference.money.getCurrency() !== walletCurrency
            || ((transaction.kind === WagerTransactionKind.REFUND || transaction.kind === WagerTransactionKind.ROLLBACK)
                && !reference.money.equals(transaction.money))) {
            throw new Error('Referenced transaction is not eligible for reversal.');
        }
    }

    /** Persiste o evento na mesma transação da operação que o originou. */
    private async enqueue(event: IntegrationEvent<unknown>, em: EntityManager): Promise<void> {
        await this.outboxRepository.enqueue({
            eventId: event.eventId,
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            payload: event.toJSON(),
            occurredAt: event.occurredAt,
        }, em);
    }

    /** Escolhe insert ou update conforme a transação já exista no banco. */
    private async saveTransaction(
        transaction: WagerTransaction,
        alreadyPersisted: boolean,
        balance: Money,
        em: EntityManager,
    ): Promise<void> {
        if (alreadyPersisted) await this.wagerTransactionRepository.update(transaction, em, balance);
        else await this.wagerTransactionRepository.create(transaction, em, balance);
    }
}
