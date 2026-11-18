import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';

import { AppModule } from '../../../src/app.module.js';
import { DatabaseUnitOfWork } from '../../../src/shared/infrastructure/database/database-unit-of-work.js';

import { Money } from '../../../src/shared/domain/money.js';
import { Wallet } from '../../../src/wallet/domain/wallet.js';
import { WalletEntity } from '../../../src/wallet/entities/wallet.entity.js';
import { WalletRepository } from '../../../src/wallet/wallet.repository.js';

import {
    WagerTransaction,
    WagerTransactionKind,
} from '../../../src/wagering/domain/wager-transaction.js';
import { WagerTransactionEntity } from '../../../src/wagering/entities/wager-transaction.entity.js';
import { WagerTransactionRepository } from '../../../src/wagering/wager-transaction.repository.js';

describe('DatabaseUnitOfWork (integration)', () => {
    let testingModule: TestingModule;
    let databaseUnitOfWork: DatabaseUnitOfWork;
    let walletRepository: WalletRepository;
    let wagerTransactionRepository: WagerTransactionRepository;
    let em: EntityManager;

    let walletId: string;
    let transactionId: string;

    beforeAll(async () => {
        testingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        databaseUnitOfWork = testingModule.get(DatabaseUnitOfWork);
        walletRepository = testingModule.get(WalletRepository);
        wagerTransactionRepository = testingModule.get(WagerTransactionRepository);
        em = testingModule.get(EntityManager);
    });

    afterEach(async () => {
        const cleanupEm = em.fork();

        if (transactionId) {
            await cleanupEm.nativeDelete(WagerTransactionEntity, {
                id: transactionId,
            });
        }

        if (walletId) {
            await cleanupEm.nativeDelete(WalletEntity, {
                id: walletId,
            });
        }

        walletId = '';
        transactionId = '';
    });

    afterAll(async () => {
        await testingModule?.close();
    });

    function createTestData() {
        walletId = randomUUID();

        const wallet = Wallet.open({
            id: walletId,
            playerId: `player-${walletId}`,
            initialBalance: Money.zero('BRL'),
        });

        const transaction = WagerTransaction.create({
            providerId: 'integration-provider',
            externalTransactionId: `external-${randomUUID()}`,
            idempotencyKey: `idempotency-${randomUUID()}`,
            payloadHash: 'integration-test-hash',
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.BET,
            money: Money.from({
                amount: '10.00',
                currency: 'BRL',
            }),
        });

        transactionId = transaction.id;

        return { wallet, transaction };
    }

    it('should commit changes from multiple repositories in the same transaction', async () => {
        const { wallet, transaction } = createTestData();

        await databaseUnitOfWork.execute(async (transactionalEm) => {
            await walletRepository.create(wallet, transactionalEm);

            await transactionalEm.flush();

            await wagerTransactionRepository.create(transaction, transactionalEm);
        });

        const queryEm = em.fork();

        const persistedWallet = await walletRepository.findById(walletId, queryEm);
        const persistedTransaction = await wagerTransactionRepository.findById(
            transactionId,
            queryEm,
        );

        expect(persistedWallet).not.toBeNull();
        expect(persistedTransaction).not.toBeNull();
    });

    it('should rollback all changes when an operation fails', async () => {
        const { wallet, transaction } = createTestData();

        await expect(
            databaseUnitOfWork.execute(async (transactionalEm) => {
                await walletRepository.create(wallet, transactionalEm);

                await transactionalEm.flush();

                await wagerTransactionRepository.create(transaction, transactionalEm);

                await transactionalEm.flush();

                throw new Error('Simulated transaction failure');
            }),
        ).rejects.toThrow('Simulated transaction failure');

        const queryEm = em.fork();

        const persistedWallet = await walletRepository.findById(walletId, queryEm);
        const persistedTransaction = await wagerTransactionRepository.findById(
            transactionId,
            queryEm,
        );

        expect(persistedWallet).toBeNull();
        expect(persistedTransaction).toBeNull();
    });
});
