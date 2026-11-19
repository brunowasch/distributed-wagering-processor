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
import { PermanentWageringProcessingError } from '../../../wagering/permanent-processing-failure.js';

const CONSUMER_NAME = 'wager-transaction-consumer';

/** Consome apostas com Inbox persistente e reconhece mensagens só após o commit. */
@Injectable()
export class WagerTransactionConsumer implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WagerTransactionConsumer.name);
    private readonly queueName: string;
    private readonly deadLetterQueueName: string;
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
        this.deadLetterQueueName = config.get<string>('WAGER_TRANSACTIONS_DLQ_QUEUE', 'wager-transactions-dlq.fifo') ?? 'wager-transactions-dlq.fifo';
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
        // Aguarda todas as mensagens, mesmo que uma delas seja inválida. Isso impede
        // lotes sobrepostos e garante que o shutdown espere todo o trabalho iniciado.
        const results = await Promise.allSettled(messages.map((message) => this.consume(message)));
        for (const result of results) {
            if (result.status === 'rejected') {
                this.logger.error(JSON.stringify({
                    event: 'sqs_message_consume_failed',
                    errorType: result.reason instanceof Error ? result.reason.constructor.name : 'UnknownError',
                }));
            }
        }
        await this.updateDeadLetterMetric();
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
            await this.deferForRetry(message);
            throw error;
        }
        const payloadHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
        try {
            const permanentlyFailed = await this.unitOfWork.execute(async (em) => {
                const prior = await this.inbox.find(CONSUMER_NAME, request.messageId, em);
                if (prior?.processedAt) {
                    if (prior.payloadHash !== payloadHash) throw new Error('Inbox message id was reused with a different payload.');
                    return false;
                }

                const inboxEntry = prior ?? await this.inbox.receive(CONSUMER_NAME, request.messageId, payloadHash, em);
                const result = await this.wagering.processTransaction(request.data, em);
                if (result.status === 'FAILED') {
                    // FAILED é durável e terminal no banco, mas a entrega deve seguir
                    // para a DLQ após o limite configurado pelo broker, sem ACK aqui.
                    await em.flush();
                    return true;
                }
                await this.inbox.markProcessed(inboxEntry, em);
                await em.flush();
                return false;
            });
            if (permanentlyFailed) {
                await this.deferForRetry(message);
                return;
            }
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
            if (error instanceof PermanentWageringProcessingError) {
                // A UoW anterior já sofreu rollback. FAILED e o recebimento Inbox são
                // gravados juntos numa UoW nova; a mensagem fica sem ACK para ir à DLQ.
                try {
                    await this.unitOfWork.execute(async (transactionalEm) => {
                        await this.wagering.recordPermanentFailure(
                            request.data,
                            transactionalEm,
                            error.failureCode,
                        );
                        await this.inbox.receive(CONSUMER_NAME, request.messageId, payloadHash, transactionalEm);
                        await transactionalEm.flush();
                    });
                } catch (persistenceError) {
                    this.logger.error(JSON.stringify({
                        event: 'wager_permanent_failure_persist_failed',
                        messageId: request.messageId,
                        transactionId: request.data.externalTransactionId,
                        walletId: request.data.walletId,
                        providerId: request.data.providerId,
                        receiveCount: message.receiveCount,
                        errorType: persistenceError instanceof Error ? persistenceError.constructor.name : 'UnknownError',
                    }));
                    await this.deferForRetry(message);
                    return;
                }
                await this.deferForRetry(message);
                return;
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
            this.logger.error(JSON.stringify({
                event: 'wager_message_processing_failed',
                messageId: request.messageId,
                transactionId: request.data.externalTransactionId,
                walletId: request.data.walletId,
                providerId: request.data.providerId,
                receiveCount: message.receiveCount,
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
            }));
            await this.deferForRetry(message);
            // A mensagem continua na fila e volta a ficar visível após o backoff.
        }
    }

    /** Aumenta a espera exponencialmente até o redrive policy encaminhar à DLQ. */
    private async deferForRetry(message: ReceivedSqsMessage): Promise<void> {
        this.metrics.increment('sqs_message_retries_total');
        const delaySeconds = Math.min(5 * (2 ** Math.max(0, message.receiveCount - 1)), 30);
        try {
            await this.sqs.changeMessageVisibility(this.queueName, message.receiptHandle, delaySeconds);
        } catch (error) {
            this.logger.error(JSON.stringify({
                event: 'sqs_visibility_update_failed',
                messageId: message.messageId,
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
            }));
        }
    }

    /** Atualiza o gauge a partir da fila DLQ, sem inferir envio pelo receive count. */
    private async updateDeadLetterMetric(): Promise<void> {
        try {
            const count = await this.sqs.getApproximateMessageCount(this.deadLetterQueueName);
            this.metrics.set('sqs_dlq_visible_messages', count);
        } catch (error) {
            this.logger.error(JSON.stringify({
                event: 'sqs_dlq_metric_update_failed',
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
            }));
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
