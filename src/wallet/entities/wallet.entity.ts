import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

/**
 * Propriedades que representam a estrutura e o estado da carteira.
 *
 * id: identificador único da carteira.
 * playerId: identificador do jogador proprietário da carteira.
 * currency: código da moeda utilizada na carteira (ex: BRL, USD).
 * balance: saldo atual disponível na carteira, representado em texto para manter a precisão decimal.
 * version: controle de versão da entidade para evitar conflitos em atualizações simultâneas.
 *
 * O campo version deve ser incrementado a cada alteração de saldo
 * para garantir a integridade dos dados (Optimistic Locking).
 */
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
