import { describe, expect, it } from 'vitest';
import { Money } from '../../shared/domain/money.js';
import {
    WagerTransaction,
    WagerTransactionKind,
    WagerTransactionStatus,
} from '../domain/wager-transaction.js';
import { WagerTransactionMapper } from './wager-transaction.mapper.js';

describe('WagerTransactionMapper', () => {
    const createTransaction = () =>
        WagerTransaction.create({
            providerId: 'provider-123',
            externalTransactionId: 'external-transaction-123',
            idempotencyKey: 'provider-123:external-transaction-123',
            payloadHash: 'valid-payload-hash',
            walletId: '550e8400-e29b-41d4-a716-446655440001',
            playerId: 'player-123',
            roundId: 'round-123',
            gameId: 'game-123',
            kind: WagerTransactionKind.BET,
            money: Money.from({
                amount: '25.50',
                currency: 'BRL',
            }),
        });

    it('should convert a domain transaction into a persistence entity', () => {
        const transaction = createTransaction();

        const entity = WagerTransactionMapper.toEntity(transaction);

        expect(entity.id).toBe(transaction.id);
        expect(entity.providerId).toBe(transaction.providerId);
        expect(entity.externalTransactionId).toBe(transaction.externalTransactionId);
        expect(entity.idempotencyKey).toBe(transaction.idempotencyKey);
        expect(entity.payloadHash).toBe(transaction.payloadHash);
        expect(entity.walletId).toBe(transaction.walletId);
        expect(entity.playerId).toBe(transaction.playerId);
        expect(entity.roundId).toBe(transaction.roundId);
        expect(entity.gameId).toBe(transaction.gameId);
        expect(entity.kind).toBe(transaction.kind);
        expect(entity.amount).toBe('25.50');
        expect(entity.currency).toBe('BRL');
        expect(entity.status).toBe(WagerTransactionStatus.PENDING);
    });

    it('should reconstruct a domain transaction from a persistence entity', () => {
        const transaction = createTransaction();
        const entity = WagerTransactionMapper.toEntity(transaction);

        const reconstructed = WagerTransactionMapper.toDomain(entity);

        expect(reconstructed.id).toBe(transaction.id);
        expect(reconstructed.providerId).toBe(transaction.providerId);
        expect(reconstructed.externalTransactionId).toBe(transaction.externalTransactionId);
        expect(reconstructed.idempotencyKey).toBe(transaction.idempotencyKey);
        expect(reconstructed.walletId).toBe(transaction.walletId);
        expect(reconstructed.money.equals(transaction.money)).toBe(true);
        expect(reconstructed.status).toBe(WagerTransactionStatus.PENDING);
    });

    it('should preserve optional reference and failure properties', () => {
        const transaction = WagerTransaction.create({
                providerId: 'provider-123',
                externalTransactionId: 'external-transaction-456',
                idempotencyKey: 'provider-123:external-transaction-456',
                payloadHash: 'valid-payload-hash',
                walletId: '550e8400-e29b-41d4-a716-446655440001',
                playerId: 'player-123',
                roundId: 'round-123',
                gameId: 'game-123',
                kind: WagerTransactionKind.REFUND,
                money: Money.from({ amount: '25.50', currency: 'BRL' }),
                referenceExternalTransactionId: 'external-bet-123',
        });

        transaction.markProcessed('550e8400-e29b-41d4-a716-446655440002');

        const entity = WagerTransactionMapper.toEntity(transaction);
        const reconstructed = WagerTransactionMapper.toDomain(entity);

        expect(reconstructed.referenceExternalTransactionId).toBe('external-bet-123');
        expect(reconstructed.referenceTransactionId).toBe('550e8400-e29b-41d4-a716-446655440002');
        expect(reconstructed.status).toBe(WagerTransactionStatus.PROCESSED);
        expect(reconstructed.processedAt).toEqual(transaction.processedAt);
    });

    it('should preserve failure information when reconstructing a rejected transaction', () => {
        const transaction = createTransaction();

        transaction.reject('INSUFFICIENT_FUNDS');

        const entity = WagerTransactionMapper.toEntity(transaction);
        const reconstructed = WagerTransactionMapper.toDomain(entity);

        expect(reconstructed.status).toBe(WagerTransactionStatus.REJECTED);
        expect(reconstructed.failureCode).toBe('INSUFFICIENT_FUNDS');
        expect(reconstructed.processedAt).toEqual(transaction.processedAt);
    });

    it('should preserve the exact monetary amount and currency', () => {
        const transaction = WagerTransaction.create({
            providerId: 'provider-123',
            externalTransactionId: 'external-transaction-789',
            idempotencyKey: 'provider-123:external-transaction-789',
            payloadHash: 'valid-payload-hash',
            walletId: '550e8400-e29b-41d4-a716-446655440001',
            playerId: 'player-123',
            roundId: 'round-123',
            gameId: 'game-123',
            kind: WagerTransactionKind.BET,
            money: Money.from({
                amount: '999999999999999999.99',
                currency: 'BRL',
            }),
        });

        const entity = WagerTransactionMapper.toEntity(transaction);
        const reconstructed = WagerTransactionMapper.toDomain(entity);

        expect(entity.amount).toBe('999999999999999999.99');
        expect(reconstructed.money.toString()).toBe('999999999999999999.99');
        expect(reconstructed.money.getCurrency()).toBe('BRL');
    });
});
