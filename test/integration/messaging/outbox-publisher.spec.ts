import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../../src/app.module.js';
import { DatabaseUnitOfWork } from '../../../src/shared/infrastructure/database/database-unit-of-work.js';
import { MetricsService } from '../../../src/shared/infrastructure/observability/metrics.service.js';
import { OutboxMessageEntity } from '../../../src/shared/infrastructure/messaging/outbox-message.entity.js';
import { OutboxPublisher } from '../../../src/shared/infrastructure/messaging/outbox-publisher.js';
import { OutboxRepository } from '../../../src/shared/infrastructure/messaging/outbox.repository.js';

describe('OutboxPublisher (PostgreSQL integration)', () => {
    let module: TestingModule;
    let em: EntityManager;
    let outbox: OutboxRepository;
    let unitOfWork: DatabaseUnitOfWork;
    const messageIds: string[] = [];

    beforeAll(async () => {
        module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        em = module.get(EntityManager);
        outbox = module.get(OutboxRepository);
        unitOfWork = module.get(DatabaseUnitOfWork);
    });

    afterEach(async () => {
        if (messageIds.length) await em.fork().nativeDelete(OutboxMessageEntity, { id: { $in: [...messageIds] } });
        messageIds.length = 0;
    });

    afterAll(async () => module?.close());

    async function enqueue() {
        const eventId = randomUUID();
        const emWriter = em.fork();
        const item = await outbox.enqueue({
            eventId,
            aggregateId: randomUUID(),
            eventType: 'IntegrationTestEvent',
            payload: { eventId },
        }, emWriter);
        await emWriter.flush();
        messageIds.push(item.id);
        return item;
    }

    function publisher(sendMessage: ReturnType<typeof vi.fn>) {
        return new OutboxPublisher(
            outbox,
            unitOfWork,
            { sendMessage } as never,
            module.get(MetricsService),
            new ConfigService({ OUTBOX_PUBLISHER_ENABLED: 'false' }),
        );
    }

    it('marks an event published only after the SQS send succeeds', async () => {
        const item = await enqueue();
        const sendMessage = vi.fn().mockResolvedValue(undefined);

        await publisher(sendMessage).publishBatch(10, item.aggregateId);

        expect(sendMessage).toHaveBeenCalledWith(
            'wager-events.fifo',
            JSON.stringify(item.payload),
            item.aggregateId,
            item.eventId,
        );
        const persisted = await em.fork().findOneOrFail(OutboxMessageEntity, { id: item.id });
        expect(persisted.publishedAt).toBeInstanceOf(Date);
        expect(persisted.attempts).toBe(0);
    });

    it('schedules a retry after a transient SQS failure', async () => {
        const item = await enqueue();
        const sendMessage = vi.fn().mockRejectedValue(new Error('SQS unavailable'));

        await publisher(sendMessage).publishBatch(10, item.aggregateId);

        const persisted = await em.fork().findOneOrFail(OutboxMessageEntity, { id: item.id });
        expect(persisted.publishedAt).toBeNull();
        expect(persisted.attempts).toBe(1);
        expect(persisted.nextAttemptAt).toBeInstanceOf(Date);
        expect(persisted.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('claims a pending row once when two publishers run concurrently', async () => {
        const item = await enqueue();
        let releaseSend!: () => void;
        const blocked = new Promise<void>((resolve) => { releaseSend = resolve; });
        const sendMessage = vi.fn().mockImplementation(() => blocked);
        const first = publisher(sendMessage).publishBatch(10, item.aggregateId);
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
        await publisher(sendMessage).publishBatch(10, item.aggregateId);
        releaseSend();
        await first;

        expect(sendMessage).toHaveBeenCalledTimes(1);
        const persisted = await em.fork().findOneOrFail(OutboxMessageEntity, { id: item.id });
        expect(persisted.publishedAt).toBeInstanceOf(Date);
    });
});
