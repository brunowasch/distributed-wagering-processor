import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.js';
import { resolveEntityManager } from '../../shared/infrastructure/database/resolve-entity-manager.js';

/** Persiste e consulta os lançamentos financeiros das carteiras. */
@Injectable()
export class WalletLedgerEntryRepository {
    /** Recebe o EntityManager padrão para consultas fora de uma unidade de trabalho explícita. */
    constructor(private readonly em: EntityManager) {}

    /** Insere um lançamento; constraints do banco garantem unicidade e consistência. */
    async create(
        entry: WalletLedgerEntry,
        em: EntityManager = this.em,
    ): Promise<void> {
        em.persist(WalletLedgerEntryMapper.toEntity(entry));
    }

    /** Busca o lançamento da transação dentro da carteira informada. */
    async findByTransactionId(
        walletId: string,
        transactionId: string,
        em?: EntityManager,
    ): Promise<WalletLedgerEntry | null> {
        const entity = await resolveEntityManager(this.em, em).findOne(WalletLedgerEntryEntity, {
            walletId,
            transactionId,
        });

        return entity ? WalletLedgerEntryMapper.toDomain(entity) : null;
    }

    /** Retorna uma página estável por (createdAt, id), sem paginação por OFFSET. */
    async findPage(
        walletId: string,
        limit: number,
        cursor?: { createdAt: Date; id: string },
        em?: EntityManager,
    ): Promise<WalletLedgerEntry[]> {
        const where = cursor
            ? {
                walletId,
                $or: [
                    { createdAt: { $lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { $lt: cursor.id } },
                ],
            }
            : { walletId };
        const entities = await resolveEntityManager(this.em, em).find(WalletLedgerEntryEntity, where, {
            orderBy: { createdAt: 'DESC', id: 'DESC' },
            limit,
        });
        return entities.map((entity) => WalletLedgerEntryMapper.toDomain(entity));
    }

    /** Lê o histórico completo em ordem cronológica para a reconciliação. */
    async findAllByWalletId(walletId: string, em?: EntityManager): Promise<WalletLedgerEntry[]> {
        const entities = await resolveEntityManager(this.em, em).find(WalletLedgerEntryEntity, { walletId }, {
            orderBy: { createdAt: 'ASC', id: 'ASC' },
        });
        return entities.map((entity) => WalletLedgerEntryMapper.toDomain(entity));
    }
}
