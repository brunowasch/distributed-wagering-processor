import { describe, expect, it } from 'vitest';
import { WalletEntity } from './wallet.entity.js';

describe('WalletEntity', () => {
    it('should create a wallet entity with the provided properties', () => {
        const wallet = new WalletEntity({
            id: '550e8400-e29b-41d4-a716-446655440000',
            playerId: 'player-123',
            currency: 'BRL',
            balance: '100.00',
            version: 1,
        });

        expect(wallet.id).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(wallet.playerId).toBe('player-123');
        expect(wallet.currency).toBe('BRL');
        expect(wallet.balance).toBe('100.00');
        expect(wallet.version).toBe(1);
    });

    it('should initialize default persistence properties', () => {
        const wallet = new WalletEntity();

        expect(wallet.balance).toBe('0.00');
        expect(wallet.version).toBe(1);
        expect(wallet.createdAt).toBeInstanceOf(Date);
        expect(wallet.updatedAt).toBeInstanceOf(Date);
    });
});
