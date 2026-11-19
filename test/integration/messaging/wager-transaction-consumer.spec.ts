import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../src/app.module.js';
import { DatabaseUnitOfWork } from '../../../src/shared/infrastructure/database/database-unit-of-work.js';
import { Money } from '../../../src/shared/domain/money.js';
import { InboxRepository } from '../../../src/shared/infrastructure/messaging/inbox.repository.js';
import { SqsClient } from '../../../src/shared/infrastructure/messaging/sqs-client.js';
import { WagerTransactionConsumer } from '../../../src/shared/infrastructure/messaging/wager-transaction-consumer.js';
import { MetricsService } from '../../../src/shared/infrastructure/observability/metrics.service.js';
import { WalletApplicationService } from '../../../src/wallet/wallet-application.service.js';
import { WalletLedgerEntryEntity } from '../../../src/wallet/entities/wallet-ledger-entry.entity.js';
import { WalletEntity } from '../../../src/wallet/entities/wallet.entity.js';
import { WagerTransactionKind, WagerTransactionStatus } from '../../../src/wagering/domain/wager-transaction.js';
import { WagerTransactionEntity } from '../../../src/wagering/entities/wager-transaction.entity.js';
import { PermanentWageringProcessingError } from '../../../src/wagering/permanent-processing-failure.js';
import { WageringService } from '../../../src/wagering/wagering.service.js';

const enabled = process.env.SQS_INTEGRATION_TESTS === 'true';

