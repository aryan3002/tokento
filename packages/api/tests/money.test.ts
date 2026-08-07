import { describe, expect, it } from 'vitest';
import { subtractMoneyFloorZero, toMoneyNumber, moneyGreaterThanOrEqual } from '../src/utils/money';

describe('money arithmetic avoids floating point drift', () => {
  it('computes a $19.99 order less a $0.10 token exactly', () => {
    // Float: 19.99 - 0.10 === 19.889999999999997
    expect(19.99 - 0.10).not.toBe(19.89);
    expect(toMoneyNumber(subtractMoneyFloorZero(19.99, 0.10))).toBe(19.89);
  });

  it('computes 0.30 - 0.10 exactly', () => {
    // Float: 0.3 - 0.1 === 0.19999999999999998
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(toMoneyNumber(subtractMoneyFloorZero(0.3, 0.1))).toBe(0.2);
  });

  it('computes 1.10 - 0.20 exactly', () => {
    expect(1.1 - 0.2).not.toBe(0.9);
    expect(toMoneyNumber(subtractMoneyFloorZero(1.1, 0.2))).toBe(0.9);
  });

  it('clamps a redemption larger than the transaction to zero', () => {
    expect(toMoneyNumber(subtractMoneyFloorZero(5, 20))).toBe(0);
  });

  it('compares against a spend floor without drift', () => {
    expect(moneyGreaterThanOrEqual(10.00, 10.00)).toBe(true);
    expect(moneyGreaterThanOrEqual(9.99, 10.00)).toBe(false);
  });
});
