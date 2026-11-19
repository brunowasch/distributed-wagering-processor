import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
    isPermanentInfrastructureFailure,
    PermanentWageringProcessingError,
    PERMANENT_INFRASTRUCTURE_FAILURE,
} from './permanent-processing-failure.js';

describe('permanent processing failure classification', () => {
    it('classifies PostgreSQL CHECK violations as terminal for an unchanged payload', () => {
        expect(isPermanentInfrastructureFailure({ code: '23514' })).toBe(true);
        expect(isPermanentInfrastructureFailure({ cause: { sqlState: '23514' } })).toBe(true);
    });

    it.each([
        { code: 'ECONNREFUSED' },
        { code: '08006' },
        { code: '40001' },
        { code: '40P01' },
        { code: '55P03' },
        { code: '23505' },
        new BadRequestException(),
        new ServiceUnavailableException(),
    ])('keeps recoverable or business errors retryable: %s', (error) => {
        expect(isPermanentInfrastructureFailure(error)).toBe(false);
    });

    it('wraps the permanent failure with a stable public code and preserves its cause', () => {
        const cause = { code: '23514' };
        const error = new PermanentWageringProcessingError(cause);
        expect(error.failureCode).toBe(PERMANENT_INFRASTRUCTURE_FAILURE);
        expect(error.cause).toBe(cause);
    });
});
