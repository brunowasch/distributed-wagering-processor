import { describe, expect, it } from 'vitest';
import {
    WagerTransaction,
    WagerTransactionKind,
    WagerTransactionProps,
    WagerTransactionStatus
} from './wager-transaction.js';
import { Money } from '../../shared/domain/money.js';

// Fornece dados válidos para os testes, permitindo sobrescrever campos específicos.
function createValidProps(
    overrides: Partial<WagerTransactionProps> = {},
): WagerTransactionProps {
    return {
        providerId: 'provider-1',
        externalTransactionId: 'external-transaction-1',
        idempotencyKey: 'provider-1:external-transaction-1',
        payloadHash: 'payload-hash',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.BET,
        money: Money.from({
            amount: '25.00',
            currency: 'BRL',
        }),
        ...overrides,
    };
}

describe('WagerTransaction', () => {
    describe('create', () => {
        it('should create a transaction with valid properties', () => {
            const props = createValidProps();

            const transaction = WagerTransaction.create(props);

            expect(transaction).toBeInstanceOf(WagerTransaction);
            expect(transaction.providerId).toBe(props.providerId);
            expect(transaction.externalTransactionId).toBe(
                props.externalTransactionId,
            );
            expect(transaction.walletId).toBe(props.walletId);
            expect(transaction.playerId).toBe(props.playerId);
            expect(transaction.kind).toBe(props.kind);
            expect(transaction.money.equals(props.money)).toBe(true);
        });

        it('should generate an ID when one is not provided', () => {
            const transaction = WagerTransaction.create(createValidProps());

            expect(transaction.id).toBeDefined();
            expect(transaction.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            );
        });

        it('should use the provided ID', () => {
            const transaction = WagerTransaction.create(
                createValidProps({ id: 'transaction-123' }),
            );

            expect(transaction.id).toBe('transaction-123');
        });

        it('should reject an empty transaction ID', () => {
            expect(() =>
                WagerTransaction.create(createValidProps({ id: ' ' })),
            ).toThrow('Transaction ID is required.');
        });

        it('should reject an empty provider ID', () => {
            expect(() =>
                WagerTransaction.create(createValidProps({ providerId: ' ' })),
            ).toThrow('Provider ID is required.');
        });

        it('should reject an empty external transaction ID', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({ externalTransactionId: ' ' }),
                ),
            ).toThrow('External transaction ID is required.');
        });

        it('should reject an empty idempotency key', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({ idempotencyKey: ' ' }),
                ),
            ).toThrow('Idempotency key is required.');
        });

        it('should reject an empty payload hash', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({ payloadHash: ' ' }),
                ),
            ).toThrow('Payload hash is required.');
        });

        it('should reject an empty wallet ID', () => {
            expect(() =>
                WagerTransaction.create(createValidProps({ walletId: ' ' })),
            ).toThrow('Wallet ID is required.');
        });

        it('should reject an empty player ID', () => {
            expect(() =>
                WagerTransaction.create(createValidProps({ playerId: ' ' })),
            ).toThrow('Player ID is required.');
        });

        it('should reject an empty round ID', () => {
            expect(() =>
                WagerTransaction.create(createValidProps({ roundId: ' ' })),
            ).toThrow('Round ID is required.');
        });

        it('should reject an empty game ID', () => {
            expect(() =>
                WagerTransaction.create(createValidProps({ gameId: ' ' })),
            ).toThrow('Game ID is required.');
        });

        it('should reject a zero transaction amount', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({
                        money: Money.zero('BRL'),
                    }),
                ),
            ).toThrow('Transaction amount must be positive.');
        });

        it('should reject a negative transaction amount', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({
                        money: Money.from({
                            amount: '-25.00',
                            currency: 'BRL',
                        }),
                    }),
                ),
            ).toThrow('Transaction amount must be positive.');
        });

        it('should require a reference transaction ID for REFUND', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({
                        kind: WagerTransactionKind.REFUND,
                    }),
                ),
            ).toThrow('Reference transaction ID is required.');
        });

        it('should require a reference transaction ID for ROLLBACK', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({
                        kind: WagerTransactionKind.ROLLBACK,
                    }),
                ),
            ).toThrow('Reference transaction ID is required.');
        });

        it('should accept REFUND with a reference transaction ID', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({
                        kind: WagerTransactionKind.REFUND,
                        referenceExternalTransactionId: 'original-transaction',
                    }),
                ),
            ).not.toThrow();
        });

        it('should accept ROLLBACK with a reference transaction ID', () => {
            expect(() =>
                WagerTransaction.create(
                    createValidProps({
                        kind: WagerTransactionKind.ROLLBACK,
                        referenceExternalTransactionId: 'original-transaction',
                    }),
                ),
            ).not.toThrow();
        });
    });

    describe('isTerminal', () => {
        it('should return false for a PENDING transaction', () => {
            const transaction = WagerTransaction.create(createValidProps());

            expect(transaction.isTerminal()).toBe(false);
        });
    });

    describe('affectsBalance', () => {
        it('should return false for LOSS transactions', () => {
            const transaction = WagerTransaction.create(
                createValidProps({ kind: WagerTransactionKind.LOSS }),
            );

            expect(transaction.affectsBalance()).toBe(false);
        });

        it.each([
            WagerTransactionKind.OPENING,
            WagerTransactionKind.BET,
            WagerTransactionKind.WIN,
            WagerTransactionKind.REFUND,
            WagerTransactionKind.ROLLBACK,
        ])('should return true for %s transactions', (kind) => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind,
                    ...(kind === WagerTransactionKind.REFUND ||
                    kind === WagerTransactionKind.ROLLBACK
                        ? { referenceExternalTransactionId: 'original-transaction' }
                        : {}),
                }),
            );

            expect(transaction.affectsBalance()).toBe(true);
        });
    });

    describe('requiresReference', () => {
        it.each([
            WagerTransactionKind.REFUND,
            WagerTransactionKind.ROLLBACK,
        ])('should return true for %s transactions', (kind) => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind,
                    referenceExternalTransactionId: 'original-transaction',
                }),
            );

            expect(transaction.requiresReference()).toBe(true);
        });

        it.each([
            WagerTransactionKind.OPENING,
            WagerTransactionKind.BET,
            WagerTransactionKind.WIN,
            WagerTransactionKind.LOSS,
        ])('should return false for %s transactions', (kind) => {
            const transaction = WagerTransaction.create(
                createValidProps({ kind }),
            );

            expect(transaction.requiresReference()).toBe(false);
        });
    })
    describe('matchesPayload', () => {
        it('should return true when payload hashes are equal', () => {
            const transaction = WagerTransaction.create(createValidProps());

            expect(transaction.matchesPayload('payload-hash')).toBe(true);
        });

        it('should return false when payload hashes are different', () => {
            const transaction = WagerTransaction.create(createValidProps());

            expect(transaction.matchesPayload('different-payload-hash')).toBe(false);
        });
    });

    describe('markPendingReference', () => {
        it('should transition PENDING to PENDING_REFERENCE', () => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind: WagerTransactionKind.REFUND,
                    referenceExternalTransactionId: 'external-reference-123',
                }),
            );

            transaction.markPendingReference();

            expect(transaction.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
        });

        it('should reject transaction kinds that do not require a reference', () => {
            const transaction = WagerTransaction.create(createValidProps());

            expect(() => transaction.markPendingReference()).toThrow();
        });

        it('should not allow transitioning to PENDING_REFERENCE more than once', () => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind: WagerTransactionKind.REFUND,
                    referenceExternalTransactionId: 'external-reference-123',
                }),
            );

            transaction.markPendingReference();

            expect(() => transaction.markPendingReference()).toThrow();
        });
    });

    describe('markProcessed', () => {
        it('should transition PENDING to PROCESSED', () => {
            const transaction = WagerTransaction.create(createValidProps());

            transaction.markProcessed();

            expect(transaction.status).toBe(WagerTransactionStatus.PROCESSED);
            expect(transaction.processedAt).toBeInstanceOf(Date);
        });

        it('should transition PENDING_REFERENCE to PROCESSED', () => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind: WagerTransactionKind.REFUND,
                    referenceExternalTransactionId: 'external-reference-123',
                }),
            );

            transaction.markPendingReference();
            transaction.markProcessed('internal-reference-123');

            expect(transaction.status).toBe(WagerTransactionStatus.PROCESSED);
        });

        it('should store the reference transaction ID', () => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind: WagerTransactionKind.REFUND,
                    referenceExternalTransactionId: 'external-reference-123',
                }),
            );

            transaction.markProcessed('internal-reference-123');

            expect(transaction.referenceTransactionId).toBe('internal-reference-123');
        });

        it.each([
            WagerTransactionKind.REFUND,
            WagerTransactionKind.ROLLBACK,
        ])('should require a reference ID for %s', (kind) => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind,
                    referenceExternalTransactionId: 'external-reference-123',
                }),
            );

            expect(() => transaction.markProcessed()).toThrow();
        });

        it('should reject an empty reference transaction ID', () => {
            const transaction = WagerTransaction.create(createValidProps());

            expect(() => transaction.markProcessed('  ')).toThrow();
        });
    });

    describe('reject', () => {
        it('should transition PENDING to REJECTED', () => {
            const transaction = WagerTransaction.create(createValidProps());

            transaction.reject('INSUFFICIENT_FUNDS');

            expect(transaction.status).toBe(WagerTransactionStatus.REJECTED);
            expect(transaction.failureCode).toBe('INSUFFICIENT_FUNDS');
            expect(transaction.processedAt).toBeInstanceOf(Date);
        });

        it('should transition PENDING_REFERENCE to REJECTED', () => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind: WagerTransactionKind.REFUND,
                    referenceExternalTransactionId: 'external-reference-123',
                }),
            );

            transaction.markPendingReference();
            transaction.reject('REFERENCE_NOT_FOUND');

            expect(transaction.status).toBe(WagerTransactionStatus.REJECTED);
        });

        it('should reject an empty failure code', () => {
            const transaction = WagerTransaction.create(createValidProps());

            expect(() => transaction.reject('  ')).toThrow();
        });
    });

    describe('fail', () => {
        it('should transition PENDING to FAILED', () => {
            const transaction = WagerTransaction.create(createValidProps());

            transaction.fail('PROCESSING_ERROR');

            expect(transaction.status).toBe(WagerTransactionStatus.FAILED);
            expect(transaction.failureCode).toBe('PROCESSING_ERROR');
            expect(transaction.processedAt).toBeInstanceOf(Date);
        });

        it('should transition PENDING_REFERENCE to FAILED', () => {
            const transaction = WagerTransaction.create(
                createValidProps({
                    kind: WagerTransactionKind.ROLLBACK,
                    referenceExternalTransactionId: 'external-reference-123',
                }),
            );

            transaction.markPendingReference();
            transaction.fail('PROCESSING_ERROR');

            expect(transaction.status).toBe(WagerTransactionStatus.FAILED);
        });

        it('should reject an empty failure code', () => {
            const transaction = WagerTransaction.create(createValidProps());

            expect(() => transaction.fail('  ')).toThrow();
        });
    });
    
    describe('terminal states', () => {
        it.each([
            WagerTransactionStatus.PROCESSED,
            WagerTransactionStatus.REJECTED,
            WagerTransactionStatus.FAILED,
        ])('should prevent transitions from %s', (status) => {
            const transaction = WagerTransaction.create(createValidProps());

            if (status === WagerTransactionStatus.PROCESSED) {
                transaction.markProcessed();
            } else if (status === WagerTransactionStatus.REJECTED) {
                transaction.reject('BUSINESS_REJECTION');
            } else {
                transaction.fail('PROCESSING_ERROR');
            }

            expect(() => transaction.markProcessed()).toThrow();
            expect(() => transaction.markPendingReference()).toThrow();
            expect(() => transaction.reject('ANOTHER_ERROR')).toThrow();
            expect(() => transaction.fail('ANOTHER_ERROR')).toThrow();

            expect(transaction.status).toBe(status);
        });
    });
});

