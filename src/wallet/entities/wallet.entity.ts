import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

export interface WalletEntityProps {
    id: string;
    playerId: string;
    currency: string;
    balance: string;
    version: number;
}

@Entity({ tableName: 'wallet' })
@Unique({ properties: ['playerId', 'currency'] })
export class WalletEntity {
    @PrimaryKey({ type: 'uuid' })
    id!: string;

    @Property({ type: 'string', length: 255 })
    playerId!: string;

    @Property({ type: 'string', length: 3 })
    currency!: string;

    // NUMERIC evita que valores monetários sejam armazenados como ponto flutuante.
    @Property({ type: 'string', columnType: 'numeric(20,2)' })
    balance = '0.00';

    // Controle otimista de concorrência gerenciado pelo MikroORM.
    @Property({ version: true })
    version = 1;

    @Property({ onCreate: () => new Date() })
    createdAt = new Date();

    @Property({ onCreate: () => new Date(), onUpdate: () => new Date() })
    updatedAt = new Date();

    constructor(props?: WalletEntityProps) {
        if (props) {
            this.id = props.id;
            this.playerId = props.playerId;
            this.currency = props.currency;
            this.balance = props.balance;
            this.version = props.version;
        }
    }
}
