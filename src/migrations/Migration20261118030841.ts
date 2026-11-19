import { Migration } from '@mikro-orm/migrations';

/** Impede duas carteiras para o mesmo jogador e moeda. */
export class Migration20261118030841 extends Migration {

  override name = 'Migration20261118030841';

  /** Cria a constraint única por jogador/moeda. */
  override up(): void | Promise<void> {
    this.addSql(`alter table "wallet" add constraint "wallet_player_id_currency_unique" unique ("player_id", "currency");`);
  }

  /** Remove a constraint de unicidade desta migration. */
  override down(): void | Promise<void> {
    this.addSql(`alter table "wallet" drop constraint "wallet_player_id_currency_unique";`);
  }

}