describe('ledgerDirectionFor', () => {
    it.each([
        [WagerTransactionKind.OPENING, 'CREDIT'],
        [WagerTransactionKind.BET, 'DEBIT'],
        [WagerTransactionKind.WIN, 'CREDIT'],
        [WagerTransactionKind.REFUND, 'CREDIT'],
    ])('should return %s direction for %s transactions', (kind, expected) => {
        const transaction = WagerTransaction.create(
            createValidProps({
                kind,
                referenceExternalTransactionId:
                    kind === WagerTransactionKind.REFUND ? 'reference-123' : undefined,
            }),
        );

        expect(transaction.ledgerDirectionFor()).toBe(expected);
    });

    it('should return undefined for LOSS transactions', () => {
        const transaction = WagerTransaction.create(
            createValidProps({ kind: WagerTransactionKind.LOSS }),
        );

        expect(transaction.ledgerDirectionFor()).toBeUndefined();
    });

    it('should return CREDIT for ROLLBACK of BET', () => {
        const transaction = WagerTransaction.create(
            createValidProps({
                kind: WagerTransactionKind.ROLLBACK,
                referenceExternalTransactionId: 'reference-123',
            }),
        );

        expect(transaction.ledgerDirectionFor(WagerTransactionKind.BET)).toBe('CREDIT');
    });

    it.each([
        WagerTransactionKind.WIN,
        WagerTransactionKind.REFUND,
    ])('should return DEBIT for ROLLBACK of %s', (referenceKind) => {
        const transaction = WagerTransaction.create(
            createValidProps({
                kind: WagerTransactionKind.ROLLBACK,
                referenceExternalTransactionId: 'reference-123',
            }),
        );

        expect(transaction.ledgerDirectionFor(referenceKind)).toBe('DEBIT');
    });

    it('should reject ROLLBACK without a reference kind', () => {
        const transaction = WagerTransaction.create(
            createValidProps({
                kind: WagerTransactionKind.ROLLBACK,
                referenceExternalTransactionId: 'reference-123',
            }),
        );

        expect(() => transaction.ledgerDirectionFor()).toThrow();
    });

    it('should reject invalid reference kinds for ROLLBACK', () => {
        const transaction = WagerTransaction.create(
            createValidProps({
                kind: WagerTransactionKind.ROLLBACK,
                referenceExternalTransactionId: 'reference-123',
            }),
        );

        expect(() =>
            transaction.ledgerDirectionFor(WagerTransactionKind.LOSS),
        ).toThrow();
    });

    describe('rehydrate', () => {
        it('should reconstruct a transaction with its original properties', () => {
            const original = WagerTransaction.create(createValidProps());

            const transaction = WagerTransaction.rehydrate({
                id: original.id,
                providerId: original.providerId,
                externalTransactionId: original.externalTransactionId,
                idempotencyKey: original.idempotencyKey,
                payloadHash: original.payloadHash,
                walletId: original.walletId,
                playerId: original.playerId,
                roundId: original.roundId,
                gameId: original.gameId,
                kind: original.kind,
                money: original.money,
                referenceExternalTransactionId: original.referenceExternalTransactionId,
                createdAt: original.createdAt,
                status: original.status,
                referenceTransactionId: original.referenceTransactionId,
                failureCode: original.failureCode,
                processedAt: original.processedAt,
            });

            expect(transaction.id).toBe(original.id);
            expect(transaction.providerId).toBe(original.providerId);
            expect(transaction.externalTransactionId).toBe(original.externalTransactionId);
            expect(transaction.idempotencyKey).toBe(original.idempotencyKey);
            expect(transaction.payloadHash).toBe(original.payloadHash);
            expect(transaction.walletId).toBe(original.walletId);
            expect(transaction.playerId).toBe(original.playerId);
            expect(transaction.roundId).toBe(original.roundId);
            expect(transaction.gameId).toBe(original.gameId);
            expect(transaction.kind).toBe(original.kind);
            expect(transaction.money.equals(original.money)).toBe(true);
            expect(transaction.status).toBe(original.status);
        });

        it('should preserve a PROCESSED transaction', () => {
            const original = WagerTransaction.create(createValidProps());
            original.markProcessed();

            const transaction = WagerTransaction.rehydrate({
                id: original.id,
                providerId: original.providerId,
                externalTransactionId: original.externalTransactionId,
                idempotencyKey: original.idempotencyKey,
                payloadHash: original.payloadHash,
                walletId: original.walletId,
                playerId: original.playerId,
                roundId: original.roundId,
                gameId: original.gameId,
                kind: original.kind,
                money: original.money,
                referenceExternalTransactionId: original.referenceExternalTransactionId,
                createdAt: original.createdAt,
                status: original.status,
                referenceTransactionId: original.referenceTransactionId,
                failureCode: original.failureCode,
                processedAt: original.processedAt,
            });

            expect(transaction.status).toBe(WagerTransactionStatus.PROCESSED);
            expect(transaction.processedAt).toEqual(original.processedAt);
            expect(transaction.isTerminal()).toBe(true);
        });

        it('should preserve a PENDING_REFERENCE transaction', () => {
            const original = WagerTransaction.create(
                createValidProps({
                    kind: WagerTransactionKind.REFUND,
                    referenceExternalTransactionId: 'external-reference-123',
                }),
            );

            original.markPendingReference();

            const transaction = WagerTransaction.rehydrate({
                id: original.id,
                providerId: original.providerId,
                externalTransactionId: original.externalTransactionId,
                idempotencyKey: original.idempotencyKey,
                payloadHash: original.payloadHash,
                walletId: original.walletId,
                playerId: original.playerId,
                roundId: original.roundId,
                gameId: original.gameId,
                kind: original.kind,
                money: original.money,
                referenceExternalTransactionId: original.referenceExternalTransactionId,
                createdAt: original.createdAt,
                status: original.status,
                referenceTransactionId: original.referenceTransactionId,
                failureCode: original.failureCode,
                processedAt: original.processedAt,
            });

            expect(transaction.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
            expect(transaction.isTerminal()).toBe(false);
        });

        it('should preserve failure information', () => {
            const original = WagerTransaction.create(createValidProps());
            original.reject('INSUFFICIENT_FUNDS');

            const transaction = WagerTransaction.rehydrate({
                id: original.id,
                providerId: original.providerId,
                externalTransactionId: original.externalTransactionId,
                idempotencyKey: original.idempotencyKey,
                payloadHash: original.payloadHash,
                walletId: original.walletId,
                playerId: original.playerId,
                roundId: original.roundId,
                gameId: original.gameId,
                kind: original.kind,
                money: original.money,
                referenceExternalTransactionId: original.referenceExternalTransactionId,
                createdAt: original.createdAt,
                status: original.status,
                referenceTransactionId: original.referenceTransactionId,
                failureCode: original.failureCode,
                processedAt: original.processedAt,
            });

            expect(transaction.status).toBe(WagerTransactionStatus.REJECTED);
            expect(transaction.failureCode).toBe('INSUFFICIENT_FUNDS');
            expect(transaction.processedAt).toEqual(original.processedAt);
        });

        it('should preserve dates without sharing mutable references', () => {
            const createdAt = new Date('2026-01-10T10:00:00.000Z');

            const transaction = WagerTransaction.rehydrate({
                id: 'transaction-123',
                providerId: 'provider-123',
                externalTransactionId: 'external-123',
                idempotencyKey: 'idempotency-123',
                payloadHash: 'payload-hash',
                walletId: 'wallet-123',
                playerId: 'player-123',
                roundId: 'round-123',
                gameId: 'game-123',
                kind: WagerTransactionKind.BET,
                money: createValidProps().money,
                createdAt,
                status: WagerTransactionStatus.PENDING,
            });

            createdAt.setFullYear(2030);

            expect(transaction.createdAt.getFullYear()).toBe(2026);
        });
    });
});
