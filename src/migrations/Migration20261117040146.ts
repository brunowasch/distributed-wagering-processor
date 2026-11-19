import { Migration } from '@mikro-orm/migrations';

/** Cria a tabela-base de carteiras com saldo decimal e controle de versão. */
export class Migration20261117040146 extends Migration {

  override name = 'Migration20261117040146';

  /** Aplica a criação inicial da tabela wallet. */
  override up(): void | Promise<void> {
    this.addSql(`create table "wallet" ("id" uuid not null, "balance" numeric(20,2) not null default '0.00', "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
  }

  /** Reverte esta etapa removendo a tabela criada. */
  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "wallet" cascade;`);
  }

}
