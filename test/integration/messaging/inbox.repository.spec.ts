import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../../../src/app.module.js';
import { DatabaseUnitOfWork } from '../../../src/shared/infrastructure/database/database-unit-of-work.js';
import { InboxMessageEntity } from '../../../src/shared/infrastructure/messaging/inbox-message.entity.js';
import { InboxRepository } from '../../../src/shared/infrastructure/messaging/inbox.repository.js';

describe('InboxRepository (PostgreSQL integration)', () => {
    let module: TestingModule;
    let em: EntityManager;
    let unitOfWork: DatabaseUnitOfWork;
    let inbox: InboxRepository;
    const messageIds: string[] = [];

    beforeAll(async () => {
        module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        em = module.get(EntityManager);
        unitOfWork = module.get(DatabaseUnitOfWork);
        inbox = module.get(InboxRepository);
    });

    afterEach(async () => {
        if (messageIds.length) await em.fork().nativeDelete(InboxMessageEntity, { messageId: { $in: [...messageIds] } });
        messageIds.length = 0;
    });

    afterAll(async () => module?.close());

    it('deduplicates a redelivery by consumer and message ID', async () => {
        const messageId = randomUUID();
        messageIds.push(messageId);
        const writeEm = em.fork();
        const first = await inbox.receive('integration-consumer', messageId, 'sha256-payload', writeEm);
        first.processedAt = new Date();
        await writeEm.flush();

        const replayEm = em.fork();
        const replay = await inbox.receive('integration-consumer', messageId, 'sha256-payload', replayEm);

        expect(replay.id).toBe(first.id);
        expect(replay.processedAt).toEqual(first.processedAt);
        expect(await replayEm.count(InboxMessageEntity, { consumerName: 'integration-consumer', messageId })).toBe(1);
    });

    it('rolls back inbox receipt when the financial unit of work fails', async () => {
        const messageId = randomUUID();
        messageIds.push(messageId);

        await expect(unitOfWork.execute(async (transactionalEm) => {
            await inbox.receive('integration-consumer', messageId, 'sha256-payload', transactionalEm);
            await transactionalEm.flush();
            throw new Error('simulated financial failure');
        })).rejects.toThrow('simulated financial failure');

        expect(await inbox.find('integration-consumer', messageId, em.fork())).toBeNull();
    });
});
