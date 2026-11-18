import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { WalletRepository } from './wallet.repository.js';
import { Wallet } from './domain/wallet.js';
import { Money } from '../shared/domain/money.js';

describe('WalletService', () => {
    let service: WalletService;

    const mockWalletRepository = {
        findById: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        service = new WalletService(
            mockWalletRepository as unknown as WalletRepository,
        );
    });

    it('should return a wallet when it exists', async () => {
        const wallet = Wallet.open({
            playerId: 'player-1',
            initialBalance: Money.from({
                amount: '100.00',
                currency: 'BRL',
            }),
        });

        mockWalletRepository.findById.mockResolvedValue(wallet);

        const result = await service.getWallet(wallet.id);

        expect(result).toBe(wallet);
        expect(result).toBeInstanceOf(Wallet);

        expect(mockWalletRepository.findById).toHaveBeenCalledWith(
            wallet.id,
        );
    });

    it('should throw NotFoundException when wallet does not exist', async () => {
        mockWalletRepository.findById.mockResolvedValue(null);

        await expect(service.getWallet('invalid-id'))
            .rejects
            .toThrow(NotFoundException);

        expect(mockWalletRepository.findById).toHaveBeenCalledWith(
            'invalid-id',
        );
    });
});
