import { describe, expect, it } from 'vitest';
import { Money } from '../../shared/domain/money.js';
import { Wallet } from './wallet.js';

describe('Wallet', () => {
    describe('open', () => {
        it('should open a wallet with valid data', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '100.00',
                    currency: 'BRL',
                }),
            });

            expect(wallet.id).toBeDefined();
            expect(wallet.playerId).toBe('player-123');
            expect(wallet.currency).toBe('BRL');
            expect(wallet.balance.toString()).toBe('100.00');
            expect(wallet.version).toBe(1);
            expect(wallet.createdAt).toBeInstanceOf(Date);
            expect(wallet.updatedAt).toBeInstanceOf(Date);
        });

        it('should allow opening a wallet with zero balance', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.zero('BRL'),
            });

            expect(wallet.balance.toString()).toBe('0.00');
            expect(wallet.version).toBe(1);
        });

        it('should not allow a negative initial balance', () => {
            expect(() => Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '-10.00',
                    currency: 'BRL',
                }),
            })).toThrow('Initial balance cannot be negative.');
        });

        it('should not allow an empty player ID', () => {
            expect(() => Wallet.open({
                playerId: '   ',
                initialBalance: Money.zero('BRL'),
            })).toThrow('Player ID is required.');
        });

        it('should not allow an empty wallet ID', () => {
            expect(() => Wallet.open({
                id: '   ',
                playerId: 'player-123',
                initialBalance: Money.zero('BRL'),
            })).toThrow('Wallet ID is required.');
        });

        it('should not allow external modification of wallet dates', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.zero('BRL'),
            });

            const originalCreatedAt = wallet.createdAt.getTime();
            const originalUpdatedAt = wallet.updatedAt.getTime();

            wallet.createdAt.setFullYear(2000);
            wallet.updatedAt.setFullYear(2000);

            expect(wallet.createdAt.getTime()).toBe(originalCreatedAt);
            expect(wallet.updatedAt.getTime()).toBe(originalUpdatedAt);
        });
    });

    describe('rehydrate', () => {
        it('should reconstruct a wallet from persisted state', () => {
            const createdAt = new Date('2026-01-01T10:00:00.000Z');
            const updatedAt = new Date('2026-01-02T10:00:00.000Z');

            const wallet = Wallet.rehydrate({
                id: 'wallet-123',
                playerId: 'player-123',
                currency: 'BRL',
                balance: Money.from({
                    amount: '150.00',
                    currency: 'BRL',
                }),
                version: 5,
                createdAt,
                updatedAt,
            });

            expect(wallet.id).toBe('wallet-123');
            expect(wallet.playerId).toBe('player-123');
            expect(wallet.currency).toBe('BRL');
            expect(wallet.balance.toString()).toBe('150.00');
            expect(wallet.version).toBe(5);
            expect(wallet.createdAt.getTime()).toBe(createdAt.getTime());
            expect(wallet.updatedAt.getTime()).toBe(updatedAt.getTime());
        });

        it('should not share mutable date references with the persisted state', () => {
            const createdAt = new Date('2026-01-01T10:00:00.000Z');
            const updatedAt = new Date('2026-01-02T10:00:00.000Z');

            const wallet = Wallet.rehydrate({
                id: 'wallet-123',
                playerId: 'player-123',
                currency: 'BRL',
                balance: Money.from({
                    amount: '150.00',
                    currency: 'BRL',
                }),
                version: 5,
                createdAt,
                updatedAt,
            });

            createdAt.setFullYear(2000);
            updatedAt.setFullYear(2000);

            expect(wallet.createdAt.getFullYear()).toBe(2026);
            expect(wallet.updatedAt.getFullYear()).toBe(2026);
        });
    });

    describe('credit', () => {
        it('should increase the wallet balance', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '100.00',
                    currency: 'BRL',
                }),
            });

            wallet.credit(Money.from({
                amount: '50.00',
                currency: 'BRL',
            }));

            expect(wallet.balance.toString()).toBe('150.00');
            expect(wallet.version).toBe(2);
        });

        it('should not accept a zero or negative amount', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '100.00',
                    currency: 'BRL',
                }),
            });

            expect(() => wallet.credit(Money.zero('BRL')))
                .toThrow('Credit amount must be positive.');

            expect(() => wallet.credit(Money.from({
                amount: '-10.00',
                currency: 'BRL',
            }))).toThrow('Credit amount must be positive.');

            expect(wallet.balance.toString()).toBe('100.00');
            expect(wallet.version).toBe(1);
        });

        it('should not accept an amount with a different currency', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '100.00',
                    currency: 'BRL',
                }),
            });

            expect(() => wallet.credit(Money.from({
                amount: '30.00',
                currency: 'USD',
            }))).toThrow('Currency mismatch: BRL and USD.');

            expect(wallet.balance.toString()).toBe('100.00');
            expect(wallet.version).toBe(1);
        });
    });

    describe('debit', () => {
        it('should decrease the wallet balance', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '100.00',
                    currency: 'BRL',
                }),
            });

            wallet.debit(Money.from({
                amount: '30.00',
                currency: 'BRL',
            }));

            expect(wallet.balance.toString()).toBe('70.00');
            expect(wallet.version).toBe(2);
        });

        it('should not allow a debit greater than the available balance', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '100.00',
                    currency: 'BRL',
                }),
            });

            expect(() => wallet.debit(Money.from({
                amount: '150.00',
                currency: 'BRL',
            }))).toThrow('Insufficient funds.');

            // Uma operação rejeitada não pode modificar o estado da carteira.
            expect(wallet.balance.toString()).toBe('100.00');
            expect(wallet.version).toBe(1);
        });

        it('should not accept a zero or negative amount', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '100.00',
                    currency: 'BRL',
                }),
            });

            expect(() => wallet.debit(Money.zero('BRL')))
                .toThrow('Debit amount must be positive.');

            expect(() => wallet.debit(Money.from({
                amount: '-10.00',
                currency: 'BRL',
            }))).toThrow('Debit amount must be positive.');

            expect(wallet.balance.toString()).toBe('100.00');
            expect(wallet.version).toBe(1);
        });

        it('should not accept an amount with a different currency', () => {
            const wallet = Wallet.open({
                playerId: 'player-123',
                initialBalance: Money.from({
                    amount: '100.00',
                    currency: 'BRL',
                }),
            });

            expect(() => wallet.debit(Money.from({
                amount: '30.00',
                currency: 'USD',
            }))).toThrow('Currency mismatch: BRL and USD.');

            expect(wallet.balance.toString()).toBe('100.00');
            expect(wallet.version).toBe(1);
        });
    });
});
