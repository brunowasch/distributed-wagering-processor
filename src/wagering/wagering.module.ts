import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WagerTransactionRepository } from './wager-transaction.repository.js';
import { WageringService } from './wagering.service.js';

@Module({
    imports: [MikroOrmModule.forFeature([WagerTransactionEntity])],
    providers: [WagerTransactionRepository, WageringService],
    exports: [WagerTransactionRepository, WageringService],
})
export class WageringModule {}
