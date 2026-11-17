import { Migration } from '@mikro-orm/migrations';

export class Migration20261117040146 extends Migration {

  override name = 'Migration20261117040146';

  override up(): void | Promise<void> {
    this.addSql(`create table "wallet" ("id" uuid not null, "balance" numeric(20,2) not null default '0.00', "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "wallet" cascade;`);
  }

}
