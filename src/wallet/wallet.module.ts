import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Wallet } from './entities/wallet.entity.js';

@Module({
    imports: [
        // Registra a entidade Wallet no contexto do módulo e no MikroORM.
        MikroOrmModule.forFeature([Wallet]),
    ],
    exports: [ MikroOrmModule ]
})

export class WalletModule{}