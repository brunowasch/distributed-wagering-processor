import { randomUUID } from 'node:crypto';
import { Money } from '../../shared/domain/money.js';

/**
 * Parâmetros necessários para a criação ou inicialização de uma carteira.
 *
 * id: identificador único opcional da carteira (gerado automaticamente se não informado).
 * playerId: identificador do jogador que será o proprietário da carteira.
 * initialBalance: objeto de valor (Money) contendo o saldo e a moeda iniciais.
 *
 * O campo initialBalance define a moeda padrão da carteira,
 * que não poderá ser alterada após a criação.
 */
export interface WalletProps {
    id?: string;
    playerId: string;
    initialBalance: Money;
}

/**
 * Estado completo e atual da entidade de carteira no domínio.
 *
 * id: identificador único da carteira.
 * playerId: identificador do jogador proprietário da carteira.
 * currency: código da moeda associada à carteira (ex: BRL, USD).
 * balance: objeto de valor (Money) que representa o saldo atual disponível.
 * version: controle de versão da entidade para evitar conflitos em atualizações simultâneas.
 * createdAt: data e hora em que a carteira foi criada.
 * updatedAt: data e hora da última atualização realizada na carteira.
 *
 * Os campos createdAt, updatedAt e version são gerenciados internamente
 * pelo ciclo de vida da entidade e refletem seu estado persistido.
 */
export interface WalletState {
    id: string;
    playerId: string;
    currency: string;
    balance: Money;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

/** Agregado de carteira: encapsula saldo, moeda e versão alterados em conjunto. */
export class Wallet {
    /** Só permite criar ou restaurar estado por factories que preservam invariantes. */
    private constructor(
        public readonly id: string,
        public readonly playerId: string,
        public readonly currency: string,
        // Uma carteira recém-criada começa na versão 1.
        // A versão será utilizada no controle de concorrência.
        private _balance: Money,
        private _version: number,
        private readonly _createdAt: Date,
        private _updatedAt: Date,
    ) {}

    /** Abre uma carteira nova; a versão inicial é 1 e o saldo não pode ser negativo. */
    static open(props: WalletProps): Wallet {
        const id = props.id ?? randomUUID();

        if (!props.playerId.trim()) {
            throw new Error('Player ID is required.');
        }

        if (!id.trim()) {
            throw new Error('Wallet ID is required.');
        }

        if (!props.initialBalance.isZero() && !props.initialBalance.isPositive()) {
            throw new Error('Initial balance cannot be negative.');
        }

        const now = new Date();

        return new Wallet(
            id,
            props.playerId,
            props.initialBalance.getCurrency(),
            props.initialBalance,
            1,
            now,
            now,
        );
    }

    /** Restaura o estado persistido sem reaplicar regras de criação ou transição. */
    static rehydrate(state: WalletState): Wallet {
        return new Wallet(
            state.id,
            state.playerId,
            state.currency,
            state.balance,
            state.version,
            new Date(state.createdAt.getTime()),
            new Date(state.updatedAt.getTime()),
        );
    }

    /** Credita valor positivo da moeda da carteira e incrementa a versão do saldo. */
    credit(amount: Money): void {
        if (!amount.isPositive()) {
            throw new Error('Credit amount must be positive.');
        }

        this._balance = this._balance.add(amount);
        this._version++;
        this._updatedAt = new Date();
    }

    /** Debita valor positivo se houver fundos e incrementa a versão do saldo. */
    debit(amount: Money): void {
        if (!amount.isPositive()) {
            throw new Error('Debit amount must be positive.');
        }

        if (this._balance.isLessThan(amount)) {
            throw new Error('Insufficient funds.');
        }

        this._balance = this._balance.subtract(amount);
        this._version++;
        this._updatedAt = new Date();
    }

    /** Retorna cópia da data de criação para preservar o estado encapsulado. */
    get createdAt(): Date {
        return new Date(this._createdAt.getTime());
    }

    /** Retorna cópia da data da última alteração do saldo. */
    get updatedAt(): Date {
        return new Date(this._updatedAt.getTime());
    }

    /** Saldo atual imutável como Value Object monetário. */
    get balance(): Money {
        return this._balance;
    }

    /** Versão incrementada apenas quando o saldo sofre alteração. */
    get version(): number {
        return this._version;
    }
}
