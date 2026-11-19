import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../../src/app.module.js';
import { DatabaseUnitOfWork } from '../../../src/shared/infrastructure/database/database-unit-of-work.js';
import { MetricsService } from '../../../src/shared/infrastructure/observability/metrics.service.js';
import { OutboxMessageEntity } from '../../../src/shared/infrastructure/messaging/outbox-message.entity.js';
import { OutboxRepository } from '../../../src/shared/infrastructure/messaging/outbox.repository.js';
import { Money } from '../../../src/shared/domain/money.js';
import { Wallet } from '../../../src/wallet/domain/wallet.js';
import { WalletLedgerDirection } from '../../../src/wallet/domain/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../../../src/wallet/entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryRepository } from '../../../src/wallet/repositories/wallet-ledger-entry.repository.js';
import { WalletRepository } from '../../../src/wallet/wallet.repository.js';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../src/wagering/domain/wager-transaction.js';
import { WagerTransactionEntity } from '../../../src/wagering/entities/wager-transaction.entity.js';
import { WagerTransactionRepository } from '../../../src/wagering/wager-transaction.repository.js';
import { ProcessWagerTransactionProps, WageringService } from '../../../src/wagering/wagering.service.js';
import { PendingReferenceWorker } from '../../../src/wagering/pending-reference.worker.js';

