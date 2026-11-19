import { Migration } from '@mikro-orm/migrations';

/** Cria transações financeiras, referências e constraints persistentes de idempotência. */
export class Migration20261118040241_CreateWagerTransaction extends Migration {

    override name = 'Migration20261118040241_CreateWagerTransaction';

    /** Cria tabela, checks, FKs e chaves únicas das transações de aposta. */
    override up(): void {
        this.addSql(`
            create table "wager_transaction" (
                "id" uuid not null,
                "provider_id" varchar(255) not null,
                "external_transaction_id" varchar(255) not null,
                "idempotency_key" varchar(255) not null,
                "payload_hash" varchar(128) not null,
                "wallet_id" uuid not null,
                "player_id" varchar(255) not null,
                "round_id" varchar(255) not null,
                "game_id" varchar(255) not null,
                "kind" varchar(32) not null,
                "amount" numeric(20,2) not null,
                "currency" varchar(3) not null,
                "reference_external_transaction_id" varchar(255) null,
                "status" varchar(32) not null,
                "reference_transaction_id" uuid null,
                "failure_code" varchar(100) null,
                "created_at" timestamptz not null,
                "processed_at" timestamptz null,
                primary key ("id"),
                constraint "wager_transaction_amount_positive_check"
                    check ("amount" > 0)
            );
        `);

        this.addSql(`
            alter table "wager_transaction"
            add constraint "wager_transaction_wallet_id_foreign"
            foreign key ("wallet_id") references "wallet" ("id")
            on update cascade on delete restrict;
        `);

        this.addSql(`
            alter table "wager_transaction"
            add constraint "wager_transaction_reference_transaction_id_foreign"
            foreign key ("reference_transaction_id")
            references "wager_transaction" ("id")
            on update cascade on delete restrict;
        `);

        this.addSql(`
            alter table "wager_transaction"
            add constraint "wager_transaction_provider_id_external_transaction_id_unique"
            unique ("provider_id", "external_transaction_id");
        `);

        this.addSql(`
            alter table "wager_transaction"
            add constraint "wager_transaction_idempotency_key_unique"
            unique ("idempotency_key");
        `);
    }

    /** Remove a tabela criada por esta migration e suas constraints dependentes. */
    override down(): void {
        this.addSql(`drop table if exists "wager_transaction" cascade;`);
    }
}
