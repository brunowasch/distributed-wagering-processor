import { describe, expect, it } from 'vitest';
import { Money } from '../../shared/domain/money.js';
import { WalletLedgerEntry, WalletLedgerDirection } from '../domain/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryMapper } from './wallet-ledger-entry.mapper.js';

describe('WalletLedgerEntryMapper', () => {
    const createEntry = () => WalletLedgerEntry.create({
        walletId: '550e8400-e29b-41d4-a716-446655440001',
        transactionId: '550e8400-e29b-41d4-a716-446655440002',
        direction: WalletLedgerDirection.CREDIT,
        money: Money.from({ amount: '25.50', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '125.50', currency: 'BRL' }),
    });

    it('converts a domain entry to a persistence entity', () => {
        const entry = createEntry();

        const entity = WalletLedgerEntryMapper.toEntity(entry);

        expect(entity).toBeInstanceOf(WalletLedgerEntryEntity);
        expect(entity.id).toBe(entry.id);
        expect(entity.walletId).toBe(entry.walletId);
        expect(entity.transactionId).toBe(entry.transactionId);
        expect(entity.direction).toBe(entry.direction);
        expect(entity.amount).toBe('25.50');
        expect(entity.currency).toBe('BRL');
        expect(entity.balanceBefore).toBe('100.00');
        expect(entity.balanceAfter).toBe('125.50');
        expect(entity.createdAt).toEqual(entry.createdAt);
        expect(entity.createdAt).not.toBe(entry.createdAt);
    });

    it('reconstructs a domain entry from a persistence entity', () => {
        const entity = Object.assign(new WalletLedgerEntryEntity(), {
            id: '550e8400-e29b-41d4-a716-446655440003',
            walletId: '550e8400-e29b-41d4-a716-446655440001',
            transactionId: '550e8400-e29b-41d4-a716-446655440002',
            direction: WalletLedgerDirection.DEBIT,
            amount: '25.50',
            currency: 'BRL',
            balanceBefore: '100.00',
            balanceAfter: '74.50',
            createdAt: new Date('2026-01-02T03:04:05.000Z'),
        });

        const entry = WalletLedgerEntryMapper.toDomain(entity);

        expect(entry).toBeInstanceOf(WalletLedgerEntry);
        expect(entry.id).toBe(entity.id);
        expect(entry.walletId).toBe(entity.walletId);
        expect(entry.transactionId).toBe(entity.transactionId);
        expect(entry.direction).toBe(WalletLedgerDirection.DEBIT);
        expect(entry.money.toString()).toBe('25.50');
        expect(entry.money.getCurrency()).toBe('BRL');
        expect(entry.balanceBefore.toString()).toBe('100.00');
        expect(entry.balanceAfter.toString()).toBe('74.50');
        expect(entry.createdAt).toEqual(entity.createdAt);
        expect(entry.createdAt).not.toBe(entity.createdAt);
    });

    it('preserves full precision for ledger monetary values', () => {
        const entity = Object.assign(new WalletLedgerEntryEntity(), {
            id: '550e8400-e29b-41d4-a716-446655440003',
            walletId: '550e8400-e29b-41d4-a716-446655440001',
            transactionId: '550e8400-e29b-41d4-a716-446655440002',
            direction: WalletLedgerDirection.CREDIT,
            amount: '999999999999999999.99',
            currency: 'BRL',
            balanceBefore: '0.00',
            balanceAfter: '999999999999999999.99',
            createdAt: new Date('2026-01-02T03:04:05.000Z'),
        });

        const entry = WalletLedgerEntryMapper.toDomain(entity);
        const persisted = WalletLedgerEntryMapper.toEntity(entry);

        expect(entry.money.toString()).toBe('999999999999999999.99');
        expect(persisted.amount).toBe('999999999999999999.99');
        expect(persisted.balanceAfter).toBe('999999999999999999.99');
    });
});