describe('WageringService (PostgreSQL integration)', () => {
    let module: TestingModule;
    let em: EntityManager;
    let service: WageringService;
    let pendingReferenceWorker: PendingReferenceWorker;
    let wallets: WalletRepository;
    let ledger: WalletLedgerEntryRepository;
    let transactionRepository: WagerTransactionRepository;
    let walletId = '';

    beforeAll(async () => {
        module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        em = module.get(EntityManager);
        service = module.get(WageringService);
        pendingReferenceWorker = module.get(PendingReferenceWorker);
        wallets = module.get(WalletRepository);
        ledger = module.get(WalletLedgerEntryRepository);
        transactionRepository = module.get(WagerTransactionRepository);
    });

    afterEach(async () => {
        // Lançamentos são imutáveis no banco; os cenários usam IDs e chaves isolados.
        walletId = '';
    });

    afterAll(async () => module?.close());

    async function createWallet() {
        walletId = randomUUID();
        const wallet = Wallet.open({
            id: walletId,
            playerId: `player-${walletId}`,
            initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
        });
        const setupEm = em.fork();
        await wallets.create(wallet, setupEm);
        await setupEm.flush();
        return wallet;
    }

    function bet(wallet: Wallet, amount: string, suffix: string): ProcessWagerTransactionProps {
        return {
            providerId: 'integration-provider',
            externalTransactionId: `external-${randomUUID()}`,
            idempotencyKey: `integration-${suffix}-${randomUUID()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.BET,
            money: Money.from({ amount, currency: 'BRL' }),
        };
    }

    it('allows only one of two concurrent 80 BRL bets against a 100 BRL balance', async () => {
        const wallet = await createWallet();

        const results = await Promise.all([
            service.processTransaction(bet(wallet, '80.00', 'race-a')),
            service.processTransaction(bet(wallet, '80.00', 'race-b')),
        ]);
        expect(results.filter(({ status }) => status === WagerTransactionStatus.PROCESSED)).toHaveLength(1);
        expect(results.filter(({ status }) => status === WagerTransactionStatus.REJECTED)).toHaveLength(1);

        const persistedWallet = await wallets.findById(wallet.id, em.fork());
        expect(persistedWallet?.balance.toString()).toBe('20.00');

        const ledgerEntry = await ledger.findByTransactionId(
            wallet.id,
            results.find(({ status }) => status === WagerTransactionStatus.PROCESSED)!.transactionId,
            em.fork(),
        );
        expect(ledgerEntry?.direction).toBe(WalletLedgerDirection.DEBIT);
        expect(ledgerEntry?.money.toString()).toBe('80.00');

        const rejectedEntry = await ledger.findByTransactionId(
            wallet.id,
            results.find(({ status }) => status === WagerTransactionStatus.REJECTED)!.transactionId,
            em.fork(),
        );
        expect(rejectedEntry).toBeNull();

        const outboxMessages = await em.fork().find(OutboxMessageEntity, {
            $or: [
                { aggregateId: { $in: results.map(({ transactionId }) => transactionId) } },
                { aggregateId: wallet.id, eventType: 'WalletBalanceChanged' },
            ],
        });
        expect(outboxMessages.map(({ eventType }) => eventType).sort()).toEqual([
            'WalletBalanceChanged',
            'WagerTransactionProcessed',
            'WagerTransactionRejected',
        ].sort());
        expect(outboxMessages.every(({ publishedAt }) => publishedAt === null)).toBe(true);
    });

    it('replays an identical idempotency key and rejects a changed payload', async () => {
        const wallet = await createWallet();
        const request = bet(wallet, '10.00', 'idempotency');

        const first = await service.processTransaction(request);
        await service.processTransaction(bet(wallet, '5.00', 'later'));
        const replay = await service.processTransaction(request);
        await expect(service.processTransaction({
            ...request,
            money: Money.from({ amount: '11.00', currency: 'BRL' }),
        })).rejects.toThrow();

        expect(first.status).toBe(WagerTransactionStatus.PROCESSED);
        expect(replay.transactionId).toBe(first.transactionId);
        expect(replay.idempotentReplay).toBe(true);
        expect(replay.balance.toString()).toBe('90.00');
        const queryEm = em.fork();
        expect(await queryEm.count(WagerTransactionEntity, { walletId: wallet.id })).toBe(2);
        expect(await queryEm.count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(2);
    });

    it('processes 50 parallel deliveries of one wager as a single debit', async () => {
        const wallet = await createWallet();
        const request = bet(wallet, '10.00', 'fifty-way-replay');

        const results = await Promise.all(
            Array.from({ length: 50 }, () => service.processTransaction(request)),
        );

        expect(new Set(results.map(({ transactionId }) => transactionId)).size).toBe(1);
        expect(results.filter(({ idempotentReplay }) => !idempotentReplay)).toHaveLength(1);
        expect(results.filter(({ idempotentReplay }) => idempotentReplay)).toHaveLength(49);
        expect(results.every(({ status }) => status === WagerTransactionStatus.PROCESSED)).toBe(true);
        expect((await wallets.findById(wallet.id, em.fork()))?.balance.toString()).toBe('90.00');
        expect(await em.fork().count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(1);
    });

    it('keeps balances correct across three independent processing instances', async () => {
        const wallet = await createWallet();
        const instances = Array.from({ length: 3 }, () => {
            const manager = em.fork();
            return new WageringService(
                new WagerTransactionRepository(manager),
                new WalletRepository(manager),
                new WalletLedgerEntryRepository(manager),
                new DatabaseUnitOfWork(manager),
                new OutboxRepository(manager),
                new MetricsService(),
            );
        });

        const results = await Promise.all(instances.map((instance, index) => instance.processTransaction(
            bet(wallet, '40.00', `instance-${index}`),
        )));

        expect(results.filter(({ status }) => status === WagerTransactionStatus.PROCESSED)).toHaveLength(2);
        expect(results.filter(({ status }) => status === WagerTransactionStatus.REJECTED)).toHaveLength(1);
        expect((await wallets.findById(wallet.id, em.fork()))?.balance.toString()).toBe('20.00');
        expect(await em.fork().count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(2);
    });

    it.skipIf(process.env.WAGER_MULTIPROCESS_INTEGRATION_TESTS !== 'true')(
        'keeps balances correct across three separate application processes',
        async () => {
            const wallet = await createWallet();
            const requests = Array.from({ length: 3 }, (_, index) => bet(wallet, '40.00', `process-${index}`));
            const results = await Promise.all(requests.map((request) => new Promise<{
                pid: number;
                transactionId: string;
                status: WagerTransactionStatus;
            }>((resolve, reject) => {
                const child = spawn(process.execPath, ['run', 'test/support/process-wager.ts'], {
                    cwd: process.cwd(),
                    env: {
                        ...process.env,
                        WAGER_PROCESS_REQUEST: JSON.stringify({ ...request, money: request.money.toJSON() }),
                        SQS_CONSUMER_ENABLED: 'false',
                        OUTBOX_PUBLISHER_ENABLED: 'false',
                        REFERENCE_WORKER_ENABLED: 'false',
                    },
                    windowsHide: true,
                });
                let stdout = '';
                let stderr = '';
                child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
                child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
                child.once('error', reject);
                child.once('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Wager process exited with ${code}: ${stderr}`));
                        return;
                    }
                    const resultLine = stdout.split(/\r?\n/).findLast((line) => line.startsWith('{'));
                    if (!resultLine) {
                        reject(new Error(`Wager process did not return a result: ${stdout}\n${stderr}`));
                        return;
                    }
                    resolve(JSON.parse(resultLine) as {
                        pid: number;
                        transactionId: string;
                        status: WagerTransactionStatus;
                    });
                });
            })));

            expect(new Set(results.map(({ pid }) => pid)).size).toBe(3);
            expect(results.filter(({ status }) => status === WagerTransactionStatus.PROCESSED)).toHaveLength(2);
            expect(results.filter(({ status }) => status === WagerTransactionStatus.REJECTED)).toHaveLength(1);
            expect((await wallets.findById(wallet.id, em.fork()))?.balance.toString()).toBe('20.00');
            expect(await em.fork().count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(2);
        },
    );

    it('processes different wallets concurrently without sharing their balances', async () => {
        const firstWallet = await createWallet();
        const secondWallet = await createWallet();

        const [first, second] = await Promise.all([
            service.processTransaction(bet(firstWallet, '30.00', 'parallel-wallet-a')),
            service.processTransaction(bet(secondWallet, '70.00', 'parallel-wallet-b')),
        ]);

        expect(first.status).toBe(WagerTransactionStatus.PROCESSED);
        expect(second.status).toBe(WagerTransactionStatus.PROCESSED);
        expect((await wallets.findById(firstWallet.id, em.fork()))?.balance.toString()).toBe('70.00');
        expect((await wallets.findById(secondWallet.id, em.fork()))?.balance.toString()).toBe('30.00');
        expect(await em.fork().count(WalletLedgerEntryEntity, { walletId: firstWallet.id })).toBe(1);
        expect(await em.fork().count(WalletLedgerEntryEntity, { walletId: secondWallet.id })).toBe(1);
    });

    it('reprocesses a REFUND delivered before its BET reference', async () => {
        const wallet = await createWallet();
        const externalBetId = `bet-${randomUUID()}`;
        const refund = await service.processTransaction({
            providerId: 'integration-provider',
            externalTransactionId: `refund-${randomUUID()}`,
            idempotencyKey: `refund-key-${randomUUID()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.REFUND,
            referenceExternalTransactionId: externalBetId,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
        });
        expect(refund.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);

        await service.processTransaction({
            providerId: 'integration-provider',
            externalTransactionId: externalBetId,
            idempotencyKey: `bet-key-${randomUUID()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.BET,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
        });

        await em.fork().nativeUpdate(WagerTransactionEntity, { id: refund.transactionId }, {
            nextReferenceAttemptAt: new Date(Date.now() - 1000),
        });
        await pendingReferenceWorker.processDue();

        const processedRefund = await transactionRepository.findById(refund.transactionId, em.fork());
        const persistedWallet = await wallets.findById(wallet.id, em.fork());
        expect(processedRefund?.status).toBe(WagerTransactionStatus.PROCESSED);
        expect(persistedWallet?.balance.toString()).toBe('100.00');
        expect(await em.fork().count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(2);
    });

    it('validates an optional WIN reference against a processed BET in the same round', async () => {
        const wallet = await createWallet();
        const betExternalId = `bet-${randomUUID()}`;
        const betResult = await service.processTransaction({
            providerId: 'integration-provider',
            externalTransactionId: betExternalId,
            idempotencyKey: `bet-key-${randomUUID()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.BET,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
        });
        const win = await service.processTransaction({
            providerId: 'integration-provider',
            externalTransactionId: `win-${randomUUID()}`,
            idempotencyKey: `win-key-${randomUUID()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.WIN,
            referenceExternalTransactionId: betExternalId,
            money: Money.from({ amount: '20.00', currency: 'BRL' }),
        });

        expect(betResult.status).toBe(WagerTransactionStatus.PROCESSED);
        expect(win.status).toBe(WagerTransactionStatus.PROCESSED);
        expect((await wallets.findById(wallet.id, em.fork()))?.balance.toString()).toBe('110.00');
    });

    it('retries an optional WIN reference that arrives before its BET', async () => {
        const wallet = await createWallet();
        const betExternalId = `bet-${randomUUID()}`;
        const win = await service.processTransaction({
            providerId: 'integration-provider',
            externalTransactionId: `win-${randomUUID()}`,
            idempotencyKey: `win-key-${randomUUID()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.WIN,
            referenceExternalTransactionId: betExternalId,
            money: Money.from({ amount: '20.00', currency: 'BRL' }),
        });
        expect(win.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);

        const bet = await service.processTransaction({
            providerId: 'integration-provider',
            externalTransactionId: betExternalId,
            idempotencyKey: `bet-key-${randomUUID()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.BET,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
        });
        expect(bet.status).toBe(WagerTransactionStatus.PROCESSED);

        await em.fork().nativeUpdate(WagerTransactionEntity, { id: win.transactionId }, {
            nextReferenceAttemptAt: new Date(Date.now() - 1000),
        });
        await pendingReferenceWorker.processDue();

        const processedWin = await transactionRepository.findById(win.transactionId, em.fork());
        expect(processedWin?.status).toBe(WagerTransactionStatus.PROCESSED);
        expect((await wallets.findById(wallet.id, em.fork()))?.balance.toString()).toBe('110.00');
        expect(await em.fork().count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(2);
    });

    it('rejects a missing reference after the persistent retry limit', async () => {
        const wallet = await createWallet();
        const pending = await service.processTransaction({
            providerId: 'integration-provider',
            externalTransactionId: `refund-${randomUUID()}`,
            idempotencyKey: `refund-key-${randomUUID()}`,
            playerId: wallet.playerId,
            walletId: wallet.id,
            roundId: 'integration-round',
            gameId: 'integration-game',
            kind: WagerTransactionKind.REFUND,
            referenceExternalTransactionId: `absent-${randomUUID()}`,
            money: Money.from({ amount: '10.00', currency: 'BRL' }),
        });
        await em.fork().nativeUpdate(WagerTransactionEntity, { id: pending.transactionId }, {
            referenceAttempts: 11,
            nextReferenceAttemptAt: new Date(Date.now() - 1000),
        });

        await pendingReferenceWorker.processDue();

        const transaction = await transactionRepository.findById(pending.transactionId, em.fork());
        expect(transaction?.status).toBe(WagerTransactionStatus.REJECTED);
        expect(transaction?.failureCode).toBe('REFERENCE_NOT_FOUND');
        expect(await em.fork().count(WalletLedgerEntryEntity, { walletId: wallet.id })).toBe(0);
    });
});