describe.skipIf(!enabled)('Wager transaction consumer (PostgreSQL + LocalStack integration)', () => {
    let module: TestingModule;
    let em: EntityManager;
    let sqs: SqsClient;
    let inbox: InboxRepository;
    let wagering: WageringService;
    let unitOfWork: DatabaseUnitOfWork;
    let metrics: MetricsService;
    let wallets: WalletApplicationService;
    const queues: Array<{ source: string; dlq: string }> = [];

    beforeAll(async () => {
        process.env.AWS_SQS_ENDPOINT ??= 'http://localhost:4566';
        module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        em = module.get(EntityManager);
        sqs = module.get(SqsClient);
        inbox = module.get(InboxRepository);
        wagering = module.get(WageringService);
        unitOfWork = module.get(DatabaseUnitOfWork);
        metrics = module.get(MetricsService);
        wallets = module.get(WalletApplicationService);
    });

    afterAll(async () => {
        await module?.close();
        for (const { source, dlq } of queues.reverse()) {
            await sqs.deleteQueue(source).catch(() => undefined);
            await sqs.deleteQueue(dlq).catch(() => undefined);
        }
    });

    async function queuePair(maxReceiveCount = 5) {
        const suffix = randomUUID().replaceAll('-', '');
        const source = `wager-consumer-${suffix}.fifo`;
        const dlq = `wager-consumer-dlq-${suffix}.fifo`;
        await sqs.createFifoQueue(dlq);
        const arn = await sqs.getQueueArn(dlq);
        await sqs.createFifoQueue(source, { deadLetterTargetArn: arn, maxReceiveCount });
        queues.push({ source, dlq });
        return { source, dlq };
    }

    function consumer(source: string, dlq: string, enabled = false) {
        const config = new ConfigService({
            WAGER_TRANSACTIONS_QUEUE: source,
            WAGER_TRANSACTIONS_DLQ_QUEUE: dlq,
            SQS_CONSUMER_ENABLED: enabled ? 'true' : 'false',
        });
        return new WagerTransactionConsumer(sqs, inbox, wagering, unitOfWork, metrics, config);
    }

    async function wagerMessage() {
        const playerId = `consumer-player-${randomUUID()}`;
        const wallet = await wallets.openWallet({
            playerId,
            initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
        });
        const data = {
            providerId: 'consumer-integration-provider',
            externalTransactionId: `consumer-${randomUUID()}`,
            idempotencyKey: `consumer-idempotency-${randomUUID()}`,
            playerId,
            walletId: wallet.id,
            roundId: `round-${randomUUID()}`,
            gameId: 'consumer-integration-game',
            kind: WagerTransactionKind.BET,
            money: { amount: '17.00', currency: 'BRL' },
        };
        return { wallet, envelope: { type: 'WagerTransactionRequested', messageId: randomUUID(), data } };
    }

    it('commits before ACK and safely handles a crash between commit and ACK on redelivery', async () => {
        const { source, dlq } = await queuePair();
        const { wallet, envelope } = await wagerMessage();
        await sqs.sendMessage(source, JSON.stringify(envelope), randomUUID(), randomUUID());
        const originalDelete = sqs.deleteMessage.bind(sqs);
        const originalVisibility = sqs.changeMessageVisibility.bind(sqs);
        let simulateCrash = true;
        const requestedBackoff: number[] = [];
        vi.spyOn(sqs, 'deleteMessage').mockImplementation(async (queue, receipt) => {
            if (simulateCrash) {
                simulateCrash = false;
                throw new Error('simulated crash after financial commit and before ACK');
            }
            await originalDelete(queue, receipt);
        });
        vi.spyOn(sqs, 'changeMessageVisibility').mockImplementation(async (queue, receipt, seconds) => {
            requestedBackoff.push(seconds);
            await originalVisibility(queue, receipt, 0);
        });
        try {
            const subject = consumer(source, dlq);
            await subject.consumeBatch();
            await subject.consumeBatch();

            const transactions = await em.fork().find(WagerTransactionEntity, {
                externalTransactionId: envelope.data.externalTransactionId,
            });
            const financialEntries = await em.fork().count(WalletLedgerEntryEntity, {
                transactionId: transactions[0]?.id,
            });
            const inboxEntry = await inbox.find('wager-transaction-consumer', envelope.messageId, em.fork());
            const balance = await wallets.getWallet(wallet.id);
            expect(transactions).toHaveLength(1);
            expect(transactions[0]?.status).toBe(WagerTransactionStatus.PROCESSED);
            expect(financialEntries).toBe(1);
            expect(balance.balance.toString()).toBe('83.00');
            expect(inboxEntry?.processedAt).toBeInstanceOf(Date);
            expect(requestedBackoff).toEqual([5]);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('applies exponential visibility backoff and moves a repeatedly invalid message to the DLQ', async () => {
        const { source, dlq } = await queuePair(5);
        const body = JSON.stringify({ invalid: true, id: randomUUID() });
        await sqs.sendMessage(source, body, randomUUID(), randomUUID());
        const originalVisibility = sqs.changeMessageVisibility.bind(sqs);
        const requestedBackoff: number[] = [];
        vi.spyOn(sqs, 'changeMessageVisibility').mockImplementation(async (queue, receipt, seconds) => {
            requestedBackoff.push(seconds);
            await originalVisibility(queue, receipt, 0);
        });
        try {
            const subject = consumer(source, dlq);
            for (let attempt = 0; attempt < 8 && (await sqs.getApproximateMessageCount(dlq)) === 0; attempt += 1) {
                await subject.consumeBatch();
            }
            expect(requestedBackoff.slice(0, 5)).toEqual([5, 10, 20, 30, 30]);
            expect(await sqs.getApproximateMessageCount(dlq)).toBeGreaterThan(0);
            const dlqMessages = await sqs.receiveMessages(dlq, 10, 0);
            const delivered = dlqMessages.find(({ body: candidate }) => candidate === body);
            expect(delivered).toBeDefined();
            if (delivered) await sqs.deleteMessage(dlq, delivered.receiptHandle);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('persists a permanent FAILED transaction and eventually forwards its unacknowledged delivery to the DLQ', async () => {
        const { source, dlq } = await queuePair(3);
        const { wallet, envelope } = await wagerMessage();
        await sqs.sendMessage(source, JSON.stringify(envelope), randomUUID(), randomUUID());
        vi.spyOn(wagering, 'processTransaction').mockRejectedValue(
            new PermanentWageringProcessingError({ code: '23514' }),
        );
        const originalVisibility = sqs.changeMessageVisibility.bind(sqs);
        vi.spyOn(sqs, 'changeMessageVisibility').mockImplementation(async (queue, receipt) => {
            await originalVisibility(queue, receipt, 0);
        });
        try {
            const subject = consumer(source, dlq);
            for (let attempt = 0; attempt < 7 && (await sqs.getApproximateMessageCount(dlq)) === 0; attempt += 1) {
                await subject.consumeBatch();
            }
            const transaction = await em.fork().findOne(WagerTransactionEntity, {
                externalTransactionId: envelope.data.externalTransactionId,
            });
            const inboxEntry = await inbox.find('wager-transaction-consumer', envelope.messageId, em.fork());
            const balance = await wallets.getWallet(wallet.id);
            expect(transaction?.status).toBe(WagerTransactionStatus.FAILED);
            expect(transaction?.failureCode).toBe('PERMANENT_INFRASTRUCTURE_FAILURE');
            expect(inboxEntry?.processedAt).toBeNull();
            expect(balance.balance.toString()).toBe('100.00');
            expect(await sqs.getApproximateMessageCount(dlq)).toBeGreaterThan(0);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('receives real SIGTERM and waits for the in-flight message before the process exits', async () => {
        const { source, dlq } = await queuePair();
        const { wallet, envelope } = await wagerMessage();
        await sqs.sendMessage(source, JSON.stringify(envelope), randomUUID(), randomUUID());
        let releaseWalletLock!: () => void;
        let walletLockAcquired!: () => void;
        const release = new Promise<void>((resolve) => { releaseWalletLock = resolve; });
        const locked = new Promise<void>((resolve) => { walletLockAcquired = resolve; });
        const lockEm = em.fork();
        const lockTask = lockEm.transactional(async (transactionalEm) => {
            await transactionalEm.findOneOrFail(
                WalletEntity,
                { id: wallet.id },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
            );
            walletLockAcquired();
            await release;
        });
        await locked;

        let childProcess: ReturnType<typeof spawn> | undefined;
        let childClosed = false;
        let resolveChildClose!: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
        const childClose = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            resolveChildClose = resolve;
        });
        try {
            const child = spawn(process.env.BUN_EXECUTABLE ?? 'bun', ['run', 'test/support/consumer-shutdown-process.ts'], {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    AWS_SQS_ENDPOINT: process.env.AWS_SQS_ENDPOINT ?? 'http://localhost:4566',
                    WAGER_TRANSACTIONS_QUEUE: source,
                    WAGER_TRANSACTIONS_DLQ_QUEUE: dlq,
                    SQS_CONSUMER_ENABLED: 'true',
                    OUTBOX_PUBLISHER_ENABLED: 'false',
                    REFERENCE_WORKER_ENABLED: 'false',
                },
                windowsHide: true,
            });
            childProcess = child;
            let childOutput = '';
            let childError = '';
            child.stdout.setEncoding('utf8').on('data', (chunk: string) => { childOutput += chunk; });
            child.stderr.setEncoding('utf8').on('data', (chunk: string) => { childError += chunk; });
            child.once('error', (error) => { childError += `${error.stack ?? error.message}\n`; });
            child.once('close', (code, signal) => {
                childClosed = true;
                resolveChildClose({ code, signal });
            });

            async function waitUntilReady(): Promise<void> {
                const deadline = Date.now() + 15_000;
                while (!childOutput.includes('CONSUMER_SHUTDOWN_READY') && !childClosed && Date.now() < deadline) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                if (!childOutput.includes('CONSUMER_SHUTDOWN_READY')) {
                    throw new Error(`Consumer process did not become ready.\n${childError}`);
                }
            }

            async function waitUntilDatabaseLockWaits(): Promise<void> {
                const deadline = Date.now() + 15_000;
                while (Date.now() < deadline) {
                    const [activity] = await em.getConnection().execute<Array<{ waiting: string }>>(
                        `SELECT count(*)::text AS waiting
                         FROM pg_stat_activity
                         WHERE datname = current_database()
                           AND wait_event_type = 'Lock'
                           AND state = 'active'
                           AND query ILIKE '%wallet%'`,
                    );
                    if (Number(activity?.waiting ?? '0') > 0) return;
                    if (childClosed) throw new Error(`Consumer process exited early.\n${childError}`);
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                throw new Error('Consumer process did not block on the wallet lock before the deadline.');
            }

            await waitUntilReady();
            await waitUntilDatabaseLockWaits();
            expect(child.kill('SIGTERM')).toBe(true);
            await new Promise((resolve) => setTimeout(resolve, 250));
            expect(childClosed, `Consumer exited before the in-flight DB operation was released.\nstdout: ${childOutput}\nstderr: ${childError}`).toBe(false);

            releaseWalletLock();
            await lockTask;
            const exit = await Promise.race([
                childClose,
                new Promise<never>((_, reject) => setTimeout(() => reject(
                    new Error(`Consumer process did not exit after completing the message.\n${childError}`),
                ), 15_000)),
            ]);
            expect(exit.signal).toBe('SIGTERM');
            expect(exit.code).toBeNull();

            const persisted = await em.fork().find(WagerTransactionEntity, {
                externalTransactionId: envelope.data.externalTransactionId,
            });
            const balance = await wallets.getWallet(wallet.id);
            const inboxEntry = await inbox.find('wager-transaction-consumer', envelope.messageId, em.fork());
            expect(persisted).toHaveLength(1);
            expect(persisted[0]?.status).toBe(WagerTransactionStatus.PROCESSED);
            expect(balance.balance.toString()).toBe('83.00');
            expect(inboxEntry?.processedAt).toBeInstanceOf(Date);
            expect(await sqs.receiveMessages(source, 10, 0)).toHaveLength(0);
        } finally {
            releaseWalletLock();
            await lockTask.catch(() => undefined);
            if (childProcess && !childClosed) {
                childProcess.kill('SIGTERM');
                await Promise.race([childClose, new Promise((resolve) => setTimeout(resolve, 2000))]);
            }
        }
    });
});
