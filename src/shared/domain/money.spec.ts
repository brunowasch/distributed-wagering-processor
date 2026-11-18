import { describe, expect, it } from 'vitest';
import { Money } from './money.js';
import { isValidCurrency } from './currency.js';

describe('Money', () => {
  it('should create a monetary value', () => {
    const money = Money.from({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(money.toString()).toBe('100.00');
  });

  it('should create a zero monetary value', () => {
    const money = Money.zero('BRL');

    expect(money.toString()).toBe('0.00');
    expect(money.isZero()).toBe(true);
  });

  it('should add monetary values correctly', () => {
    const first = Money.from({ amount: '100.50', currency: 'BRL' });
    const second = Money.from({ amount: '50.25', currency: 'BRL' });

    expect(first.add(second).toString()).toBe('150.75');
  });

  it('should subtract monetary values correctly', () => {
    const balance = Money.from({ amount: '100.00', currency: 'BRL' });
    const amount = Money.from({ amount: '25.50', currency: 'BRL' });

    expect(balance.subtract(amount).toString()).toBe('74.50');
  });

  it('should allow negative results when subtracting', () => {
    const balance = Money.from({ amount: '10.00', currency: 'BRL' });
    const amount = Money.from({ amount: '20.00', currency: 'BRL' });

    const result = balance.subtract(amount);

    expect(result.toString()).toBe('-10.00');
    expect(result.isNegative()).toBe(true);
  });

  it('should negate a monetary value', () => {
    const money = Money.from({ amount: '25.00', currency: 'BRL' });

    expect(money.negate().toString()).toBe('-25.00');
  });

  it('should identify positive monetary values', () => {
    const money = Money.from({ amount: '25.00', currency: 'BRL' });

    expect(money.isPositive()).toBe(true);
  });

  it('should identify zero monetary values', () => {
    const money = Money.zero('BRL');

    expect(money.isZero()).toBe(true);
    expect(money.isPositive()).toBe(false);
    expect(money.isNegative()).toBe(false);
  });

  it('should compare monetary values', () => {
    const first = Money.from({ amount: '100.00', currency: 'BRL' });
    const second = Money.from({ amount: '100.00', currency: 'BRL' });

    expect(first.equals(second)).toBe(true);
  });

  it('should identify different monetary values', () => {
    const first = Money.from({ amount: '100.00', currency: 'BRL' });
    const second = Money.from({ amount: '50.00', currency: 'BRL' });

    expect(first.equals(second)).toBe(false);
  });

  it('should compare monetary values using isLessThan', () => {
    const first = Money.from({ amount: '25.00', currency: 'BRL' });
    const second = Money.from({ amount: '50.00', currency: 'BRL' });

    expect(first.isLessThan(second)).toBe(true);
  });

  it('should compare monetary values using isGreaterThanOrEqual', () => {
    const first = Money.from({ amount: '100.00', currency: 'BRL' });
    const second = Money.from({ amount: '100.00', currency: 'BRL' });

    expect(first.isGreaterThanOrEqual(second)).toBe(true);
  });

  it('should reject values with more than two decimal places', () => {
    expect(() =>
      Money.from({ amount: '10.999', currency: 'BRL' }),
    ).toThrow('Invalid monetary amount.');
  });

  it('should reject values in scientific notation', () => {
    expect(() =>
      Money.from({ amount: '1e3', currency: 'BRL' }),
    ).toThrow('Invalid monetary amount.');
  });

  it('should reject invalid monetary values', () => {
    const invalidValues = ['', 'abc', 'NaN', 'Infinity', '10.'];

    for (const amount of invalidValues) {
      expect(() =>
        Money.from({ amount, currency: 'BRL' }),
      ).toThrow('Invalid monetary amount.');
    }
  });

  it('should reject invalid currency formats', () => {
    expect(() =>
      Money.from({ amount: '10.00', currency: 'brl' }),
    ).toThrow('Invalid currency.');
  });

  it('should reject values exceeding the maximum allowed amount', () => {
    expect(() =>
      Money.from({
        amount: '1000000000000000000.00',
        currency: 'BRL',
      }),
    ).toThrow('Monetary amount exceeds the maximum allowed value.');
  });

  it('should reject operations between different currencies', () => {
    const brl = Money.from({ amount: '100.00', currency: 'BRL' });
    const usd = Money.from({ amount: '50.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow('Currency mismatch');
    expect(() => brl.subtract(usd)).toThrow('Currency mismatch');
    expect(() => brl.isLessThan(usd)).toThrow('Currency mismatch');
  });

  it('should consider currency when comparing monetary values', () => {
    const brl = Money.from({ amount: '100.00', currency: 'BRL' });
    const usd = Money.from({ amount: '100.00', currency: 'USD' });

    expect(brl.equals(usd)).toBe(false);
  });

  it('should serialize monetary values using MoneyProps', () => {
    const money = Money.from({ amount: '25.00', currency: 'BRL' });

    expect(money.toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });
  });

  it('should not modify the original value after an operation', () => {
    const original = Money.from({ amount: '100.00', currency: 'BRL' });
    const result = original.subtract(
      Money.from({ amount: '30.00', currency: 'BRL' }),
    );

    expect(original.toString()).toBe('100.00');
    expect(result.toString()).toBe('70.00');
  });
});

describe('isValidCurrency', () => {
    it.each(['BRL', 'USD', 'EUR'])(
        'should accept the valid currency %s',
        (currency) => {
            expect(isValidCurrency(currency)).toBe(true);
        },
    );

    it.each(['ABC', 'brl', '123', 'US'])(
        'should reject the invalid currency %s',
        (currency) => {
            expect(isValidCurrency(currency)).toBe(false);
        },
    );
});