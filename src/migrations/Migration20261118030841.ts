import { Migration } from '@mikro-orm/migrations';

export class Migration20261118030841 extends Migration {

  override name = 'Migration20261118030841';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wallet" add constraint "wallet_player_id_currency_unique" unique ("player_id", "currency");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wallet" drop constraint "wallet_player_id_currency_unique";`);
  }

}
