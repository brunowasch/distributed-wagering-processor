import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WalletEntity } from './entities/wallet.entity.js';
import { WalletRepository } from './wallet.repository.js';
import { WalletService } from './wallet.service.js';

@Module({
    // Registra a entidade Wallet no contexto do módulo e no MikroORM.
    imports: [MikroOrmModule.forFeature([WalletEntity])],
    providers: [WalletRepository, WalletService],
    exports: [WalletService],
})
export class WalletModule {}
