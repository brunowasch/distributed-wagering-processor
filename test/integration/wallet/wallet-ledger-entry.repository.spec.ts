import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';

import { AppModule } from '../../../src/app.module.js';
import { Money } from '../../../src/shared/domain/money.js';
import { WalletLedgerEntry, WalletLedgerDirection } from '../../../src/wallet/domain/wallet-ledger-entry.js';
import { Wallet } from '../../../src/wallet/domain/wallet.js';
import { WalletLedgerEntryEntity } from '../../../src/wallet/entities/wallet-ledger-entry.entity.js';
import { WalletEntity } from '../../../src/wallet/entities/wallet.entity.js';
import { WalletLedgerEntryRepository } from '../../../src/wallet/repositories/wallet-ledger-entry.repository.js';
import { WalletRepository } from '../../../src/wallet/wallet.repository.js';
import { WagerTransaction, WagerTransactionKind } from '../../../src/wagering/domain/wager-transaction.js';
import { WagerTransactionRepository } from '../../../src/wagering/wager-transaction.repository.js';

describe('WalletLedgerEntryRepository (integration)', () => {
    let testingModule: TestingModule;
    let em: EntityManager;
    let walletRepository: WalletRepository;
    let transactionRepository: WagerTransactionRepository;
    let ledgerRepository: WalletLedgerEntryRepository;

    let walletId = '';

    beforeAll(async () => {
        testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        em = testingModule.get(EntityManager);
        walletRepository = testingModule.get(WalletRepository);
        transactionRepository = testingModule.get(WagerTransactionRepository);
        ledgerRepository = testingModule.get(WalletLedgerEntryRepository);
    });

    afterEach(async () => {
        // Lançamentos são imutáveis no banco; os cenários usam IDs isolados.
        walletId = '';
    });

    afterAll(async () => {
        await testingModule?.close();
    });

    async function createParents() {
        walletId = randomUUID();
        const wallet = Wallet.open({
            id: walletId,
            playerId: `player-${walletId}`,
            initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
        });

        const transaction = WagerTransaction.create({
            providerId: `integration-provider-${randomUUID()}`,
            externalTransactionId: `external-${randomUUID()}`,
            idempotencyKey: `idempotency-${randomUUID()}`,
            payloadHash: 'integration-test-hash',
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.BET,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
        });

        const setupEm = em.fork();
        await walletRepository.create(wallet, setupEm);
        await setupEm.flush();
        await transactionRepository.create(transaction, setupEm);
        await setupEm.flush();

        return { wallet, transaction };
    }

    function createDebitEntry(wallet: Wallet, transaction: WagerTransaction) {
        const entry = WalletLedgerEntry.create({
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: WalletLedgerDirection.DEBIT,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
            balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
            balanceAfter: Money.from({ amount: '90.00', currency: 'BRL' }),
        });
        return entry;
    }

    it('persists a debit ledger entry in PostgreSQL', async () => {
        const { wallet, transaction } = await createParents();
        const entry = createDebitEntry(wallet, transaction);
        const writeEm = em.fork();

        await ledgerRepository.create(entry, writeEm);
        await writeEm.flush();

        const persisted = await em.fork().findOne(WalletLedgerEntryEntity, { id: entry.id });
        expect(persisted).not.toBeNull();
        expect(persisted?.direction).toBe(WalletLedgerDirection.DEBIT);
        expect(persisted?.amount).toBe('10.00');
        expect(persisted?.balanceBefore).toBe('100.00');
        expect(persisted?.balanceAfter).toBe('90.00');
    });

    it('finds a ledger entry by walletId and transactionId', async () => {
        const { wallet, transaction } = await createParents();
        const entry = createDebitEntry(wallet, transaction);
        const writeEm = em.fork();
        await ledgerRepository.create(entry, writeEm);
        await writeEm.flush();

        const result = await ledgerRepository.findByTransactionId(wallet.id, transaction.id, em.fork());

        expect(result).toBeInstanceOf(WalletLedgerEntry);
        expect(result?.id).toBe(entry.id);
        expect(result?.direction).toBe(WalletLedgerDirection.DEBIT);
        expect(result?.money.toString()).toBe('10.00');
        expect(result?.balanceAfter.toString()).toBe('90.00');
    });

    it('returns null when the ledger entry does not exist', async () => {
        const { wallet, transaction } = await createParents();

        const result = await ledgerRepository.findByTransactionId(wallet.id, transaction.id, em.fork());

        expect(result).toBeNull();
    });

    it('rejects duplicate entries for the same wallet and transaction', async () => {
        const { wallet, transaction } = await createParents();
        const entry = createDebitEntry(wallet, transaction);
        const writeEm = em.fork();
        await ledgerRepository.create(entry, writeEm);
        await writeEm.flush();

        const duplicate = WalletLedgerEntry.create({
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: WalletLedgerDirection.DEBIT,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
            balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
            balanceAfter: Money.from({ amount: '90.00', currency: 'BRL' }),
        });

        await expect(em.fork().transactional(async (transactionalEm) => {
            await ledgerRepository.create(duplicate, transactionalEm);
            await transactionalEm.flush();
        })).rejects.toThrow();
    });

    it('enforces the wallet and transaction foreign keys', async () => {
        const { wallet, transaction } = await createParents();
        const invalidWalletEntry = WalletLedgerEntry.create({
            walletId: randomUUID(),
            transactionId: transaction.id,
            direction: WalletLedgerDirection.DEBIT,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
            balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
            balanceAfter: Money.from({ amount: '90.00', currency: 'BRL' }),
        });
        const invalidTransactionEntry = WalletLedgerEntry.create({
            walletId: wallet.id,
            transactionId: randomUUID(),
            direction: WalletLedgerDirection.DEBIT,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
            balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
            balanceAfter: Money.from({ amount: '90.00', currency: 'BRL' }),
        });

        for (const invalidEntry of [invalidWalletEntry, invalidTransactionEntry]) {
            await expect(em.fork().transactional(async (transactionalEm) => {
                await ledgerRepository.create(invalidEntry, transactionalEm);
                await transactionalEm.flush();
            })).rejects.toThrow();
        }
    });

    it('rejects updates and deletes of an existing ledger entry in PostgreSQL', async () => {
        const { wallet, transaction } = await createParents();
        const entry = createDebitEntry(wallet, transaction);
        const writeEm = em.fork();
        await ledgerRepository.create(entry, writeEm);
        await writeEm.flush();

        await expect(em.fork().nativeUpdate(WalletLedgerEntryEntity, { id: entry.id }, { amount: '11.00' }))
            .rejects.toThrow();
        await expect(em.fork().nativeDelete(WalletLedgerEntryEntity, { id: entry.id }))
            .rejects.toThrow();

        const persisted = await em.fork().findOne(WalletLedgerEntryEntity, { id: entry.id });
        expect(persisted?.amount).toBe('10.00');
    });

    it('rejects a ledger row whose balance equation is inconsistent', async () => {
        const { wallet, transaction } = await createParents();
        const invalidEntity = Object.assign(new WalletLedgerEntryEntity(), {
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: WalletLedgerDirection.DEBIT,
            amount: '10.00',
            currency: 'BRL',
            balanceBefore: '100.00',
            balanceAfter: '95.00',
            createdAt: new Date(),
        });

        await expect(em.fork().transactional(async (transactionalEm) => {
            transactionalEm.persist(invalidEntity);
            await transactionalEm.flush();
        })).rejects.toThrow();
    });

    it('rejects a negative wallet balance in PostgreSQL', async () => {
        const { wallet } = await createParents();

        await expect(em.fork().nativeUpdate(WalletEntity, { id: wallet.id }, { balance: '-0.01' }))
            .rejects.toThrow();
    });
});
