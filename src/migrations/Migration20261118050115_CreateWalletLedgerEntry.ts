import { Migration } from '@mikro-orm/migrations';

/** Cria o ledger imutável com FKs, unicidade, índices e checks básicos. */
export class Migration20261118050115_CreateWalletLedgerEntry extends Migration {

    override name = 'Migration20261118050115_CreateWalletLedgerEntry';

    /** Cria a tabela do ledger e aplica restrições de integridade financeira. */
    override up(): void {
        this.addSql(`
            create table "wallet_ledger_entry" (
                "id" uuid not null,
                "wallet_id" uuid not null,
                "transaction_id" uuid not null,
                "direction" varchar(10) not null,
                "amount" numeric(20,2) not null,
                "currency" varchar(3) not null,
                "balance_before" numeric(20,2) not null,
                "balance_after" numeric(20,2) not null,
                "created_at" timestamptz not null,
                primary key ("id")
            );
        `);

        // Garante que cada transação tenha apenas um lançamento por carteira.
        this.addSql(`
            alter table "wallet_ledger_entry"
            add constraint "wallet_ledger_entry_wallet_transaction_unique"
            unique ("wallet_id", "transaction_id");
        `);

        // Impede lançamentos associados a carteiras ou transações inexistentes.
        this.addSql(`
            alter table "wallet_ledger_entry"
            add constraint "wallet_ledger_entry_wallet_id_foreign"
            foreign key ("wallet_id")
            references "wallet" ("id")
            on update cascade
            on delete restrict;
        `);

        this.addSql(`
            alter table "wallet_ledger_entry"
            add constraint "wallet_ledger_entry_transaction_id_foreign"
            foreign key ("transaction_id")
            references "wager_transaction" ("id")
            on update cascade
            on delete restrict;
        `);

        // Permite consultar o histórico de movimentações de uma carteira.
        this.addSql(`
            create index "wallet_ledger_entry_wallet_created_at_index"
            on "wallet_ledger_entry" ("wallet_id", "created_at");
        `);

        // Garante que somente lançamentos de crédito ou débito sejam registrados.
        this.addSql(`
            alter table "wallet_ledger_entry"
            add constraint "wallet_ledger_entry_direction_check"
            check ("direction" IN ('DEBIT', 'CREDIT'));
        `);

        // Impede valores movimentados iguais a zero ou negativos.
        this.addSql(`
            alter table "wallet_ledger_entry"
            add constraint "wallet_ledger_entry_amount_positive_check"
            check ("amount" > 0);
        `);

        // Impede que os saldos registrados sejam negativos.
        this.addSql(`
            alter table "wallet_ledger_entry"
            add constraint "wallet_ledger_entry_balance_before_non_negative_check"
            check ("balance_before" >= 0);
        `);

        this.addSql(`
            alter table "wallet_ledger_entry"
            add constraint "wallet_ledger_entry_balance_after_non_negative_check"
            check ("balance_after" >= 0);
        `);
    }

    /** Remove a tabela do ledger e os objetos dependentes criados nesta migration. */
    override down(): void {
        this.addSql(`
            drop table if exists "wallet_ledger_entry" cascade;
        `);
    }
}
