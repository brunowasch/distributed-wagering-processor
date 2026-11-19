import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Wallet } from './domain/wallet.js';
import { WalletEntity } from './entities/wallet.entity.js';
import { WalletMapper } from './mappers/wallet.mapper.js';
import { resolveEntityManager } from '../shared/infrastructure/database/resolve-entity-manager.js';

/** Persistência de carteiras com bloqueio pessimista por carteira nas escritas financeiras. */
@Injectable()
export class WalletRepository {
    /** Define o EntityManager padrão, substituível por um manager transacional em cada operação. */
    constructor(private readonly em: EntityManager) {}

    // Busca a carteira utilizando o EntityManager padrão ou o transacional.
    /** Busca uma carteira e reconstitui seu agregado de domínio. */
    async findById(id: string, em?: EntityManager): Promise<Wallet | null> {
        const entity = await resolveEntityManager(this.em, em).findOne(WalletEntity, { id });
        return entity ? WalletMapper.toDomain(entity) : null;
    }

    /** Lê e bloqueia somente a linha desta carteira até o fim da transação. */
    async findByIdForUpdate(id: string, em: EntityManager): Promise<Wallet | null> {
        const entity = await em.findOne(
            WalletEntity,
            { id },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        return entity ? WalletMapper.toDomain(entity) : null;
    }

    /** Registra uma nova carteira no manager informado, sem confirmar a transação. */
    async create(wallet: Wallet, em: EntityManager = this.em): Promise<void> {
        const entity = WalletMapper.toEntity(wallet);
        em.persist(entity);
    }

    /** Atualiza saldo; o version field do MikroORM detecta escritas concorrentes. */
    async updateBalance(wallet: Wallet, em: EntityManager): Promise<void> {
        const entity = await em.findOneOrFail(WalletEntity, { id: wallet.id });
        em.assign(entity, { balance: wallet.balance.toString() });
    }
}
