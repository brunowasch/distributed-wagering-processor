import { Migration } from '@mikro-orm/migrations';

/** Impõe imutabilidade e coerência aritmética do ledger também no PostgreSQL. */
export class Migration20261118090000_EnforceLedgerImmutability extends Migration {
    override name = 'Migration20261118090000_EnforceLedgerImmutability';

    /** Adiciona equação contábil e trigger que rejeita UPDATE/DELETE do ledger. */
    override up(): void {
        this.addSql(`alter table "wallet_ledger_entry"
            add constraint "wallet_ledger_entry_balance_equation_check"
            check (("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount")
                or ("direction" = 'CREDIT' and "balance_after" = "balance_before" + "amount"));`);
        this.addSql(`create function "reject_wallet_ledger_mutation"() returns trigger
            language plpgsql as $$
            begin
                raise exception 'wallet_ledger_entry is immutable';
            end;
            $$;`);
        this.addSql(`create trigger "wallet_ledger_entry_immutable_trigger"
            before update or delete on "wallet_ledger_entry"
            for each row execute function "reject_wallet_ledger_mutation"();`);
    }

    /** Remove trigger, função e check criados para proteger o ledger. */
    override down(): void {
        this.addSql('drop trigger if exists "wallet_ledger_entry_immutable_trigger" on "wallet_ledger_entry";');
        this.addSql('drop function if exists "reject_wallet_ledger_mutation"();');
        this.addSql('alter table "wallet_ledger_entry" drop constraint if exists "wallet_ledger_entry_balance_equation_check";');
    }
}
