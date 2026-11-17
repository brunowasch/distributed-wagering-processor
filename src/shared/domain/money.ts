import { Decimal } from 'decimal.js';

export class Money {
    // Mantém o valor imutável para evitar alterações após a criação.
    private readonly amount: Decimal;

    // Construtor privado para forçar a criação via factory method.
    private constructor(value: string) {
        // Regex para aceitar somente valores decimais não negativos comk até duas casas.
        if (!/^\d+(\.\d{1,2})?$/.test(value)) {
            throw new Error('Invalid monetary value.');
        }
        
        // Converte para Decimal para garantir precisão matemática e evitar erros de arredondamento.
        this.amount = new Decimal(value);

        // NUMERIC(20,2) permite até 18 dígitos antes da parte decimal.
        if (this.amount.greaterThan('999999999999999999.99')) {
            throw new Error('Monetary value exceeds the maximum allowed.');
        }
    }

    // Factory Method: centraliza a criação de valores monetários.
    static from(value: string): Money {
        return new Money(value)
    }

    // Retorna uma nova instância, preservando a imutabilidade.
    add(other: Money): Money {
        return Money.from(this.amount.plus(other.amount).toFixed(2));
    }

    // Subtrai o valor atual com o valor passado como parâmetro.
    subtract(other: Money): Money {
        const result = this.amount.minus(other.amount);

        // Impede que uma operação produza saldo negativo.
        if (result.isNegative()) {
            throw new Error('Insufficient funds.');
        }

        return Money.from(result.toFixed(2));
    }

    // Compara se o valor atual é maior ou igual ao valor passado como parâmetro.
    isGreaterThanOrEqual(other: Money): boolean {
        return this.amount.greaterThanOrEqualTo(other.amount);
    }

    // Confere se os valores são iguais.
    equals(other: Money): boolean {
        return this.amount.equals(other.amount);
    }

    // Normaliza o valor para String.
    toString(): string {
        return this.amount.toFixed(2);
    }
}