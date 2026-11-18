import { Decimal } from 'decimal.js';
import { isValidCurrency } from './currency.js';

export interface MoneyProps {
  amount: string; // Representa o valor monetário como uma string para evitar problemas de precisão.
  currency: string; // Representa a moeda associada ao valor monetário.
}

export class Money {
    private static readonly MAX_AMOUNT = new Decimal('999999999999999999.99');

    private constructor(
        private readonly amount: Decimal,
        private readonly currency: string,
    ) {}

    static from(props: MoneyProps): Money {
        const { amount, currency } = props;

        // Regex para impedir valores vazios, notação científica e mais de duas casas decimais.
        if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) {
            throw new Error('Invalid monetary amount.');
        }

        const decimalAmount = new Decimal(amount);

        // Mantém o valor dentro da precisão suportada pelo numeric(20,2).
        if (decimalAmount.abs().greaterThan(Money.MAX_AMOUNT)) {
            throw new Error('Monetary amount exceeds the maximum allowed value.');
        }

        // Valida se a moeda é suportada pelo sistema.
        if (!isValidCurrency(currency)) {
            throw new Error('Invalid currency.');
        }

        return new Money(decimalAmount, currency);
    }

    getCurrency(): string {
        return this.currency;
    }

    static zero(currency: string): Money {
        return Money.from({
            amount: '0.00',
            currency,
        });
    }

    add(other: Money): Money {
        this.assertSameCurrency(other);

        return new Money(this.amount.plus(other.amount), this.currency);
    }

    subtract(other: Money): Money {
        this.assertSameCurrency(other);

        return new Money(this.amount.minus(other.amount), this.currency);
    }

    negate(): Money {
        return new Money(this.amount.negated(), this.currency);
    }

    isZero(): boolean {
        return this.amount.isZero();
    }

    isPositive(): boolean {
        return this.amount.greaterThan(0);
    }

    isNegative(): boolean {
        return this.amount.isNegative();
    }

    isLessThan(other: Money): boolean {
        this.assertSameCurrency(other);

        return this.amount.lessThan(other.amount);
    }

    isGreaterThanOrEqual(other: Money): boolean {
        this.assertSameCurrency(other);

        return this.amount.greaterThanOrEqualTo(other.amount);
    }

    equals(other: Money): boolean {
        return this.currency === other.currency && this.amount.equals(other.amount);
    }

    assertSameCurrency(other: Money): void {
        if (this.currency !== other.currency) {
            throw new Error(
                `Currency mismatch: ${this.currency} and ${other.currency}.`,
            );
        }
    }

    toJSON(): MoneyProps {
        return {
            amount: this.amount.toFixed(2),
            currency: this.currency,
        };
    }

    toString(): string {
        return this.amount.toFixed(2);
    }
}
