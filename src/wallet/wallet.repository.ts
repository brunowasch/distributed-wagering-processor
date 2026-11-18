import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Wallet } from './domain/wallet.js';
import { WalletEntity } from './entities/wallet.entity.js';
import { WalletMapper } from './mappers/wallet.mapper.js';

@Injectable()
export class WalletRepository {
    constructor(
        private readonly em: EntityManager,
    ) {}

    // Busca a entidade persistida e reconstrói o agregado de domínio.
    async findById(id: string): Promise<Wallet | null> {
        const entity = await this.em.findOne(WalletEntity, { id });

        return entity ? WalletMapper.toDomain(entity) : null;
    }
}
