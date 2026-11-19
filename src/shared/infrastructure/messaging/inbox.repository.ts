import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { InboxMessageEntity } from './inbox-message.entity.js';
import { resolveEntityManager } from '../database/resolve-entity-manager.js';

/** Registra recebimentos e conclusão de mensagens dentro da transação chamadora. */
@Injectable()
export class InboxRepository {
    /** Define o manager padrão; o processamento deve fornecer seu manager transacional. */
    constructor(private readonly em: EntityManager) {}

    /** Procura o recebimento pelo par consumidor/ID da mensagem. */
    async find(consumerName: string, messageId: string, em?: EntityManager): Promise<InboxMessageEntity | null> {
        return resolveEntityManager(this.em, em).findOne(InboxMessageEntity, { consumerName, messageId });
    }

    /** Persiste o recebimento; a chave única também protege contra workers concorrentes. */
    async receive(
        consumerName: string,
        messageId: string,
        payloadHash: string,
        em: EntityManager = this.em,
    ): Promise<InboxMessageEntity> {
        const existing = await this.find(consumerName, messageId, em);
        if (existing) return existing;

        const message = em.create(InboxMessageEntity, {
            id: randomUUID(),
            consumerName,
            messageId,
            payloadHash,
            receivedAt: new Date(),
            processedAt: null,
        });
        em.persist(message);
        return message;
    }

    /** Marca a mensagem concluída na mesma transação das alterações financeiras. */
    async markProcessed(message: InboxMessageEntity, em: EntityManager = this.em): Promise<void> {
        message.processedAt = new Date();
        em.persist(message);
    }
}
