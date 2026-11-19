import { HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { DatabaseUnitOfWork } from '../database/database-unit-of-work.js';
import { Money } from '../../domain/money.js';
import { WagerTransactionKind } from '../../../wagering/domain/wager-transaction.js';
import { ProcessWagerTransactionProps, WageringService } from '../../../wagering/wagering.service.js';
import { InboxRepository } from './inbox.repository.js';
import { ReceivedSqsMessage, SqsClient } from './sqs-client.js';
import { MetricsService } from '../observability/metrics.service.js';

const CONSUMER_NAME = 'wager-transaction-consumer';

/** Consome apostas com Inbox persistente e reconhece mensagens só após o commit. */
@Injectable()
export class WagerTransactionConsumer implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WagerTransactionConsumer.name);
    private readonly queueName: string;
    private readonly enabled: boolean;
    private active = false;
    private loop?: Promise<void>;

    /** Lê configuração de fila e injeta o mesmo caso de uso da entrada HTTP. */
    constructor(
        private readonly sqs: SqsClient,
        private readonly inbox: InboxRepository,
        private readonly wagering: WageringService,
        private readonly unitOfWork: DatabaseUnitOfWork,
        private readonly metrics: MetricsService,
        config: ConfigService,
    ) {
        this.queueName = config.get<string>('WAGER_TRANSACTIONS_QUEUE', 'wager-transactions.fifo') ?? 'wager-transactions.fifo';
        this.enabled = config.get<string>('SQS_CONSUMER_ENABLED', 'false') === 'true';
    }

    /** Inicia o polling somente quando SQS_CONSUMER_ENABLED está ativo. */
    onModuleInit(): void {
        if (!this.enabled) return;
        this.active = true;
        this.loop = this.poll();
    }

    /** Para novas consultas e aguarda o lote em andamento durante o encerramento. */
    async onModuleDestroy(): Promise<void> {
        this.active = false;
        await this.loop;
    }

    /** Recebe e processa um lote; também permite invocação controlada em testes reais. */
    async consumeBatch(): Promise<void> {
        const messages = await this.sqs.receiveMessages(this.queueName, 10, 20);
        await Promise.all(messages.map((message) => this.consume(message)));
    }

    /** Mantém long polling ativo e espera antes de nova tentativa após falha de transporte. */
    private async poll(): Promise<void> {
        while (this.active) {
            try {
                await this.consumeBatch();
            } catch (error) {
                this.logger.error(JSON.stringify({
                    event: 'sqs_receive_failed',
                    error: error instanceof Error ? error.message : 'Unknown error',
                }));
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }

    /** Deduplica no Inbox, processa na mesma UoW e aplica ack, retry ou redrive. */
    private async consume(message: ReceivedSqsMessage): Promise<void> {
        let request: ReturnType<WagerTransactionConsumer['parse']>;
        try {
            request = this.parse(message.body);
        } catch (error) {
            this.logger.error(JSON.stringify({
                event: 'wager_message_invalid',
                messageId: message.messageId,
                receiveCount: message.receiveCount,
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
            }));
            throw error;
        }
        const payloadHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
        try {
            await this.unitOfWork.execute(async (em) => {
                const prior = await this.inbox.find(CONSUMER_NAME, request.messageId, em);
                if (prior?.processedAt) {
                    if (prior.payloadHash !== payloadHash) throw new Error('Inbox message id was reused with a different payload.');
                    return;
                }

                const inboxEntry = prior ?? await this.inbox.receive(CONSUMER_NAME, request.messageId, payloadHash, em);
                await this.wagering.processTransaction(request.data, em);
                await this.inbox.markProcessed(inboxEntry, em);
                await em.flush();
            });
            await this.sqs.deleteMessage(this.queueName, message.receiptHandle);
        } catch (error) {
            // Se outro worker venceu a constraint única, consulta o estado confirmado
            // e dá ack somente se aquele processamento idêntico já terminou.
            if (error instanceof UniqueConstraintViolationException) {
                const existing = await this.inbox.find(CONSUMER_NAME, request.messageId);
                if (existing?.processedAt && existing.payloadHash === payloadHash) {
                    await this.sqs.deleteMessage(this.queueName, message.receiptHandle);
                    return;
                }
            }
            if (error instanceof HttpException && error.getStatus() < 500) {
                // Falhas de negócio são terminais: registra o Inbox e confirma sem redelivery.
                await this.unitOfWork.execute(async (transactionalEm) => {
                    const entry = await this.inbox.receive(CONSUMER_NAME, request.messageId, payloadHash, transactionalEm);
                    await this.inbox.markProcessed(entry, transactionalEm);
                    await transactionalEm.flush();
                });
                await this.sqs.deleteMessage(this.queueName, message.receiptHandle);
                return;
            }
            this.metrics.increment('sqs_message_retries_total');
            if (message.receiveCount >= 5) this.metrics.increment('sqs_messages_sent_to_dlq_total');
            this.logger.error(JSON.stringify({
                event: 'wager_message_processing_failed',
                messageId: request.messageId,
                transactionId: request.data.externalTransactionId,
                walletId: request.data.walletId,
                providerId: request.data.providerId,
                receiveCount: message.receiveCount,
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
            }));
            // Erro transitório: sem delete, o SQS devolve a mensagem após o visibility timeout.
        }
    }

    /** Valida envelope e campos externos antes de construir o comando do caso de uso. */
    private parse(body: string): { messageId: string; data: ProcessWagerTransactionProps } {
        const envelope: unknown = JSON.parse(body);
        if (!envelope || typeof envelope !== 'object') throw new Error('Invalid wager message envelope.');
        const value = envelope as Record<string, unknown>;
        if (value.type !== 'WagerTransactionRequested' || typeof value.messageId !== 'string' || !value.data || typeof value.data !== 'object') {
            throw new Error('Invalid wager message envelope.');
        }
        const data = value.data as Record<string, unknown>;
        const required = ['providerId', 'externalTransactionId', 'idempotencyKey', 'playerId', 'walletId', 'roundId', 'gameId'];
        for (const key of required) if (typeof data[key] !== 'string' || !data[key]) throw new Error(`Invalid message field: ${key}.`);
        if (data.kind === WagerTransactionKind.OPENING || !Object.values(WagerTransactionKind).includes(data.kind as WagerTransactionKind)) {
            throw new Error('Invalid external transaction kind.');
        }
        if (!data.money || typeof data.money !== 'object') throw new Error('Invalid money value.');
        const moneyData = data.money as Record<string, unknown>;
        if (typeof moneyData.amount !== 'string' || typeof moneyData.currency !== 'string') throw new Error('Invalid money value.');

        return {
            messageId: value.messageId,
            data: {
                providerId: data.providerId as string,
                externalTransactionId: data.externalTransactionId as string,
                idempotencyKey: data.idempotencyKey as string,
                playerId: data.playerId as string,
                walletId: data.walletId as string,
                roundId: data.roundId as string,
                gameId: data.gameId as string,
                kind: data.kind as Exclude<WagerTransactionKind, WagerTransactionKind.OPENING>,
                money: Money.from({ amount: moneyData.amount, currency: moneyData.currency }),
                ...(typeof data.referenceExternalTransactionId === 'string'
                    ? { referenceExternalTransactionId: data.referenceExternalTransactionId }
                    : {}),
            },
        };
    }
}
