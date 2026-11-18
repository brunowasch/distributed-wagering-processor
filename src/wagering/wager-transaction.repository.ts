import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransaction } from './domain/wager-transaction.js';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper.js';

@Injectable()
export class WagerTransactionRepository {
    constructor(private readonly em: EntityManager) {}

    // Permite executar consultas usando o EntityManager padrão ou um transacional.
    async findById(id: string, em: EntityManager = this.em): Promise<WagerTransaction | null> {
        const entity = await em.findOne(WagerTransactionEntity, { id });
        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    // Busca uma transação pela identificação fornecida pelo provedor.
    async findByProviderAndExternalId(
        providerId: string,
        externalTransactionId: string,
        em: EntityManager = this.em,
    ): Promise<WagerTransaction | null> {
        const entity = await em.findOne(WagerTransactionEntity, {
            providerId,
            externalTransactionId,
        });

        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    // Busca uma transação pela chave utilizada para garantir idempotência.
    async findByIdempotencyKey(
        idempotencyKey: string,
        em: EntityManager = this.em,
    ): Promise<WagerTransaction | null> {
        const entity = await em.findOne(WagerTransactionEntity, { idempotencyKey });
        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    // Registra uma nova transação sem executar o commit.
    async create(transaction: WagerTransaction, em: EntityManager = this.em): Promise<void> {
        const entity = WagerTransactionMapper.toEntity(transaction);
        em.persist(entity);
    }

    // Atualiza somente os campos mutáveis da transação persistida.
    async update(transaction: WagerTransaction, em: EntityManager = this.em): Promise<void> {
        const entity = await em.findOneOrFail(WagerTransactionEntity, {
            id: transaction.id,
        });

        em.assign(entity, {
            status: transaction.status,
            referenceTransactionId: transaction.referenceTransactionId ?? null,
            failureCode: transaction.failureCode ?? null,
            processedAt: transaction.processedAt ?? null,
        });
    }
}
