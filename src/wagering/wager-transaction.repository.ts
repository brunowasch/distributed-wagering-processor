import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from './domain/wager-transaction.js';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper.js';
import { Money } from '../shared/domain/money.js';
import { resolveEntityManager } from '../shared/infrastructure/database/resolve-entity-manager.js';

/** Persistência de transações, idempotência, referências e agenda de retries. */
@Injectable()
export class WagerTransactionRepository {
    /** Define o EntityManager padrão, substituível pelo contexto transacional da chamada. */
    constructor(private readonly em: EntityManager) {}

    /** Busca por identificador interno e converte a entidade para o domínio. */
    async findById(id: string, em?: EntityManager): Promise<WagerTransaction | null> {
        const entity = await resolveEntityManager(this.em, em).findOne(WagerTransactionEntity, { id });
        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    /** Resolve o identificador externo dentro do escopo do provedor. */
    async findByProviderAndExternalId(
        providerId: string,
        externalTransactionId: string,
        em?: EntityManager,
    ): Promise<WagerTransaction | null> {
        const entity = await resolveEntityManager(this.em, em).findOne(WagerTransactionEntity, {
            providerId,
            externalTransactionId,
        });

        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    /** Consulta a chave de idempotência persistida no banco. */
    async findByIdempotencyKey(
        idempotencyKey: string,
        em?: EntityManager,
    ): Promise<WagerTransaction | null> {
        const entity = await resolveEntityManager(this.em, em).findOne(WagerTransactionEntity, { idempotencyKey });
        return entity ? WagerTransactionMapper.toDomain(entity) : null;
    }

    /** Insere a transação e, quando disponível, o saldo original retornado em futuros replays. */
    async create(
        transaction: WagerTransaction,
        em: EntityManager = this.em,
        resultBalance?: Money,
    ): Promise<void> {
        const entity = WagerTransactionMapper.toEntity(transaction);
        if (resultBalance) {
            entity.resultBalanceAmount = resultBalance.toString();
            entity.resultBalanceCurrency = resultBalance.getCurrency();
        }
        if (transaction.status === WagerTransactionStatus.PENDING_REFERENCE) {
            entity.nextReferenceAttemptAt = new Date(Date.now() + 1000);
        }
        em.persist(entity);
    }

    /** Recupera o saldo associado à resposta original da transação. */
    async findResultBalance(id: string, em?: EntityManager): Promise<Money | null> {
        const entity = await resolveEntityManager(this.em, em).findOne(WagerTransactionEntity, { id });
        return entity?.resultBalanceAmount && entity.resultBalanceCurrency
            ? Money.from({ amount: entity.resultBalanceAmount, currency: entity.resultBalanceCurrency })
            : null;
    }

    /** Verifica reversão confirmada; a constraint única do banco protege corridas entre instâncias. */
    async hasProcessedReversal(
        referenceTransactionId: string,
        kind: WagerTransactionKind,
        em?: EntityManager,
    ): Promise<boolean> {
        return (await resolveEntityManager(this.em, em).count(WagerTransactionEntity, {
            referenceTransactionId,
            kind,
            status: WagerTransactionStatus.PROCESSED,
        })) > 0;
    }

    /** Carrega referências pendentes cujo próximo instante de backoff já venceu. */
    async findDuePendingReferences(now: Date, limit: number, em?: EntityManager): Promise<WagerTransaction[]> {
        // Workers não possuem contexto HTTP; usam fork para manter Identity Map isolado.
        const manager = resolveEntityManager(this.em, em);
        const entities = await manager.find(WagerTransactionEntity, {
            status: WagerTransactionStatus.PENDING_REFERENCE,
            $or: [
                { nextReferenceAttemptAt: null },
                { nextReferenceAttemptAt: { $lte: now } },
            ],
        }, { orderBy: { createdAt: 'ASC', id: 'ASC' }, limit });
        return entities.map((entity) => WagerTransactionMapper.toDomain(entity));
    }

    /** Lista transações processadas para conferir sua correspondência com o ledger. */
    async findProcessedByWalletId(walletId: string, em?: EntityManager): Promise<WagerTransaction[]> {
        const entities = await resolveEntityManager(this.em, em).find(WagerTransactionEntity, {
            walletId,
            status: WagerTransactionStatus.PROCESSED,
        }, { orderBy: { createdAt: 'ASC', id: 'ASC' } });
        return entities.map((entity) => WagerTransactionMapper.toDomain(entity));
    }

    /** Incrementa tentativas e persiste o próximo instante de retry exponencial. */
    async scheduleReferenceRetry(id: string, now: Date, em: EntityManager): Promise<number> {
        const entity = await em.findOneOrFail(WagerTransactionEntity, { id });
        entity.referenceAttempts += 1;
        const delayMs = Math.min(1000 * (2 ** Math.min(entity.referenceAttempts, 10)), 15 * 60 * 1000);
        entity.nextReferenceAttemptAt = new Date(now.getTime() + delayMs);
        return entity.referenceAttempts;
    }

    /** Atualiza apenas estado, referência, falha e saldo do resultado persistido. */
    async update(transaction: WagerTransaction, em: EntityManager = this.em, resultBalance?: Money): Promise<void> {
        const entity = await em.findOneOrFail(WagerTransactionEntity, {
            id: transaction.id,
        });

        em.assign(entity, {
            status: transaction.status,
            referenceTransactionId: transaction.referenceTransactionId ?? null,
            failureCode: transaction.failureCode ?? null,
            processedAt: transaction.processedAt ?? null,
            ...(resultBalance ? {
                resultBalanceAmount: resultBalance.toString(),
                resultBalanceCurrency: resultBalance.getCurrency(),
            } : {}),
            ...(transaction.status !== WagerTransactionStatus.PENDING_REFERENCE ? { nextReferenceAttemptAt: null } : {}),
        });
    }
}
