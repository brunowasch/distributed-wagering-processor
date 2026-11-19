import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { OutboxMessageEntity } from './outbox-message.entity.js';
import { resolveEntityManager } from '../database/resolve-entity-manager.js';

/** Campos mínimos para armazenar um evento de integração ainda não publicado. */
export interface EnqueueOutboxMessage {
    /** ID estável do envelope; se omitido, um UUID é criado. */
    eventId?: string;
    /** ID do agregado usado como grupo FIFO. */
    aggregateId: string;
    /** Nome versionável do evento de integração. */
    eventType: string;
    /** Envelope serializável que será enviado ao SQS. */
    payload: Record<string, unknown>;
    /** Instante em que o evento de domínio ocorreu. */
    occurredAt?: Date;
}

/** Persistência de eventos com claim temporário para coordenação entre publishers. */
@Injectable()
export class OutboxRepository {
    /** Recebe o manager padrão; os eventos do negócio devem usar o manager transacional. */
    constructor(private readonly em: EntityManager) {}

    /** Armazena o envelope do evento para publicação após o commit financeiro. */
    async enqueue(event: EnqueueOutboxMessage, em: EntityManager = this.em): Promise<OutboxMessageEntity> {
        const message = em.create(OutboxMessageEntity, {
            id: randomUUID(),
            eventId: event.eventId ?? randomUUID(),
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            payload: event.payload,
            occurredAt: event.occurredAt ?? new Date(),
            attempts: 0,
            nextAttemptAt: null,
            publishedAt: null,
        });
        em.persist(message);
        return message;
    }

    /** Consulta eventos não publicados cujo próximo retry já venceu. */
    async findDue(
        now: Date,
        limit: number,
        em: EntityManager = this.em,
        claim = false,
        aggregateId?: string,
    ): Promise<OutboxMessageEntity[]> {
        return resolveEntityManager(this.em, em).find(OutboxMessageEntity, {
            publishedAt: null,
            $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
            ...(aggregateId ? { aggregateId } : {}),
        }, {
            orderBy: { occurredAt: 'ASC' },
            limit,
            ...(claim ? { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE } : {}),
        });
    }

    /** Reserva eventos com lock e lease, permitindo concorrência e retomada após crash. */
    async claimDue(
        now: Date,
        leaseUntil: Date,
        limit: number,
        em: EntityManager = this.em,
        aggregateId?: string,
    ): Promise<OutboxMessageEntity[]> {
        const messages = await this.findDue(now, limit, em, true, aggregateId);
        for (const message of messages) message.nextAttemptAt = leaseUntil;
        return messages;
    }

    /** Marca como publicado depois que o broker confirmou o envio. */
    async markPublished(message: OutboxMessageEntity, publishedAt = new Date(), em: EntityManager = this.em): Promise<void> {
        message.publishedAt = publishedAt;
        em.persist(message);
    }

    /** Carrega e marca um evento publicado pelo seu ID persistido. */
    async markPublishedById(id: string, publishedAt = new Date(), em: EntityManager = this.em): Promise<void> {
        const message = await em.findOneOrFail(OutboxMessageEntity, { id });
        await this.markPublished(message, publishedAt, em);
    }

    /** Agenda novo envio pelo ID após falha do publisher. */
    async scheduleRetryById(id: string, now = new Date(), em: EntityManager = this.em): Promise<void> {
        const message = await em.findOneOrFail(OutboxMessageEntity, { id });
        await this.scheduleRetry(message, now, em);
    }

    /** Incrementa tentativas e calcula backoff exponencial limitado. */
    async scheduleRetry(message: OutboxMessageEntity, now = new Date(), em: EntityManager = this.em): Promise<void> {
        message.attempts += 1;
        const delayMs = Math.min(1000 * (2 ** Math.min(message.attempts, 10)), 15 * 60 * 1000);
        message.nextAttemptAt = new Date(now.getTime() + delayMs);
        em.persist(message);
    }
}
