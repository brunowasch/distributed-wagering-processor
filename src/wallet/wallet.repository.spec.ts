import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletRepository } from './wallet.repository.js';
import { WalletEntity } from './entities/wallet.entity.js';
import { Wallet } from './domain/wallet.js';

describe('WalletRepository', () => {
    let repository: WalletRepository;

    const mockEntityManager = {
        findOne: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        repository = new WalletRepository(
            mockEntityManager as never,
        );
    });

    it('should return a wallet when it exists', async () => {
        const entity = new WalletEntity({
            id: '550e8400-e29b-41d4-a716-446655440000',
            playerId: 'player-1',
            currency: 'BRL',
            balance: '100.00',
            version: 1,
        });

        mockEntityManager.findOne.mockResolvedValue(entity);

        const result = await repository.findById(entity.id);

        expect(result).toBeInstanceOf(Wallet);
        expect(result?.id).toBe(entity.id);
        expect(result?.balance.toString()).toBe('100.00');

        expect(mockEntityManager.findOne).toHaveBeenCalledWith(
            WalletEntity,
            { id: entity.id },
        );
    });

    it('should return null when wallet does not exist', async () => {
        mockEntityManager.findOne.mockResolvedValue(null);

        const result = await repository.findById('invalid-id');

        expect(result).toBeNull();

        expect(mockEntityManager.findOne).toHaveBeenCalledWith(
            WalletEntity,
            { id: 'invalid-id' },
        );
    });
});
