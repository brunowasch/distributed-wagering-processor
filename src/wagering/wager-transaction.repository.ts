import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransaction } from './domain/wager-transaction.js';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper.js';

@Injectable()
export class WagerTransactionRepository {
    constructor(
        private readonly em: EntityManager,
    ) {}

    // Busca uma transação pelo identificador interno.
    async findById(id: string): Promise<WagerTransaction | null> {
        const entity = await this.em.findOne(WagerTransactionEntity, { id });

        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    // Busca uma transação pela identificação fornecida pelo provedor.
    async findByProviderAndExternalId(
        providerId: string,
        externalTransactionId: string,
    ): Promise<WagerTransaction | null> {
        const entity = await this.em.findOne(WagerTransactionEntity, {
            providerId,
            externalTransactionId,
        });

        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    // Busca uma transação pela chave utilizada para garantir idempotência.
    async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
        const entity = await this.em.findOne(WagerTransactionEntity, {
            idempotencyKey,
        });

        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    // Persiste uma nova transação sem executar o commit da transação SQL.
    async create(transaction: WagerTransaction): Promise<void> {
        const entity = WagerTransactionMapper.toEntity(transaction);

        this.em.persist(entity);
    }

    // Atualiza uma transação já persistida.
    async update(transaction: WagerTransaction): Promise<void> {
        const entity = await this.em.findOneOrFail(WagerTransactionEntity, {
            id: transaction.id,
        });

        this.em.assign(entity, {
            status: transaction.status,
            referenceTransactionId: transaction.referenceTransactionId ?? null,
            failureCode: transaction.failureCode ?? null,
            processedAt: transaction.processedAt ?? null,
        });
    }
}
