import { randomUUID } from 'node:crypto';
import { Money } from '../../shared/domain/money.js';

/**
 * Direção de uma movimentação registrada no ledger da carteira.
 *
 * DEBIT representa uma saída de dinheiro.
 * CREDIT representa uma entrada de dinheiro.
 */
export enum WalletLedgerDirection {
    DEBIT = 'DEBIT',
    CREDIT = 'CREDIT',
}

/**
 * Dados necessários para criar um lançamento financeiro.
 *
 * - walletId: carteira afetada pela movimentação.
 * - transactionId: transação de negócio que originou o lançamento.
 * - direction: indica se o valor foi debitado ou creditado.
 * - money: valor positivo movimentado.
 * - balanceBefore: saldo da carteira antes da movimentação.
 * - balanceAfter: saldo da carteira depois da movimentação.
 */
export interface WalletLedgerEntryProps {
    walletId: string;
    transactionId: string;
    direction: WalletLedgerDirection;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
}

/**
 * Estado completo necessário para reconstruir um lançamento persistido.
 *
 * Diferentemente da criação, a reidratação apenas restaura os dados
 * persistidos, sem reaplicar as validações das regras de criação.
 */
export interface WalletLedgerEntryState extends WalletLedgerEntryProps {
    id: string;
    createdAt: Date;
}

/**
 * Registro imutável de uma movimentação financeira da carteira.
 *
 * Cada transação que altera o saldo deve possuir exatamente um lançamento.
 * O valor registrado deve explicar a diferença entre o saldo anterior
 * e o saldo posterior, sem permitir que um débito gere saldo negativo.
 */
export class WalletLedgerEntry {
    private constructor(
        private readonly _id: string,
        private readonly _walletId: string,
        private readonly _transactionId: string,
        private readonly _direction: WalletLedgerDirection,
        private readonly _money: Money,
        private readonly _balanceBefore: Money,
        private readonly _balanceAfter: Money,
        private readonly _createdAt: Date,
    ) {}

    /**
     * Cria um lançamento validando a consistência da movimentação.
     */
    static create(props: WalletLedgerEntryProps): WalletLedgerEntry {
        if (!props.walletId.trim()) {
            throw new Error('Wallet ID is required.');
        }

        if (!props.transactionId.trim()) {
            throw new Error('Transaction ID is required.');
        }

        if (!Object.values(WalletLedgerDirection).includes(props.direction)) {
            throw new Error('Invalid wallet ledger direction.');
        }

        if (!props.money.isPositive()) {
            throw new Error('Ledger amount must be positive.');
        }

        if (props.balanceBefore.isNegative()) {
            throw new Error('Balance before cannot be negative.');
        }

        props.money.assertSameCurrency(props.balanceBefore);
        props.money.assertSameCurrency(props.balanceAfter);

        const expectedBalance = props.direction === WalletLedgerDirection.DEBIT
            ? props.balanceBefore.subtract(props.money)
            : props.balanceBefore.add(props.money);

        if (!expectedBalance.equals(props.balanceAfter)) {
            throw new Error('Ledger balance calculation is inconsistent.');
        }

        if (props.balanceAfter.isNegative()) {
            throw new Error('Ledger entry cannot result in a negative balance.');
        }

        return new WalletLedgerEntry(
            randomUUID(),
            props.walletId,
            props.transactionId,
            props.direction,
            props.money,
            props.balanceBefore,
            props.balanceAfter,
            new Date(),
        );
    }

    /**
     * Reconstrói um lançamento a partir dos dados persistidos.
     */
    static rehydrate(state: WalletLedgerEntryState): WalletLedgerEntry {
        return new WalletLedgerEntry(
            state.id,
            state.walletId,
            state.transactionId,
            state.direction,
            state.money,
            state.balanceBefore,
            state.balanceAfter,
            new Date(state.createdAt),
        );
    }

    get id(): string {
        return this._id;
    }

    get walletId(): string {
        return this._walletId;
    }

    get transactionId(): string {
        return this._transactionId;
    }

    get direction(): WalletLedgerDirection {
        return this._direction;
    }

    get money(): Money {
        return this._money;
    }

    get balanceBefore(): Money {
        return this._balanceBefore;
    }

    get balanceAfter(): Money {
        return this._balanceAfter;
    }

    get createdAt(): Date {
        return new Date(this._createdAt);
    }
}
