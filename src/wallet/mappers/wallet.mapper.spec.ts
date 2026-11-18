import { describe, expect, it } from 'vitest';
import { Money } from '../../shared/domain/money.js';
import { Wallet } from '../domain/wallet.js';
import { WalletEntity } from '../entities/wallet.entity.js';
import { WalletMapper } from './wallet.mapper.js';

describe('WalletMapper', () => {
    it('should convert a domain wallet into a persistence entity', () => {
        const wallet = Wallet.open({
            playerId: 'player-123',
            initialBalance: Money.from({
                amount: '150.00',
                currency: 'BRL',
            }),
        });

        const entity = WalletMapper.toEntity(wallet);

        expect(entity).toBeInstanceOf(WalletEntity);
        expect(entity.id).toBe(wallet.id);
        expect(entity.playerId).toBe(wallet.playerId);
        expect(entity.currency).toBe(wallet.currency);
        expect(entity.balance).toBe('150.00');
        expect(entity.version).toBe(wallet.version);
    });

    it('should reconstruct a domain wallet from a persistence entity', () => {
        const entity = new WalletEntity({
            id: '550e8400-e29b-41d4-a716-446655440000',
            playerId: 'player-123',
            currency: 'BRL',
            balance: '250.00',
            version: 3,
        });

        const wallet = WalletMapper.toDomain(entity);

        expect(wallet).toBeInstanceOf(Wallet);
        expect(wallet.id).toBe(entity.id);
        expect(wallet.playerId).toBe(entity.playerId);
        expect(wallet.currency).toBe(entity.currency);
        expect(wallet.balance.toString()).toBe('250.00');
        expect(wallet.version).toBe(3);
    });
});
