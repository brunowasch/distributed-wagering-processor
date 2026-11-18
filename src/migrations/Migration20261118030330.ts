import { Migration } from '@mikro-orm/migrations';

export class Migration20261118030330 extends Migration {

  override name = 'Migration20261118030330';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wallet" add "player_id" varchar(255) not null, add "currency" varchar(3) not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wallet" drop column "player_id", drop column "currency";`);
  }

}
