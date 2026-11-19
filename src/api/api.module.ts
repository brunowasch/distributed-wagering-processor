import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/infrastructure/database/database.module.js';
import { MessagingModule } from '../shared/infrastructure/messaging/messaging.module.js';
import { WageringModule } from '../wagering/wagering.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { WalletApplicationService } from '../wallet/wallet-application.service.js';
import { HealthController, MetricsController, ProviderTransactionController, WalletController, WageringController } from './api.controller.js';
import { WagerTransactionConsumer } from '../shared/infrastructure/messaging/wager-transaction-consumer.js';

/** Registra controllers HTTP e casos de uso expostos pela API. */
@Module({
    imports: [DatabaseModule, MessagingModule, WalletModule, WageringModule],
    controllers: [WalletController, WageringController, ProviderTransactionController, HealthController, MetricsController],
    providers: [WalletApplicationService, WagerTransactionConsumer],
})
export class ApiModule {}
