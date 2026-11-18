import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletLedgerEntry, WalletLedgerDirection } from '../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.js';
import { WalletLedgerEntryRepository } from './wallet-ledger-entry.repository.js';

describe('WalletLedgerEntryRepository', () => {
    const entityManager = {
        findOne: vi.fn(),
        persist: vi.fn(),
    };
    let repository: WalletLedgerEntryRepository;

    const createEntity = () => Object.assign(new WalletLedgerEntryEntity(), {
        id: '550e8400-e29b-41d4-a716-446655440003',
        walletId: '550e8400-e29b-41d4-a716-446655440001',
        transactionId: '550e8400-e29b-41d4-a716-446655440002',
        direction: WalletLedgerDirection.CREDIT,
        amount: '25.50',
        currency: 'BRL',
        balanceBefore: '100.00',
        balanceAfter: '125.50',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
    });

    beforeEach(() => {
        vi.clearAllMocks();
        repository = new WalletLedgerEntryRepository(entityManager as never);
    });

    it('persists a new ledger entry using the default EntityManager', async () => {
        const entry = { id: 'entry-123' } as WalletLedgerEntry;
        const entity = createEntity();
        const mapperSpy = vi.spyOn(WalletLedgerEntryMapper, 'toEntity').mockReturnValue(entity);

        await repository.create(entry);

        expect(mapperSpy).toHaveBeenCalledWith(entry);
        expect(entityManager.persist).toHaveBeenCalledWith(entity);
    });

    it('persists a new ledger entry using the provided EntityManager', async () => {
        const entry = { id: 'entry-123' } as WalletLedgerEntry;
        const entity = createEntity();
        const transactionalEm = { persist: vi.fn() };
        vi.spyOn(WalletLedgerEntryMapper, 'toEntity').mockReturnValue(entity);

        await repository.create(entry, transactionalEm as never);

        expect(transactionalEm.persist).toHaveBeenCalledWith(entity);
        expect(entityManager.persist).not.toHaveBeenCalled();
    });

    it('finds a ledger entry by wallet and transaction using the default EntityManager', async () => {
        const entity = createEntity();
        entityManager.findOne.mockResolvedValue(entity);

        const result = await repository.findByTransactionId(entity.walletId, entity.transactionId);

        expect(entityManager.findOne).toHaveBeenCalledWith(WalletLedgerEntryEntity, {
            walletId: entity.walletId,
            transactionId: entity.transactionId,
        });
        expect(result).toBeInstanceOf(WalletLedgerEntry);
        expect(result?.id).toBe(entity.id);
        expect(result?.money.toString()).toBe(entity.amount);
    });

    it('returns null when no ledger entry exists for the wallet and transaction', async () => {
        entityManager.findOne.mockResolvedValue(null);

        const result = await repository.findByTransactionId('wallet-123', 'transaction-123');

        expect(result).toBeNull();
    });

    it('uses the provided EntityManager to find a ledger entry', async () => {
        const entity = createEntity();
        const transactionalEm = { findOne: vi.fn().mockResolvedValue(entity) };

        const result = await repository.findByTransactionId(
            entity.walletId,
            entity.transactionId,
            transactionalEm as never,
        );

        expect(transactionalEm.findOne).toHaveBeenCalledWith(WalletLedgerEntryEntity, {
            walletId: entity.walletId,
            transactionId: entity.transactionId,
        });
        expect(result?.id).toBe(entity.id);
        expect(entityManager.findOne).not.toHaveBeenCalled();
    });
});
