import { describe, expect, it } from 'vitest';

import { Money } from '../../shared/domain/money.js';
import {
    WalletLedgerDirection,
    WalletLedgerEntry,
} from './wallet-ledger-entry.js';

describe('WalletLedgerEntry', () => {
    const createMoney = (amount: string, currency = 'BRL') =>
        Money.from({ amount, currency });

    it('should create a debit ledger entry', () => {
        const entry = WalletLedgerEntry.create({
            walletId: 'wallet-1',
            transactionId: 'transaction-1',
            direction: WalletLedgerDirection.DEBIT,
            money: createMoney('30.00'),
            balanceBefore: createMoney('100.00'),
            balanceAfter: createMoney('70.00'),
        });

        expect(entry.id).toBeTruthy();
        expect(entry.walletId).toBe('wallet-1');
        expect(entry.transactionId).toBe('transaction-1');
        expect(entry.direction).toBe(WalletLedgerDirection.DEBIT);
        expect(entry.money.toString()).toBe('30.00');
        expect(entry.balanceBefore.toString()).toBe('100.00');
        expect(entry.balanceAfter.toString()).toBe('70.00');
    });

    it('should create a credit ledger entry', () => {
        const entry = WalletLedgerEntry.create({
            walletId: 'wallet-1',
            transactionId: 'transaction-2',
            direction: WalletLedgerDirection.CREDIT,
            money: createMoney('50.00'),
            balanceBefore: createMoney('100.00'),
            balanceAfter: createMoney('150.00'),
        });

        expect(entry.direction).toBe(WalletLedgerDirection.CREDIT);
        expect(entry.balanceAfter.toString()).toBe('150.00');
    });

    it('should reject an empty wallet ID', () => {
        expect(() =>
            WalletLedgerEntry.create({
                walletId: ' ',
                transactionId: 'transaction-1',
                direction: WalletLedgerDirection.DEBIT,
                money: createMoney('10.00'),
                balanceBefore: createMoney('100.00'),
                balanceAfter: createMoney('90.00'),
            }),
        ).toThrow();
    });

    it('should reject an empty transaction ID', () => {
        expect(() =>
            WalletLedgerEntry.create({
                walletId: 'wallet-1',
                transactionId: '',
                direction: WalletLedgerDirection.DEBIT,
                money: createMoney('10.00'),
                balanceBefore: createMoney('100.00'),
                balanceAfter: createMoney('90.00'),
            }),
        ).toThrow();
    });

    it('should reject a zero amount', () => {
        expect(() =>
            WalletLedgerEntry.create({
                walletId: 'wallet-1',
                transactionId: 'transaction-1',
                direction: WalletLedgerDirection.DEBIT,
                money: createMoney('0.00'),
                balanceBefore: createMoney('100.00'),
                balanceAfter: createMoney('100.00'),
            }),
        ).toThrow();
    });

    it('should reject an inconsistent debit balance', () => {
        expect(() =>
            WalletLedgerEntry.create({
                walletId: 'wallet-1',
                transactionId: 'transaction-1',
                direction: WalletLedgerDirection.DEBIT,
                money: createMoney('30.00'),
                balanceBefore: createMoney('100.00'),
                balanceAfter: createMoney('80.00'),
            }),
        ).toThrow('Ledger balance calculation is inconsistent.');
    });

    it('should reject an inconsistent credit balance', () => {
        expect(() =>
            WalletLedgerEntry.create({
                walletId: 'wallet-1',
                transactionId: 'transaction-1',
                direction: WalletLedgerDirection.CREDIT,
                money: createMoney('30.00'),
                balanceBefore: createMoney('100.00'),
                balanceAfter: createMoney('120.00'),
            }),
        ).toThrow('Ledger balance calculation is inconsistent.');
    });

    it('should reject a debit that results in a negative balance', () => {
        expect(() =>
            WalletLedgerEntry.create({
                walletId: 'wallet-1',
                transactionId: 'transaction-1',
                direction: WalletLedgerDirection.DEBIT,
                money: createMoney('120.00'),
                balanceBefore: createMoney('100.00'),
                balanceAfter: createMoney('-20.00'),
            }),
        ).toThrow('Ledger entry cannot result in a negative balance.');
    });

    it('should reject values with different currencies', () => {
        expect(() =>
            WalletLedgerEntry.create({
                walletId: 'wallet-1',
                transactionId: 'transaction-1',
                direction: WalletLedgerDirection.CREDIT,
                money: createMoney('10.00', 'BRL'),
                balanceBefore: createMoney('100.00', 'USD'),
                balanceAfter: createMoney('110.00', 'BRL'),
            }),
        ).toThrow();
    });

    it('should rehydrate a persisted ledger entry', () => {
        const createdAt = new Date('2026-11-18T10:00:00.000Z');

        const entry = WalletLedgerEntry.rehydrate({
            id: 'ledger-1',
            walletId: 'wallet-1',
            transactionId: 'transaction-1',
            direction: WalletLedgerDirection.DEBIT,
            money: createMoney('30.00'),
            balanceBefore: createMoney('100.00'),
            balanceAfter: createMoney('70.00'),
            createdAt,
        });

        expect(entry.id).toBe('ledger-1');
        expect(entry.createdAt).toEqual(createdAt);
        expect(entry.balanceAfter.toString()).toBe('70.00');
    });
});
