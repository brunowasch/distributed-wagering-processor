import { HttpException } from '@nestjs/common';
import { OptimisticLockError, UniqueConstraintViolationException } from '@mikro-orm/core';

/** Código estável armazenado para falhas de infraestrutura não recuperáveis. */
export const PERMANENT_INFRASTRUCTURE_FAILURE = 'PERMANENT_INFRASTRUCTURE_FAILURE';

/** Erro que informa ao consumidor SQS que a transação original já sofreu rollback. */
export class PermanentWageringProcessingError extends Error {
    readonly failureCode = PERMANENT_INFRASTRUCTURE_FAILURE;

    /** Preserva a causa técnica sem expô-la no contrato público ou nos logs financeiros. */
    constructor(cause: unknown) {
        super('Wager processing encountered a permanent infrastructure constraint failure.', { cause });
        this.name = PermanentWageringProcessingError.name;
    }
}

/**
 * Só uma violação PostgreSQL CHECK é definitiva para o mesmo payload.
 * Indisponibilidade, deadlock, serialization e unicidade continuam recuperáveis
 * ou são resolvidos pela idempotência e nunca devem terminar a transação como FAILED.
 */
export function isPermanentInfrastructureFailure(error: unknown): boolean {
    if (error instanceof HttpException
        || error instanceof OptimisticLockError
        || error instanceof UniqueConstraintViolationException) return false;

    const visited = new Set<unknown>();
    let current: unknown = error;
    while (current && typeof current === 'object' && !visited.has(current)) {
        visited.add(current);
        const value = current as { code?: unknown; sqlState?: unknown; cause?: unknown };
        if (value.sqlState === '23514' || value.code === '23514') return true;
        current = value.cause;
    }
    return false;
}
