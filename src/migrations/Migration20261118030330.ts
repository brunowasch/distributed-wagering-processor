import { Migration } from '@mikro-orm/migrations';

/** Acrescenta a identidade do jogador e moeda à tabela de carteiras. */
export class Migration20261118030330 extends Migration {

  override name = 'Migration20261118030330';

  /** Aplica as colunas necessárias para identificar proprietário e moeda. */
  override up(): void | Promise<void> {
    this.addSql(`alter table "wallet" add "player_id" varchar(255) not null, add "currency" varchar(3) not null;`);
  }

  /** Remove as colunas adicionadas por esta migration. */
  override down(): void | Promise<void> {
    this.addSql(`alter table "wallet" drop column "player_id", drop column "currency";`);
  }

}
