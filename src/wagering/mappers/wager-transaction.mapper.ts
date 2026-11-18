import { Money } from '../../shared/domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';

/**
 * Responsável pela conversão entre a entidade de domínio
 * (WagerTransaction) e a entidade de persistência (WagerTransactionEntity).
 *
 * Mantém o domínio independente da estrutura utilizada pelo MikroORM.
 */
export class WagerTransactionMapper {

    // Converte a transação de domínio para a representação persistida.
    static toEntity(transaction: WagerTransaction): WagerTransactionEntity {
        return new WagerTransactionEntity({
            id: transaction.id,
            providerId: transaction.providerId,
            externalTransactionId: transaction.externalTransactionId,
            idempotencyKey: transaction.idempotencyKey,
            payloadHash: transaction.payloadHash,
            walletId: transaction.walletId,
            playerId: transaction.playerId,
            roundId: transaction.roundId,
            gameId: transaction.gameId,
            kind: transaction.kind,
            amount: transaction.money.toString(),
            currency: transaction.money.getCurrency(),
            referenceExternalTransactionId: transaction.referenceExternalTransactionId,
            status: transaction.status,
            referenceTransactionId: transaction.referenceTransactionId,
            failureCode: transaction.failureCode,
            createdAt: transaction.createdAt,
            processedAt: transaction.processedAt,
        });
    }

    // Reconstrói a transação de domínio a partir da entidade persistida.
    static toDomain(entity: WagerTransactionEntity): WagerTransaction {
        return WagerTransaction.rehydrate({
            id: entity.id,
            providerId: entity.providerId,
            externalTransactionId: entity.externalTransactionId,
            idempotencyKey: entity.idempotencyKey,
            payloadHash: entity.payloadHash,
            walletId: entity.walletId,
            playerId: entity.playerId,
            roundId: entity.roundId,
            gameId: entity.gameId,
            kind: entity.kind,
            money: Money.from({
                amount: entity.amount,
                currency: entity.currency,
            }),
            referenceExternalTransactionId: entity.referenceExternalTransactionId ?? undefined,
            createdAt: entity.createdAt,
            status: entity.status,
            referenceTransactionId: entity.referenceTransactionId ?? undefined,
            failureCode: entity.failureCode ?? undefined,
            processedAt: entity.processedAt ?? undefined,
        });
    }
}
