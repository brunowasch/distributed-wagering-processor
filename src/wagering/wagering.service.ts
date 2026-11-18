import { Injectable, NotFoundException } from '@nestjs/common';
import { WagerTransaction } from './domain/wager-transaction.js';
import { WagerTransactionRepository } from './wager-transaction.repository.js';

/**
 * Serviço responsável por coordenar os casos de uso relacionados
 * às transações de apostas.
 *
 * Utiliza o repositório para consultar e persistir transações,
 * mantendo as regras de aplicação fora da camada de persistência.
 */
@Injectable()
export class WageringService {
    constructor(
        private readonly wagerTransactionRepository: WagerTransactionRepository,
    ) {}

    /**
     * Busca uma transação pelo identificador interno.
     *
     * Lança NotFoundException quando a transação não existe.
     */
    async getTransactionById(id: string): Promise<WagerTransaction> {
        const transaction = await this.wagerTransactionRepository.findById(id);

        if (!transaction) {
            throw new NotFoundException('Wager transaction not found.');
        }

        return transaction;
    }

    /**
     * Busca uma transação pela identificação fornecida pelo provedor.
     *
     * Lança NotFoundException quando a transação não existe.
     */
    async getTransactionByProvider(
        providerId: string,
        externalTransactionId: string,
    ): Promise<WagerTransaction> {
        const transaction =
            await this.wagerTransactionRepository.findByProviderAndExternalId(
                providerId,
                externalTransactionId,
            );

        if (!transaction) {
            throw new NotFoundException('Wager transaction not found.');
        }

        return transaction;
    }
}
