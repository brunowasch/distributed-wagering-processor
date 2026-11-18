import { describe, expect, it } from 'vitest';
import { WagerTransactionKind, WagerTransactionStatus } from '../domain/wager-transaction.js';
import { WagerTransactionEntity } from './wager-transaction.entity.js';

describe('WagerTransactionEntity', () => {
    const createValidProps = () => ({
        id: '550e8400-e29b-41d4-a716-446655440000',
        providerId: 'provider-123',
        externalTransactionId: 'external-transaction-123',
        idempotencyKey: 'provider-123:external-transaction-123',
        payloadHash: 'valid-payload-hash',
        walletId: '550e8400-e29b-41d4-a716-446655440001',
        playerId: 'player-123',
        roundId: 'round-123',
        gameId: 'game-123',
        kind: WagerTransactionKind.BET,
        amount: '25.00',
        currency: 'BRL',
        status: WagerTransactionStatus.PENDING,
    });

    it('should create an entity with all provided properties', () => {
        const props = createValidProps();
        const entity = new WagerTransactionEntity(props);

        expect(entity.id).toBe(props.id);
        expect(entity.providerId).toBe(props.providerId);
        expect(entity.externalTransactionId).toBe(props.externalTransactionId);
        expect(entity.idempotencyKey).toBe(props.idempotencyKey);
        expect(entity.payloadHash).toBe(props.payloadHash);
        expect(entity.walletId).toBe(props.walletId);
        expect(entity.playerId).toBe(props.playerId);
        expect(entity.roundId).toBe(props.roundId);
        expect(entity.gameId).toBe(props.gameId);
        expect(entity.kind).toBe(props.kind);
        expect(entity.amount).toBe(props.amount);
        expect(entity.currency).toBe(props.currency);
        expect(entity.status).toBe(props.status);
    });

    it('should initialize optional properties with null', () => {
        const entity = new WagerTransactionEntity(createValidProps());

        expect(entity.referenceExternalTransactionId).toBeNull();
        expect(entity.referenceTransactionId).toBeNull();
        expect(entity.failureCode).toBeNull();
        expect(entity.processedAt).toBeNull();
    });

    it('should preserve provided optional properties', () => {
        const entity = new WagerTransactionEntity({
            ...createValidProps(),
            referenceExternalTransactionId: 'external-reference-123',
            referenceTransactionId: '550e8400-e29b-41d4-a716-446655440002',
            failureCode: 'INSUFFICIENT_FUNDS',
            processedAt: new Date('2026-01-10T10:00:00.000Z'),
        });

        expect(entity.referenceExternalTransactionId).toBe('external-reference-123');
        expect(entity.referenceTransactionId).toBe('550e8400-e29b-41d4-a716-446655440002');
        expect(entity.failureCode).toBe('INSUFFICIENT_FUNDS');
        expect(entity.processedAt).toEqual(new Date('2026-01-10T10:00:00.000Z'));
    });

    it('should preserve monetary values as strings', () => {
        const entity = new WagerTransactionEntity({
            ...createValidProps(),
            amount: '999999999999999999.99',
        });

        expect(entity.amount).toBe('999999999999999999.99');
        expect(typeof entity.amount).toBe('string');
    });

    it('should preserve transaction kind and status', () => {
        const entity = new WagerTransactionEntity({
            ...createValidProps(),
            kind: WagerTransactionKind.ROLLBACK,
            status: WagerTransactionStatus.PENDING_REFERENCE,
            referenceExternalTransactionId: 'external-reference-123',
        });

        expect(entity.kind).toBe(WagerTransactionKind.ROLLBACK);
        expect(entity.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
    });

    it('should use the provided creation date', () => {
        const createdAt = new Date('2026-01-10T10:00:00.000Z');
        const entity = new WagerTransactionEntity({
            ...createValidProps(),
            createdAt,
        });

        expect(entity.createdAt).toEqual(createdAt);
    });
});
