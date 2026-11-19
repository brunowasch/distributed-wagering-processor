import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../../src/app.module.js';
import { Money } from '../../../src/shared/domain/money.js';
import { Wallet } from '../../../src/wallet/domain/wallet.js';
import { WalletApplicationService } from '../../../src/wallet/wallet-application.service.js';
import { WalletRepository } from '../../../src/wallet/wallet.repository.js';

describe('Wallet reconciliation (PostgreSQL integration)', () => {
    let module: TestingModule;
    let em: EntityManager;
    let wallets: WalletRepository;
    let application: WalletApplicationService;

    beforeAll(async () => {
        module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        em = module.get(EntityManager);
        wallets = module.get(WalletRepository);
        application = module.get(WalletApplicationService);
    });

    afterAll(async () => module?.close());

    it('reports divergence between the stored balance and missing ledger history', async () => {
        const wallet = Wallet.open({
            id: randomUUID(),
            playerId: `reconciliation-player-${randomUUID()}`,
            initialBalance: Money.from({ amount: '40.00', currency: 'BRL' }),
        });
        const writer = em.fork();
        await wallets.create(wallet, writer);
        await writer.flush();

        const result = await application.reconcile(wallet.id);

        expect(result.storedBalance.toString()).toBe('40.00');
        expect(result.calculatedBalance.toString()).toBe('0.00');
        expect(result.difference.toString()).toBe('40.00');
        expect(result.consistent).toBe(false);
        expect(result.checkedEntries).toBe(0);
        expect(result.checkedTransactions).toBe(0);
    });
});
