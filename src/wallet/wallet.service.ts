import { Injectable, NotFoundException } from '@nestjs/common';
import { Wallet } from './domain/wallet.js';
import { WalletRepository } from './wallet.repository.js';

/** Serviço de consulta simples da carteira usado por outros módulos. */
@Injectable()
export class WalletService {
    /** Injeta o repositório que localiza agregados persistidos. */
    constructor(
        private readonly walletRepository: WalletRepository,
    ) {}

    /** Busca uma carteira pelo ID ou lança NotFoundException. */
    async getWallet(id: string): Promise<Wallet> {
        const wallet = await this.walletRepository.findById(id);

        if (!wallet) {
            throw new NotFoundException(`Wallet with ID ${id} not found.`);
        }

        return wallet;
    }
}
