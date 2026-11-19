import { Migration } from '@mikro-orm/migrations';

/** Persistência do padrão inbox/outbox com chaves deduplicadoras impostas pelo banco. */
export class Migration20261118082000_CreateInboxOutbox extends Migration {
    override name = 'Migration20261118082000_CreateInboxOutbox';

    /** Cria tabelas Inbox/Outbox e índice que acelera a busca de publicação pendente. */
    override up(): void {
        this.addSql(`create table "inbox_message" (
            "id" uuid not null,
            "consumer_name" varchar(100) not null,
            "message_id" varchar(255) not null,
            "payload_hash" varchar(128) not null,
            "received_at" timestamptz not null,
            "processed_at" timestamptz null,
            primary key ("id"),
            constraint "inbox_message_consumer_message_unique" unique ("consumer_name", "message_id")
        );`);
        this.addSql(`create table "outbox_message" (
            "id" uuid not null,
            "event_id" uuid not null,
            "aggregate_id" uuid not null,
            "event_type" varchar(100) not null,
            "payload" jsonb not null,
            "occurred_at" timestamptz not null,
            "attempts" int not null default 0,
            "next_attempt_at" timestamptz null,
            "published_at" timestamptz null,
            primary key ("id"),
            constraint "outbox_message_event_id_unique" unique ("event_id")
        );`);
        this.addSql(`create index "outbox_message_pending_index" on "outbox_message" ("published_at", "next_attempt_at", "occurred_at");`);
    }

    /** Remove Outbox e Inbox, na ordem que respeita dependências. */
    override down(): void {
        this.addSql('drop table if exists "outbox_message";');
        this.addSql('drop table if exists "inbox_message";');
    }
}
