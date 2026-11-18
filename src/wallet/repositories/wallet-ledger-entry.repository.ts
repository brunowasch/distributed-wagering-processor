import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.js';

/** Persiste e consulta os lançamentos financeiros das carteiras. */
@Injectable()
export class WalletLedgerEntryRepository {
    constructor(private readonly em: EntityManager) {}

    /** Registra um lançamento sem confirmar a transação que o contém. */
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
        em: EntityManager = this.em,
    ): Promise<WalletLedgerEntry | null> {
        const entity = await em.findOne(WalletLedgerEntryEntity, {
            walletId,
            transactionId,
        });

        return entity ? WalletLedgerEntryMapper.toDomain(entity) : null;
    }
}
