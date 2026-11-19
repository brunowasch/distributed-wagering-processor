import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

/** Registro durável de um evento que só pode ser publicado após o commit financeiro. */
@Entity({ tableName: 'outbox_message' })
@Unique({ name: 'outbox_message_event_id_unique', properties: ['eventId'] })
@Index({ name: 'outbox_message_pending_index', properties: ['publishedAt', 'nextAttemptAt', 'occurredAt'] })
export class OutboxMessageEntity {
    @PrimaryKey({ type: 'uuid' })
    id!: string;

    @Property({ type: 'uuid', fieldName: 'event_id' })
    eventId!: string;

    @Property({ type: 'uuid', fieldName: 'aggregate_id' })
    aggregateId!: string;

    @Property({ type: 'varchar', length: 100, fieldName: 'event_type' })
    eventType!: string;

    @Property({ type: 'json', columnType: 'jsonb' })
    payload!: Record<string, unknown>;

    @Property({ type: 'timestamptz', fieldName: 'occurred_at' })
    occurredAt!: Date;

    @Property({ type: 'integer' })
    attempts = 0;

    @Property({ type: 'timestamptz', nullable: true, fieldName: 'next_attempt_at' })
    nextAttemptAt: Date | null = null;

    @Property({ type: 'timestamptz', nullable: true, fieldName: 'published_at' })
    publishedAt: Date | null = null;
}
