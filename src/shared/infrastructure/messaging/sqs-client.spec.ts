import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqsClient } from './sqs-client.js';

describe('SqsClient', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('signs SQS Query requests and decodes received message envelopes', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(`
            <ReceiveMessageResponse><ReceiveMessageResult><Message>
              <MessageId>message-1</MessageId>
              <ReceiptHandle>receipt-1</ReceiptHandle>
              <Body>{&quot;ok&quot;:true}</Body>
              <Attribute><Name>ApproximateReceiveCount</Name><Value>2</Value></Attribute>
            </Message></ReceiveMessageResult></ReceiveMessageResponse>
        `));
        vi.stubGlobal('fetch', fetchMock);
        const client = new SqsClient(new ConfigService({
            AWS_SQS_ENDPOINT: 'http://localhost:4566',
            AWS_ACCESS_KEY_ID: 'test',
            AWS_SECRET_ACCESS_KEY: 'test',
            AWS_ACCOUNT_ID: '000000000000',
            AWS_REGION: 'us-east-1',
        }));

        const messages = await client.receiveMessages('wager-transactions.fifo', 10, 1);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.toString()).toBe('http://localhost:4566/000000000000/wager-transactions.fifo');
        expect((init.headers as Record<string, string>).authorization).toContain('AWS4-HMAC-SHA256');
        expect(init.body).toContain('Action=ReceiveMessage');
        expect(messages).toEqual([{
            messageId: 'message-1',
            receiptHandle: 'receipt-1',
            body: '{"ok":true}',
            receiveCount: 2,
        }]);
    });

    it('changes message visibility and reads the queue depth for retry and DLQ monitoring', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('<ChangeMessageVisibilityResponse/>'))
            .mockResolvedValueOnce(new Response(`
                <GetQueueAttributesResponse><GetQueueAttributesResult>
                  <Attribute><Name>ApproximateNumberOfMessages</Name><Value>3</Value></Attribute>
                </GetQueueAttributesResult></GetQueueAttributesResponse>
            `));
        vi.stubGlobal('fetch', fetchMock);
        const client = new SqsClient(new ConfigService({
            AWS_SQS_ENDPOINT: 'http://localhost:4566',
            AWS_ACCESS_KEY_ID: 'test',
            AWS_SECRET_ACCESS_KEY: 'test',
            AWS_ACCOUNT_ID: '000000000000',
            AWS_REGION: 'us-east-1',
        }));

        await client.changeMessageVisibility('wager-transactions.fifo', 'receipt-1', 10);
        expect(await client.getApproximateMessageCount('wager-transactions-dlq.fifo')).toBe(3);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const visibilityRequest = fetchMock.mock.calls[0]![1] as RequestInit;
        const queueDepthRequest = fetchMock.mock.calls[1]![1] as RequestInit;
        expect(visibilityRequest.body).toContain('Action=ChangeMessageVisibility');
        expect(visibilityRequest.body).toContain('VisibilityTimeout=10');
        expect(queueDepthRequest.body).toContain('Action=GetQueueAttributes');
    });
});
