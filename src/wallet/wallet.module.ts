import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WalletEntity } from './entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryRepository } from './repositories/wallet-ledger-entry.repository.js';
import { WalletRepository } from './wallet.repository.js';
import { WalletService } from './wallet.service.js';

@Module({
    // Registra a entidade Wallet no contexto do módulo e no MikroORM.
    imports: [MikroOrmModule.forFeature([WalletEntity, WalletLedgerEntryEntity])],
    providers: [WalletRepository, WalletLedgerEntryRepository, WalletService],
    exports: [WalletService, WalletLedgerEntryRepository],
})
export class WalletModule {}
