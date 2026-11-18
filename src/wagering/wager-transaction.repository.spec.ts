import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from './domain/wager-transaction.js';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WagerTransactionMapper } from './mappers/wager-transaction.mapper.js';
import { WagerTransactionRepository } from './wager-transaction.repository.js';

describe('WagerTransactionRepository', () => {
    const entityManager = {
        findOne: vi.fn(),
        findOneOrFail: vi.fn(),
        persist: vi.fn(),
        assign: vi.fn(),
    };

    let repository: WagerTransactionRepository;

    // Cria uma entidade completa para os testes de consulta.
    const createEntity = () =>
        new WagerTransactionEntity({
            id: '550e8400-e29b-41d4-a716-446655440000',
            providerId: 'provider-123',
            externalTransactionId: 'external-123',
            idempotencyKey: 'provider-123:external-123',
            payloadHash: 'valid-payload-hash',
            walletId: '550e8400-e29b-41d4-a716-446655440001',
            playerId: 'player-123',
            roundId: 'round-123',
            gameId: 'game-123',
            kind: WagerTransactionKind.BET,
            amount: '25.50',
            currency: 'BRL',
            status: WagerTransactionStatus.PENDING,
        });

    beforeEach(() => {
        vi.clearAllMocks();

        repository = new WagerTransactionRepository(entityManager as never);
    });

    it('should find a transaction by internal id', async () => {
        const entity = createEntity();

        entityManager.findOne.mockResolvedValue(entity);

        const result = await repository.findById(entity.id);

        expect(entityManager.findOne).toHaveBeenCalledWith(
            WagerTransactionEntity,
            { id: entity.id },
        );
        expect(result).toBeInstanceOf(WagerTransaction);
    });

    it('should return null when transaction is not found by internal id', async () => {
        entityManager.findOne.mockResolvedValue(null);

        const result = await repository.findById('transaction-123');

        expect(result).toBeNull();
    });

    it('should find a transaction by provider and external id', async () => {
        const entity = createEntity();

        entityManager.findOne.mockResolvedValue(entity);

        const result = await repository.findByProviderAndExternalId(
            'provider-123',
            'external-123',
        );

        expect(entityManager.findOne).toHaveBeenCalledWith(
            WagerTransactionEntity,
            {
                providerId: 'provider-123',
                externalTransactionId: 'external-123',
            },
        );
        expect(result).toBeInstanceOf(WagerTransaction);
    });

    it('should return null when transaction is not found by provider and external id', async () => {
        entityManager.findOne.mockResolvedValue(null);

        const result = await repository.findByProviderAndExternalId(
            'provider-123',
            'external-123',
        );

        expect(result).toBeNull();
    });

    it('should find a transaction by idempotency key', async () => {
        const entity = createEntity();

        entityManager.findOne.mockResolvedValue(entity);

        const result = await repository.findByIdempotencyKey(
            'provider-123:external-123',
        );

        expect(entityManager.findOne).toHaveBeenCalledWith(
            WagerTransactionEntity,
            {
                idempotencyKey: 'provider-123:external-123',
            },
        );
        expect(result).toBeInstanceOf(WagerTransaction);
    });

    it('should return null when transaction is not found by idempotency key', async () => {
        entityManager.findOne.mockResolvedValue(null);

        const result = await repository.findByIdempotencyKey(
            'provider-123:external-123',
        );

        expect(result).toBeNull();
    });

    it('should persist a new transaction entity', async () => {
        const transaction = {
            id: 'transaction-123',
        } as WagerTransaction;

        const entity = createEntity();

        const mapperSpy = vi
            .spyOn(WagerTransactionMapper, 'toEntity')
            .mockReturnValue(entity);

        await repository.create(transaction);

        expect(mapperSpy).toHaveBeenCalledWith(transaction);
        expect(entityManager.persist).toHaveBeenCalledWith(entity);
    });

    it('should update the mutable properties of an existing transaction', async () => {
        const transaction = {
            id: 'transaction-123',
            status: WagerTransactionStatus.PROCESSED,
            referenceTransactionId: 'reference-123',
            failureCode: undefined,
            processedAt: new Date('2026-01-10T10:00:00.000Z'),
        } as unknown as WagerTransaction;

        const entity = createEntity();

        entityManager.findOneOrFail.mockResolvedValue(entity);

        await repository.update(transaction);

        expect(entityManager.findOneOrFail).toHaveBeenCalledWith(
            WagerTransactionEntity,
            { id: 'transaction-123' },
        );

        expect(entityManager.assign).toHaveBeenCalledWith(entity, {
            status: transaction.status,
            referenceTransactionId: transaction.referenceTransactionId,
            failureCode: null,
            processedAt: transaction.processedAt,
        });
    });
});
