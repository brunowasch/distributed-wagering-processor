import { Injectable, NotFoundException } from '@nestjs/common';
import { Wallet } from './domain/wallet.js';
import { WalletRepository } from './wallet.repository.js';

@Injectable()
export class WalletService {
    constructor(
        private readonly walletRepository: WalletRepository,
    ) {}

    // Busca uma carteira ou lança uma exceção caso ela não exista.
    async getWallet(id: string): Promise<Wallet> {
        const wallet = await this.walletRepository.findById(id);

        if (!wallet) {
            throw new NotFoundException(`Wallet with ID ${id} not found.`);
        }

        return wallet;
    }
}
