import { Migration } from '@mikro-orm/migrations';

/** O PostgreSQL também impede saldo negativo em escritas fora do caso de uso. */
export class Migration20261118100000_EnforceWalletBalanceNonNegative extends Migration {
    override name = 'Migration20261118100000_EnforceWalletBalanceNonNegative';

    /** Faz o PostgreSQL rejeitar saldo de carteira negativo. */
    override up(): void {
        this.addSql(`alter table "wallet" add constraint "wallet_balance_non_negative_check" check ("balance" >= 0);`);
    }

    /** Remove a constraint de saldo não negativo. */
    override down(): void {
        this.addSql('alter table "wallet" drop constraint if exists "wallet_balance_non_negative_check";');
    }
}
