import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { WagerTransactionKind, WagerTransactionStatus } from '../domain/wager-transaction.js';

/**
 * Propriedades que representam os dados persistidos de uma transação de aposta.
 *
 * id: identificador único interno da transação.
 * providerId: identificador do provedor responsável pela operação.
 * externalTransactionId: identificador da transação no sistema do provedor.
 * idempotencyKey: chave utilizada para impedir o processamento duplicado.
 * payloadHash: hash utilizado para verificar a integridade de retentativas.
 * walletId: identificador da carteira relacionada à operação.
 * playerId: identificador do jogador.
 * roundId: identificador da rodada do jogo.
 * gameId: identificador do jogo.
 * kind: natureza da transação (BET, WIN, LOSS, REFUND, ROLLBACK ou OPENING).
 * amount: valor monetário armazenado como texto para preservar a precisão decimal.
 * currency: código ISO-4217 da moeda.
 * referenceExternalTransactionId: identificador externo da transação original, quando aplicável.
 * status: estado atual do processamento.
 * referenceTransactionId: identificador interno da transação original, quando aplicável.
 * failureCode: código que identifica o motivo de rejeição ou falha.
 * createdAt: data de criação da transação.
 * processedAt: data de finalização do processamento, quando aplicável.
 *
 * A combinação providerId + externalTransactionId e a idempotencyKey
 * possuem restrições de unicidade para garantir a integridade mesmo
 * quando múltiplas instâncias da aplicação processam requisições simultaneamente.
 */
export interface WagerTransactionEntityProps {
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    amount: string;
    currency: string;
    referenceExternalTransactionId?: string | null;
    status: WagerTransactionStatus;
    referenceTransactionId?: string | null;
    failureCode?: string | null;
    createdAt?: Date;
    processedAt?: Date | null;
}

@Entity({ tableName: 'wager_transaction' })
@Unique({ properties: ['idempotencyKey'] })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
export class WagerTransactionEntity {
    @PrimaryKey({ type: 'uuid' })
    id!: string;

    @Property({ type: 'string', length: 255 })
    providerId!: string;

    @Property({ type: 'string', length: 255 })
    externalTransactionId!: string;

    @Property({ type: 'string', length: 255 })
    idempotencyKey!: string;

    @Property({ type: 'string', length: 128 })
    payloadHash!: string;

    @Property({ type: 'uuid' })
    walletId!: string;

    @Property({ type: 'string', length: 255 })
    playerId!: string;

    @Property({ type: 'string', length: 255 })
    roundId!: string;

    @Property({ type: 'string', length: 255 })
    gameId!: string;

    @Property({ type: 'string', length: 32 })
    kind!: WagerTransactionKind;

    // NUMERIC preserva a precisão dos valores monetários no PostgreSQL.
    @Property({ type: 'string', columnType: 'numeric(20,2)' })
    amount!: string;

    @Property({ type: 'string', length: 3 })
    currency!: string;

    @Property({ type: 'string', length: 255, nullable: true })
    referenceExternalTransactionId: string | null = null;

    @Property({ type: 'string', length: 32 })
    status!: WagerTransactionStatus;

    @Property({ type: 'uuid', nullable: true })
    referenceTransactionId: string | null = null;

    @Property({ type: 'string', length: 100, nullable: true })
    failureCode: string | null = null;

    @Property({ onCreate: () => new Date() })
    createdAt = new Date();

    @Property({ type: 'Date', nullable: true })
    processedAt: Date | null = null;

    constructor(props?: WagerTransactionEntityProps) {
        if (props) {
            this.id = props.id;
            this.providerId = props.providerId;
            this.externalTransactionId = props.externalTransactionId;
            this.idempotencyKey = props.idempotencyKey;
            this.payloadHash = props.payloadHash;
            this.walletId = props.walletId;
            this.playerId = props.playerId;
            this.roundId = props.roundId;
            this.gameId = props.gameId;
            this.kind = props.kind;
            this.amount = props.amount;
            this.currency = props.currency;
            this.referenceExternalTransactionId = props.referenceExternalTransactionId ?? null;
            this.status = props.status;
            this.referenceTransactionId = props.referenceTransactionId ?? null;
            this.failureCode = props.failureCode ?? null;
            this.createdAt = props.createdAt ?? new Date();
            this.processedAt = props.processedAt ?? null;
        }
    }
}
