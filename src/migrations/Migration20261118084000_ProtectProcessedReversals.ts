import { Migration } from '@mikro-orm/migrations';

/** Não permite que REFUND/ROLLBACK confirmados revertam duas vezes a mesma referência. */
export class Migration20261118084000_ProtectProcessedReversals extends Migration {
    override name = 'Migration20261118084000_ProtectProcessedReversals';

    /** Impede no banco duas reversões processadas do mesmo tipo para uma referência. */
    override up(): void {
        this.addSql(`create unique index "wager_transaction_processed_reversal_unique"
            on "wager_transaction" ("reference_transaction_id", "kind")
            where "status" = 'PROCESSED' and "kind" in ('REFUND', 'ROLLBACK');`);
    }

    /** Remove o índice parcial de proteção das reversões. */
    override down(): void {
        this.addSql('drop index if exists "wager_transaction_processed_reversal_unique";');
    }
}
