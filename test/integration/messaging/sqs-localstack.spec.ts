import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { SqsClient } from '../../../src/shared/infrastructure/messaging/sqs-client.js';

const localstackAvailable = process.env.SQS_INTEGRATION_TESTS === 'true';

describe.skipIf(!localstackAvailable)('SQS (LocalStack integration)', () => {
    const client = new SqsClient(new ConfigService({
        AWS_SQS_ENDPOINT: process.env.AWS_SQS_ENDPOINT ?? 'http://localhost:4566',
        AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
        AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID ?? '000000000000',
    }));

    it('creates a FIFO queue, sends, receives and acknowledges one message', async () => {
        const queueName = `wager-test-${randomUUID()}.fifo`;
        const eventId = randomUUID();
        const payload = JSON.stringify({ eventId, type: 'integration-test' });
        await client.createFifoQueue(queueName);
        try {
            await client.sendMessage(queueName, payload, randomUUID(), eventId);
            const received = await client.receiveMessages(queueName, 10, 2);
            const message = received.find(({ body }) => body === payload);
            expect(message).toBeDefined();
            await client.deleteMessage(queueName, message!.receiptHandle);
        } finally {
            await client.deleteQueue(queueName);
        }
    });
});
