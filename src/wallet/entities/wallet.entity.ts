import { randomUUID } from "node:crypto";
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallet' })
export class Wallet {
    // Identificador único da carteira, gerado automaticamente.
    @PrimaryKey({ type: 'uuid' })
    id: string = randomUUID();

    // NUMERIC evita que valores monetários sejam armazenados como ponto flutuante.
    @Property({ columnType: 'numeric(20,2)' })
    balance: string = '0.00'

    // Controle otimista de concorrência para identificar atualizações simultâneas.
    @Property({ version: true })
    version: number = 1;

    @Property({ onCreate: () => new Date() })
    createdAt: Date = new Date();

    @Property({ onCreate: () => new Date(), onUpdate: () => new Date() })
    updatedAt: Date = new Date();
}