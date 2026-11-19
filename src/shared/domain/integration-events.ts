import { randomUUID } from 'node:crypto';
import { MoneyProps } from './money.js';
import { WalletLedgerDirection } from '../../wallet/domain/wallet-ledger-entry.js';
import { WagerTransaction, WagerTransactionKind } from '../../wagering/domain/wager-transaction.js';
import { WalletLedgerEntry } from '../../wallet/domain/wallet-ledger-entry.js';

/** Correlação e causalidade compartilhadas pelo envelope de integração. */
export interface EventContext {
    /** Identifica a solicitação que correlaciona logs e eventos relacionados. */
    correlationId: string;
    /** ID do evento ou comando que causou este evento, quando conhecido. */
    causationId?: string;
}

/** Propriedades comuns usadas para construir um evento versionado. */
export interface IntegrationEventProps<T> extends EventContext {
    /** UUID estável opcional; gerado pela classe base quando ausente. */
    eventId?: string;
    /** Raiz agregada à qual o evento pertence. */
    aggregateId: string;
    /** Horário do evento; assume o horário atual se omitido. */
    occurredAt?: Date;
    /** Dados específicos do tipo concreto de evento. */
    data: T;
}

/** Envelope serializável que fornece identidade e contexto estáveis aos consumidores. */
export abstract class IntegrationEvent<T> {
    abstract readonly eventType: string;
    abstract readonly version: number;
    readonly eventId: string;
    readonly aggregateId: string;
    readonly correlationId: string;
    readonly causationId?: string;
    readonly occurredAt: Date;
    readonly data: Readonly<T>;

    /** Inicializa identidade/contexto do evento e congela os dados fornecidos. */
    protected constructor(props: IntegrationEventProps<T>) {
        this.eventId = props.eventId ?? randomUUID();
        this.aggregateId = props.aggregateId;
        this.correlationId = props.correlationId;
        this.causationId = props.causationId;
        this.occurredAt = props.occurredAt ?? new Date();
        this.data = Object.freeze(props.data);
    }

    /** Produz o envelope JSON estável persistido pela Outbox e enviado ao broker. */
    toJSON() {
        return {
            eventId: this.eventId,
            eventType: this.eventType,
            aggregateId: this.aggregateId,
            correlationId: this.correlationId,
            ...(this.causationId ? { causationId: this.causationId } : {}),
            occurredAt: this.occurredAt.toISOString(),
            version: this.version,
            data: this.data,
        };
    }
}

/** Dados não monetários compartilhados pelos eventos de ciclo de vida da transação. */
export interface WagerTransactionEventData {
    /** ID interno persistido da operação. */
    transactionId: string;
    /** Provedor que enviou a operação. */
    providerId: string;
    /** Identificador externo atribuído pelo provedor. */
    externalTransactionId: string;
    /** Carteira associada à operação. */
    walletId: string;
    /** Jogador associado à operação. */
    playerId: string;
    /** Tipo de operação processado. */
    kind: WagerTransactionKind;
    /** Estado final ou pendente informado pelo evento. */
    status: string;
    /** Código estável da rejeição, quando a operação foi rejeitada. */
    failureCode?: string;
}

/** Projeta a transação para o payload público, omitindo campos internos desnecessários. */
function transactionData(transaction: WagerTransaction): WagerTransactionEventData {
    return {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        kind: transaction.kind,
        status: transaction.status,
        ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
    };
}

/** Evento emitido ao concluir uma operação, inclusive LOSS sem alteração de saldo. */
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionEventData> {
    readonly eventType = 'WagerTransactionProcessed';
    readonly version = 1;
    /** Cria o evento publicado quando uma operação alcança PROCESSED. */
    static from(transaction: WagerTransaction, context: EventContext) {
        return new WagerTransactionProcessed({ aggregateId: transaction.id, data: transactionData(transaction), ...context });
    }
}

/** Evento emitido para rejeições de regra de negócio com código de falha estável. */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionEventData> {
    readonly eventType = 'WagerTransactionRejected';
    readonly version = 1;
    /** Cria o evento publicado quando uma regra de negócio rejeita a operação. */
    static from(transaction: WagerTransaction, context: EventContext) {
        return new WagerTransactionRejected({ aggregateId: transaction.id, data: transactionData(transaction), ...context });
    }
}

/** Evento emitido quando uma operação aguarda uma referência ainda não recebida. */
export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionEventData> {
    readonly eventType = 'WagerTransactionPendingReference';
    readonly version = 1;
    /** Cria o evento que sinaliza dependência ainda não resolvida. */
    static from(transaction: WagerTransaction, context: EventContext) {
        return new WagerTransactionPendingReference({ aggregateId: transaction.id, data: transactionData(transaction), ...context });
    }
}

/** Snapshot serializável de uma alteração de saldo e sua versão de carteira. */
export interface WalletBalanceChangedData {
    /** Carteira cujo saldo foi alterado. */
    walletId: string;
    /** Transação financeira que produziu o lançamento. */
    transactionId: string;
    /** Sentido da movimentação aplicada. */
    direction: WalletLedgerDirection;
    /** Quantia movimentada em formato decimal textual. */
    money: MoneyProps;
    /** Snapshot do saldo anterior ao lançamento. */
    balanceBefore: MoneyProps;
    /** Snapshot do saldo posterior ao lançamento. */
    balanceAfter: MoneyProps;
    /** Versão do agregado após a alteração. */
    walletVersion: number;
}

/** Evento emitido somente quando um lançamento altera o saldo materializado. */
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
    readonly eventType = 'WalletBalanceChanged';
    readonly version = 1;
    /** Monta o evento a partir do lançamento que explica a alteração de saldo. */
    static from(
        transaction: WagerTransaction,
        entry: WalletLedgerEntry,
        walletVersion: number,
        context: EventContext,
    ) {
        return new WalletBalanceChanged({
            aggregateId: entry.walletId,
            data: {
                walletId: entry.walletId,
                transactionId: transaction.id,
                direction: entry.direction,
                money: entry.money.toJSON(),
                balanceBefore: entry.balanceBefore.toJSON(),
                balanceAfter: entry.balanceAfter.toJSON(),
                walletVersion,
            },
            ...context,
        });
    }
}
