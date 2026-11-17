import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  it('should create a monetary value', () => {
    const money = Money.from('100.00');

    expect(money.toString()).toBe('100.00');
  });

  it('should add monetary values correctly', () => {
    const first = Money.from('100.50');
    const second = Money.from('50.25');

    expect(first.add(second).toString()).toBe('150.75');
  });

  it('should subtract monetary values correctly', () => {
    const balance = Money.from('100.00');
    const amount = Money.from('25.50');

    expect(balance.subtract(amount).toString()).toBe('74.50');
  });

  it('should not allow negative results', () => {
    const balance = Money.from('10.00');
    const amount = Money.from('20.00');

    expect(() => balance.subtract(amount)).toThrow('Insufficient funds.');
  });

  it('should reject values with more than two decimal places', () => {
    expect(() => Money.from('10.999')).toThrow('Invalid monetary value.');
  });

  it('should compare monetary values', () => {
    const first = Money.from('100.00');
    const second = Money.from('100.00');

    expect(first.equals(second)).toBe(true);
  });
});
