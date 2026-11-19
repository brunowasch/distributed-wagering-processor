import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

/** Deduplicação persistente de entregas SQS por consumidor e identificador da mensagem. */
@Entity({ tableName: 'inbox_message' })
@Unique({ name: 'inbox_message_consumer_message_unique', properties: ['consumerName', 'messageId'] })
export class InboxMessageEntity {
    @PrimaryKey({ type: 'uuid' })
    id!: string;

    @Property({ type: 'varchar', length: 100, fieldName: 'consumer_name' })
    consumerName!: string;

    @Property({ type: 'varchar', length: 255, fieldName: 'message_id' })
    messageId!: string;

    @Property({ type: 'varchar', length: 128, fieldName: 'payload_hash' })
    payloadHash!: string;

    @Property({ type: 'timestamptz', fieldName: 'received_at' })
    receivedAt = new Date();

    @Property({ type: 'timestamptz', nullable: true, fieldName: 'processed_at' })
    processedAt: Date | null = null;
}
