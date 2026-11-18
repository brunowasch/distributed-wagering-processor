import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Wallet } from './domain/wallet.js';
import { WalletEntity } from './entities/wallet.entity.js';
import { WalletMapper } from './mappers/wallet.mapper.js';

@Injectable()
export class WalletRepository {
    constructor(private readonly em: EntityManager) {}

    // Busca a carteira utilizando o EntityManager padrão ou o transacional.
    async findById(id: string, em: EntityManager = this.em): Promise<Wallet | null> {
        const entity = await em.findOne(WalletEntity, { id });
        return entity ? WalletMapper.toDomain(entity) : null;
    }

    // Registra uma nova carteira sem executar o commit da transação.
    async create(wallet: Wallet, em: EntityManager = this.em): Promise<void> {
        const entity = WalletMapper.toEntity(wallet);
        em.persist(entity);
    }
}
