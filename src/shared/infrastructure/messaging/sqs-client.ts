import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';

/** Mensagem recebida do SQS com o identificador de recebimento usado no ack. */
export interface ReceivedSqsMessage {
    /** ID atribuído pelo SQS, distinto do messageId do envelope de negócio. */
    messageId: string;
    /** Token da entrega atual necessário para excluir a mensagem após commit. */
    receiptHandle: string;
    /** Corpo bruto recebido, validado antes de criar o comando financeiro. */
    body: string;
    /** Número de entregas usado pela política de tentativas e DLQ. */
    receiveCount: number;
}

/** Política de redrive opcional usada para ligar uma fila FIFO à sua DLQ. */
export interface FifoQueueOptions {
    deadLetterTargetArn?: string;
    maxReceiveCount?: number;
}

/** Adaptador HTTP do protocolo SQS Query assinado com AWS Signature Version 4. */
@Injectable()
export class SqsClient {
    private readonly endpoint: string;
    private readonly region: string;
    private readonly accessKey: string;
    private readonly secretKey: string;
    private readonly accountId: string;

    /** Lê endpoint, região e credenciais da configuração da aplicação. */
    constructor(config: ConfigService) {
        this.endpoint = config.get<string>('AWS_SQS_ENDPOINT', '') ?? '';
        this.region = config.get<string>('AWS_REGION', 'us-east-1') ?? 'us-east-1';
        this.accessKey = config.get<string>('AWS_ACCESS_KEY_ID', 'test') ?? 'test';
        this.secretKey = config.get<string>('AWS_SECRET_ACCESS_KEY', 'test') ?? 'test';
        this.accountId = config.get<string>('AWS_ACCOUNT_ID', '000000000000') ?? '000000000000';
    }

    /** Publica em fila FIFO com grupo e chave explícita de deduplicação. */
    async sendMessage(queueName: string, body: string, groupId: string, deduplicationId: string): Promise<void> {
        await this.request(queueName, {
            Action: 'SendMessage',
            MessageBody: body,
            MessageGroupId: groupId,
            MessageDeduplicationId: deduplicationId,
        });
    }

    /** Cria uma fila FIFO sem deduplicação baseada no conteúdo. */
    async createFifoQueue(queueName: string, options: FifoQueueOptions = {}): Promise<void> {
        const attributes: Record<string, string> = {
            'Attribute.1.Name': 'FifoQueue',
            'Attribute.1.Value': 'true',
            'Attribute.2.Name': 'ContentBasedDeduplication',
            'Attribute.2.Value': 'false',
        };
        if (options.deadLetterTargetArn) {
            const maxReceiveCount = options.maxReceiveCount ?? 5;
            if (!Number.isInteger(maxReceiveCount) || maxReceiveCount < 1) {
                throw new RangeError('Maximum receive count must be a positive integer.');
            }
            attributes['Attribute.3.Name'] = 'RedrivePolicy';
            attributes['Attribute.3.Value'] = JSON.stringify({
                deadLetterTargetArn: options.deadLetterTargetArn,
                maxReceiveCount: String(maxReceiveCount),
            });
        }
        await this.request('', {
            Action: 'CreateQueue',
            QueueName: queueName,
            ...attributes,
        });
    }

    /** Lê a ARN retornada pelo broker para configurar uma fila de redrive. */
    async getQueueArn(queueName: string): Promise<string> {
        const xml = await this.request(queueName, {
            Action: 'GetQueueAttributes',
            'AttributeName.1': 'QueueArn',
        });
        const arn = this.attributeValue(xml, 'QueueArn') || this.xmlValue(xml, 'QueueArn');
        if (!arn) throw new Error('SQS returned an empty queue ARN.');
        return arn;
    }

    /** Exclui a fila pelo nome, normalmente usado apenas por ambientes de teste. */
    async deleteQueue(queueName: string): Promise<void> {
        await this.request(queueName, { Action: 'DeleteQueue' });
    }

    /** Recebe um lote e inclui a contagem de entregas para política de retry/DLQ. */
    async receiveMessages(queueName: string, maxMessages = 10, waitSeconds = 20): Promise<ReceivedSqsMessage[]> {
        const xml = await this.request(queueName, {
            Action: 'ReceiveMessage',
            MaxNumberOfMessages: String(maxMessages),
            WaitTimeSeconds: String(waitSeconds),
            VisibilityTimeout: '30',
            'AttributeName.1': 'ApproximateReceiveCount',
        });
        return [...xml.matchAll(/<Message>([\s\S]*?)<\/Message>/g)].map(([, messageXml]) => ({
            messageId: this.xmlValue(messageXml!, 'MessageId'),
            receiptHandle: this.xmlValue(messageXml!, 'ReceiptHandle'),
            body: this.xmlValue(messageXml!, 'Body'),
            receiveCount: Number(this.attributeValue(messageXml!, 'ApproximateReceiveCount') || 1),
        }));
    }

