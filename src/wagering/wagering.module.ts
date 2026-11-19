import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { WagerTransactionRepository } from './wager-transaction.repository.js';
import { WageringService } from './wagering.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { MessagingModule } from '../shared/infrastructure/messaging/messaging.module.js';
import { PendingReferenceWorker } from './pending-reference.worker.js';

/** Registra persistência e processamento de apostas, incluindo retry de referências. */
@Module({
    imports: [MikroOrmModule.forFeature([WagerTransactionEntity]), WalletModule, MessagingModule],
    providers: [WagerTransactionRepository, WageringService, PendingReferenceWorker],
    exports: [WagerTransactionRepository, WageringService],
})
export class WageringModule {}
