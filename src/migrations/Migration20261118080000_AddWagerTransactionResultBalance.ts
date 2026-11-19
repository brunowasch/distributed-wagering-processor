import { Migration } from '@mikro-orm/migrations';

/** Persiste o saldo da resposta original para reproduzir idempotência com exatidão. */
export class Migration20261118080000_AddWagerTransactionResultBalance extends Migration {
    override name = 'Migration20261118080000_AddWagerTransactionResultBalance';

    /** Adiciona o snapshot de saldo necessário para reproduzir a resposta idempotente. */
    override up(): void {
        this.addSql('alter table "wager_transaction" add "result_balance_amount" numeric(20,2) null;');
        this.addSql('alter table "wager_transaction" add "result_balance_currency" varchar(3) null;');
    }

    /** Remove as colunas do snapshot de saldo. */
    override down(): void {
        this.addSql('alter table "wager_transaction" drop column "result_balance_currency", drop column "result_balance_amount";');
    }
}