    /** Confirma o consumo removendo a mensagem pelo receipt handle da entrega atual. */
    async deleteMessage(queueName: string, receiptHandle: string): Promise<void> {
        await this.request(queueName, { Action: 'DeleteMessage', ReceiptHandle: receiptHandle });
    }

    /** Altera a visibilidade para aplicar backoff persistente entre redeliveries. */
    async changeMessageVisibility(queueName: string, receiptHandle: string, timeoutSeconds: number): Promise<void> {
        if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 43_200) {
            throw new RangeError('Visibility timeout must be an integer between 0 and 43200 seconds.');
        }
        await this.request(queueName, {
            Action: 'ChangeMessageVisibility',
            ReceiptHandle: receiptHandle,
            VisibilityTimeout: String(timeoutSeconds),
        });
    }

    /** Verifica disponibilidade e existência da fila sem propagar falhas do broker. */
    async isReachable(queueName: string): Promise<boolean> {
        try {
            await this.request(queueName, { Action: 'GetQueueAttributes', 'AttributeName.1': 'QueueArn' });
            return true;
        } catch {
            return false;
        }
    }

    /** Consulta a quantidade aproximada de mensagens visíveis em uma fila. */
    async getApproximateMessageCount(queueName: string): Promise<number> {
        const xml = await this.request(queueName, {
            Action: 'GetQueueAttributes',
            'AttributeName.1': 'ApproximateNumberOfMessages',
        });
        const count = Number(this.attributeValue(xml, 'ApproximateNumberOfMessages')
            || this.xmlValue(xml, 'ApproximateNumberOfMessages'));
        if (!Number.isInteger(count) || count < 0) throw new Error('SQS returned an invalid approximate message count.');
        return count;
    }

    /** Monta URL local ou AWS para a fila configurada. */
    private queueUrl(name: string): URL {
        const endpoint = this.endpoint.replace(/\/$/, '');
        if (endpoint) return new URL(`${endpoint}/${this.accountId}/${name}`);
        return new URL(`https://sqs.${this.region}.amazonaws.com/${this.accountId}/${name}`);
    }

    /** Envia uma operação SQS Query e rejeita respostas HTTP ou XML de erro. */
    private async request(queueName: string, params: Record<string, string>): Promise<string> {
        const url = queueName ? this.queueUrl(queueName) : new URL(this.endpoint || `https://sqs.${this.region}.amazonaws.com`);
        const body = new URLSearchParams({ Version: '2012-11-05', ...params }).toString();
        const now = new Date();
        const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
        const date = amzDate.slice(0, 8);
        const payloadHash = createHash('sha256').update(body).digest('hex');
        const canonicalHeaders = `content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
        const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
        const canonicalRequest = ['POST', url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
        const scope = `${date}/${this.region}/sqs/aws4_request`;
        const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
        const signingKey = this.signingKey(date);
        const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
        const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
                'x-amz-date': amzDate,
                'x-amz-content-sha256': payloadHash,
                authorization,
            },
            body,
            signal: AbortSignal.timeout(params.Action === 'ReceiveMessage' ? 25_000 : 10_000),
        });
        const text = await response.text();
        if (!response.ok || /<ErrorResponse>/.test(text)) {
            throw new Error(`SQS ${params.Action} failed with HTTP ${response.status}.`);
        }
        return text;
    }

    /** Deriva a chave diária AWS4 para assinatura do serviço SQS na região atual. */
    private signingKey(date: string): Buffer {
        const dateKey = createHmac('sha256', `AWS4${this.secretKey}`).update(date).digest();
        const regionKey = createHmac('sha256', dateKey).update(this.region).digest();
        const serviceKey = createHmac('sha256', regionKey).update('sqs').digest();
        return createHmac('sha256', serviceKey).update('aws4_request').digest();
    }

    /** Extrai e decodifica o conteúdo de uma tag XML simples retornada pelo SQS. */
    private xmlValue(xml: string, name: string): string {
        const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
        return (match?.[1] ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    }

    /** Localiza um atributo SQS pelo nome dentro do XML de uma mensagem. */
    private attributeValue(xml: string, name: string): string {
        const attribute = [...xml.matchAll(/<Attribute>([\s\S]*?)<\/Attribute>/g)]
            .find(([, block]) => this.xmlValue(block!, 'Name') === name);
        return attribute ? this.xmlValue(attribute[1]!, 'Value') : '';
    }
}
