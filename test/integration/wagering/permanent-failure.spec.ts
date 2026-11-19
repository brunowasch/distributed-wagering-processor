import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../../../src/app.module.js';
import { DatabaseUnitOfWork } from '../../../src/shared/infrastructure/database/database-unit-of-work.js';
import { Money } from '../../../src/shared/domain/money.js';
import { WalletApplicationService } from '../../../src/wallet/wallet-application.service.js';
import { WalletLedgerEntryEntity } from '../../../src/wallet/entities/wallet-ledger-entry.entity.js';
import { WagerTransactionStatus, WagerTransactionKind } from '../../../src/wagering/domain/wager-transaction.js';
import { WagerTransactionEntity } from '../../../src/wagering/entities/wager-transaction.entity.js';
import { PERMANENT_INFRASTRUCTURE_FAILURE } from '../../../src/wagering/permanent-processing-failure.js';
import { WageringService } from '../../../src/wagering/wagering.service.js';

describe('Permanent wagering failure (PostgreSQL integration)', () => {
    let module: TestingModule;
    let em: EntityManager;
    let unitOfWork: DatabaseUnitOfWork;
    let walletApplication: WalletApplicationService;
    let wagering: WageringService;

    beforeAll(async () => {
        module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        em = module.get(EntityManager);
        unitOfWork = module.get(DatabaseUnitOfWork);
        walletApplication = module.get(WalletApplicationService);
        wagering = module.get(WageringService);
    });

    afterAll(async () => module?.close());

    it('persists FAILED idempotently without changing balance or creating a financial ledger entry', async () => {
        const playerId = `failure-player-${randomUUID()}`;
        const wallet = await walletApplication.openWallet({
            playerId,
            initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
        });
        const props = {
            providerId: 'integration-provider',
            externalTransactionId: `failure-${randomUUID()}`,
            idempotencyKey: `failure-${randomUUID()}`,
            playerId,
            walletId: wallet.id,
            roundId: 'failure-round',
            gameId: 'failure-game',
            kind: WagerTransactionKind.BET,
            money: Money.from({ amount: '12.00', currency: 'BRL' }),
        } as const;

        const result = await unitOfWork.execute((transactionEm) =>
            wagering.recordPermanentFailure(props, transactionEm),
        );
        const replay = await wagering.processTransaction(props);
        const persisted = await em.fork().findOneOrFail(WagerTransactionEntity, { id: result.transactionId });
        const financialEntries = await em.fork().count(WalletLedgerEntryEntity, { transactionId: result.transactionId });
        const balance = await walletApplication.getWallet(wallet.id);

        expect(result.status).toBe(WagerTransactionStatus.FAILED);
        expect(result.failureCode).toBe(PERMANENT_INFRASTRUCTURE_FAILURE);
        expect(replay).toMatchObject({
            transactionId: result.transactionId,
            status: WagerTransactionStatus.FAILED,
            failureCode: PERMANENT_INFRASTRUCTURE_FAILURE,
            idempotentReplay: true,
        });
        expect(persisted.status).toBe(WagerTransactionStatus.FAILED);
        expect(financialEntries).toBe(0);
        expect(balance.balance.toString()).toBe('100.00');
    });
});
