import { Migration } from '@mikro-orm/migrations';

/** Persiste tentativas/backoff para reprocessar referências recebidas fora de ordem. */
export class Migration20261118092000_AddPendingReferenceRetry extends Migration {
    override name = 'Migration20261118092000_AddPendingReferenceRetry';

    /** Armazena tentativas e agenda índices de busca para referências pendentes. */
    override up(): void {
        this.addSql('alter table "wager_transaction" add "reference_attempts" int not null default 0;');
        this.addSql('alter table "wager_transaction" add "next_reference_attempt_at" timestamptz null;');
        this.addSql(`create index "wager_transaction_pending_reference_index"
            on "wager_transaction" ("next_reference_attempt_at", "created_at")
            where "status" = 'PENDING_REFERENCE';`);
    }

    /** Remove o índice e as colunas de retry persistente. */
    override down(): void {
        this.addSql('drop index if exists "wager_transaction_pending_reference_index";');
        this.addSql('alter table "wager_transaction" drop column "next_reference_attempt_at", drop column "reference_attempts";');
    }
}
