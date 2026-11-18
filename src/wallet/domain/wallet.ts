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

export class Wallet {
    // A carteira só pode ser criada por meio das factories,
    // garantindo que seu estado inicial respeite as regras do domínio.
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

    // Cria uma nova carteira para um jogador, garantindo que o estado inicial seja válido.
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

    // Reconstrói uma carteira a partir dos dados recuperados do banco de dados,
    // sem reaplicar as regras de criação ou transição do domínio.
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

    // Realiza um crédito garantindo que somente valores positivos
    // e compatíveis com a moeda da carteira sejam movimentados.
    credit(amount: Money): void {
        if (!amount.isPositive()) {
            throw new Error('Credit amount must be positive.');
        }

        this._balance = this._balance.add(amount);
        this._version++;
        this._updatedAt = new Date();
    }

    // Impede que o débito comprometa a invariante de saldo não negativo.
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

    // Getters expõem cópias das datas para impedir alterações externas no estado interno.
    get createdAt(): Date {
        return new Date(this._createdAt.getTime());
    }

    get updatedAt(): Date {
        return new Date(this._updatedAt.getTime());
    }

    get balance(): Money {
        return this._balance;
    }

    get version(): number {
        return this._version;
    }
}
