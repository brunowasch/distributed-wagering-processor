import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { WagerTransaction } from './domain/wager-transaction.js';
import { WagerTransactionRepository } from './wager-transaction.repository.js';
import { WageringService } from './wagering.service.js';

describe('WageringService', () => {
    const wagerTransactionRepository = {
        findById: vi.fn(),
        findByProviderAndExternalId: vi.fn(),
    };

    let service: WageringService;

    beforeEach(() => {
        vi.clearAllMocks();

        service = new WageringService(
            wagerTransactionRepository as unknown as WagerTransactionRepository,
        );
    });

    it('should return a transaction when found by internal id', async () => {
        const transaction = {
            id: 'transaction-123',
        } as WagerTransaction;

        wagerTransactionRepository.findById.mockResolvedValue(transaction);

        const result = await service.getTransactionById('transaction-123');

        expect(wagerTransactionRepository.findById).toHaveBeenCalledWith(
            'transaction-123',
        );
        expect(result).toBe(transaction);
    });

    it('should throw NotFoundException when transaction is not found by internal id', async () => {
        wagerTransactionRepository.findById.mockResolvedValue(null);

        await expect(
            service.getTransactionById('transaction-123'),
        ).rejects.toThrow(NotFoundException);

        expect(wagerTransactionRepository.findById).toHaveBeenCalledWith(
            'transaction-123',
        );
    });

    it('should return a transaction when found by provider and external id', async () => {
        const transaction = {
            id: 'transaction-123',
        } as WagerTransaction;

        wagerTransactionRepository.findByProviderAndExternalId.mockResolvedValue(
            transaction,
        );

        const result = await service.getTransactionByProvider(
            'provider-123',
            'external-123',
        );

        expect(
            wagerTransactionRepository.findByProviderAndExternalId,
        ).toHaveBeenCalledWith('provider-123', 'external-123');

        expect(result).toBe(transaction);
    });

    it('should throw NotFoundException when transaction is not found by provider and external id', async () => {
        wagerTransactionRepository.findByProviderAndExternalId.mockResolvedValue(
            null,
        );

        await expect(
            service.getTransactionByProvider('provider-123', 'external-123'),
        ).rejects.toThrow(NotFoundException);

        expect(
            wagerTransactionRepository.findByProviderAndExternalId,
        ).toHaveBeenCalledWith('provider-123', 'external-123');
    });
});
