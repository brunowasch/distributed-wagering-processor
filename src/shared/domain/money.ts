import { Decimal } from 'decimal.js';
import { isValidCurrency } from './currency.js';

/**
 * Propriedades necessárias para instanciar ou representar um objeto de valor monetário (Money).
 *
 * amount: valor numérico da quantia monetária, representado em texto para evitar problemas de precisão com ponto flutuante (ex: "100.50").
 * currency: código da moeda associada ao valor (ex: BRL, USD).
 *
 * O uso de string no campo amount garante a exatidão dos cálculos financeiros
 * e previne erros comuns de arredondamento da aritmética binária.
 */
export interface MoneyProps {
  amount: string;
  currency: string;
}

/**
 * Objeto de Valor (Value Object) que representa uma quantia monetária imutável associada a uma moeda.
 *
 * Garante precisão matemática nos cálculos financeiros, validação de formato
 * e integridade nas operações entre moedas.
 */
export class Money {
    /**
     * Limite máximo absoluto permitido para um valor monetário.
     *
     * Definido para manter compatibilidade estrita com colunas numeric(20,2) no banco de dados.
     */
    private static readonly MAX_AMOUNT = new Decimal('999999999999999999.99');

    /**
     * Construtor privado responsável por inicializar uma instância válida de Money.
     *
     * amount: valor monetário representado com precisão arbitrária (Decimal).
     * currency: código da moeda associada ao valor (ex: BRL, USD).
     *
     * Por ser privado, impede a instanciação direta externa e obriga o uso
     * de métodos de fábrica (factory methods) que garantem a validação dos dados.
     */
    private constructor(
        private readonly amount: Decimal,
        private readonly currency: string,
    ) {}

    /**
     * Método de fábrica responsável por criar e validar uma instância de Money a partir de propriedades primitivas.
     *
     * props: objeto contendo o valor em texto (amount) e o código da moeda (currency).
     *
     * Rejeita formatos inválidos, mais de duas casas decimais, valores fora do limite
     * máximo permitido ou moedas não suportadas pelo sistema.
     */
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

    /**
     * Retorna o código da moeda associada a este valor monetário.
     */
    getCurrency(): string {
        return this.currency;
    }

    /**
     * Cria uma instância de Money com valor zerado ("0.00") para a moeda informada.
     *
     * currency: código da moeda a ser utilizada (ex: BRL, USD).
     */
    static zero(currency: string): Money {
        return Money.from({
            amount: '0.00',
            currency,
        });
    }

    /**
     * Retorna uma nova instância contendo a soma deste valor com outro objeto Money.
     *
     * other: objeto Money a ser somado.
     *
     * Exige que ambos os objetos possuam exatamente a mesma moeda.
     */
    add(other: Money): Money {
        this.assertSameCurrency(other);

        return new Money(this.amount.plus(other.amount), this.currency);
    }

    /**
     * Retorna uma nova instância contendo a subtração de outro objeto Money a partir deste valor.
     *
     * other: objeto Money a ser subtraído.
     *
     * Exige que ambos os objetos possuam exatamente a mesma moeda.
     */
    subtract(other: Money): Money {
        this.assertSameCurrency(other);

        return new Money(this.amount.minus(other.amount), this.currency);
    }

    /**
     * Retorna uma nova instância com o sinal matemático invertido (positivo para negativo e vice-versa).
     */
    negate(): Money {
        return new Money(this.amount.negated(), this.currency);
    }

    /**
     * Verifica se o valor monetário atual é estritamente igual a zero.
     */
    isZero(): boolean {
        return this.amount.isZero();
    }

    /**
     * Verifica se o valor monetário atual é estritamente maior que zero.
     */
    isPositive(): boolean {
        return this.amount.greaterThan(0);
    }

    /**
     * Verifica se o valor monetário atual é estritamente menor que zero.
     */
    isNegative(): boolean {
        return this.amount.isNegative();
    }

    /**
     * Verifica se este valor monetário é estritamente menor que outro.
     *
     * other: objeto Money a ser comparado.
     *
     * Exige que ambos os objetos possuam a mesma moeda.
     */
    isLessThan(other: Money): boolean {
        this.assertSameCurrency(other);

        return this.amount.lessThan(other.amount);
    }

    /**
     * Verifica se este valor monetário é maior ou igual a outro.
     *
     * other: objeto Money a ser comparado.
     *
     * Exige que ambos os objetos possuam a mesma moeda.
     */
    isGreaterThanOrEqual(other: Money): boolean {
        this.assertSameCurrency(other);

        return this.amount.greaterThanOrEqualTo(other.amount);
    }

    /**
     * Verifica se este objeto possui exatamente a mesma moeda e o mesmo valor numérico que outro.
     *
     * other: objeto Money a ser comparado.
     */
    equals(other: Money): boolean {
        return this.currency === other.currency && this.amount.equals(other.amount);
    }

    /**
     * Valida se o objeto comparado utiliza a mesma moeda desta instância.
     *
     * other: objeto Money cuja moeda será verificada.
     *
     * Lança um erro caso as moedas sejam divergentes, impedindo operações inválidas.
     */
    assertSameCurrency(other: Money): void {
        if (this.currency !== other.currency) {
            throw new Error(
                `Currency mismatch: ${this.currency} and ${other.currency}.`,
            );
        }
    }

    /**
     * Serializa o objeto para um formato primitivo compatível com JSON.
     *
     * Formata o valor monetário com exatamente duas casas decimais.
     */
    toJSON(): MoneyProps {
        return {
            amount: this.amount.toFixed(2),
            currency: this.currency,
        };
    }

    /**
     * Retorna a representação em texto do valor numérico formatado com duas casas decimais (ex: "100.50").
     */
    toString(): string {
        return this.amount.toFixed(2);
    }
}
