import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { InboxMessageEntity } from './inbox-message.entity.js';
import { OutboxMessageEntity } from './outbox-message.entity.js';
import { InboxRepository } from './inbox.repository.js';
import { OutboxRepository } from './outbox.repository.js';
import { SqsClient } from './sqs-client.js';
import { OutboxPublisher } from './outbox-publisher.js';

/** Registra as entidades e adaptadores de mensageria compartilhados na aplicação. */
@Module({
    imports: [MikroOrmModule.forFeature([InboxMessageEntity, OutboxMessageEntity])],
    providers: [InboxRepository, OutboxRepository, SqsClient, OutboxPublisher],
    exports: [InboxRepository, OutboxRepository, SqsClient, OutboxPublisher],
})
export class MessagingModule {}
