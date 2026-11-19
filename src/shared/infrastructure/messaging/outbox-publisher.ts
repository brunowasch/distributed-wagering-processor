import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseUnitOfWork } from '../database/database-unit-of-work.js';
import { OutboxRepository } from './outbox.repository.js';
import { SqsClient } from './sqs-client.js';
import { MetricsService } from '../observability/metrics.service.js';

/** Dados mínimos de um evento Outbox já reservado para publicação. */
interface ClaimedMessage {
    id: string;
    aggregateId: string;
    eventId: string;
    occurredAt: Date;
    payload: Record<string, unknown>;
}

/** Publica eventos confirmados na Outbox com leases, retries e encerramento coordenado. */
@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(OutboxPublisher.name);
    private readonly queueName: string;
    private readonly pollIntervalMs: number;
    private readonly enabled: boolean;
    private timer?: ReturnType<typeof setInterval>;
    private running = false;
    private activeRun?: Promise<void>;

    /** Carrega opções de fila/polling e injeta persistência, transporte e métricas. */
    constructor(
        private readonly outbox: OutboxRepository,
        private readonly unitOfWork: DatabaseUnitOfWork,
        private readonly sqs: SqsClient,
        private readonly metrics: MetricsService,
        config: ConfigService,
    ) {
        this.queueName = config.get<string>('WAGER_EVENTS_QUEUE', 'wager-events.fifo') ?? 'wager-events.fifo';
        this.pollIntervalMs = Number(config.get<string>('OUTBOX_POLL_INTERVAL_MS', '1000'));
        this.enabled = config.get<string>('OUTBOX_PUBLISHER_ENABLED', 'false') === 'true';
    }

    /** Agenda polling periódico somente quando o publisher está habilitado. */
    onModuleInit(): void {
        if (!this.enabled) return;
        this.timer = setInterval(() => {
            if (this.running) return;
            this.running = true;
            this.activeRun = this.publishBatch().catch((error: unknown) => {
                this.logger.error(JSON.stringify({
                    event: 'outbox_batch_failed',
                    errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
                }));
            }).finally(() => { this.running = false; });
        }, this.pollIntervalMs);
        this.timer.unref?.();
    }

    /** Cancela o timer e aguarda o lote atualmente em execução. */
    async onModuleDestroy(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        await this.activeRun;
    }

    /** Reserva e publica um lote vencido; também permite execução controlada em testes. */
    async publishBatch(limit = 10, aggregateId?: string): Promise<void> {
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + 60_000);
        const messages = await this.unitOfWork.execute(async (em) => {
            const claimed = await this.outbox.claimDue(now, leaseUntil, limit, em, aggregateId);
            await em.flush();
            return claimed.map(({ id, aggregateId, eventId, occurredAt, payload }) => ({ id, aggregateId, eventId, occurredAt, payload }));
        });

        const oldest = messages.reduce((date, message) => message.occurredAt < date ? message.occurredAt : date, now);
        this.metrics.set('outbox_lag_seconds', messages.length ? Math.max(0, (now.getTime() - oldest.getTime()) / 1000) : 0);

        for (const message of messages) await this.publishOne(message);
    }

    /** Envia um evento e marca sucesso; falhas persistem uma nova data de retry. */
    private async publishOne(message: ClaimedMessage): Promise<void> {
        try {
            await this.sqs.sendMessage(
                this.queueName,
                JSON.stringify(message.payload),
                message.aggregateId,
                message.eventId,
            );
            await this.unitOfWork.execute((em) => this.outbox.markPublishedById(message.id, new Date(), em));
        } catch (error) {
            this.metrics.increment('outbox_publish_retries_total');
            this.logger.error(JSON.stringify({
                event: 'outbox_publish_failed',
                eventId: message.eventId,
                aggregateId: message.aggregateId,
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
            }));
            await this.unitOfWork.execute((em) => this.outbox.scheduleRetryById(message.id, new Date(), em));
        }
    }
}
