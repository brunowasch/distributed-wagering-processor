import { Money } from '../../shared/domain/money.js';
import { Wallet } from '../domain/wallet.js';
import { WalletEntity } from '../entities/wallet.entity.js';

/**
 * Responsável pela conversão entre o agregado de domínio (Wallet)
 * e a entidade de persistência (WalletEntity).
 */
export class WalletMapper {
    // Converte o agregado de domínio para a representação persistida.
    static toEntity(wallet: Wallet): WalletEntity {
        return new WalletEntity({
            id: wallet.id,
            playerId: wallet.playerId,
            currency: wallet.currency,
            balance: wallet.balance.toString(),
            version: wallet.version,
        });
    }

    // Reconstrói o agregado de domínio a partir da entidade ORM.
    static toDomain(entity: WalletEntity): Wallet {
        return Wallet.rehydrate({
            id: entity.id,
            playerId: entity.playerId,
            currency: entity.currency,
            balance: Money.from({
                amount: entity.balance,
                currency: entity.currency,
            }),
            version: entity.version,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
        });
    }
}
