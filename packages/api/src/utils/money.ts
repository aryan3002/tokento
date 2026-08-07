// ============================================================
// Tokento — Money
// ============================================================
// Monetary values are stored as Decimal(12,2), never as Float. IEEE-754 doubles
// cannot represent most decimal cents exactly, so arithmetic on them accumulates
// error on every operation — `20.10 - 5.05` yields 15.049999999999999.
//
// The public API contract stays JSON numbers: convert with toMoneyNumber() at the
// boundary so responses, OpenAPI, the widget and the MCP adapter are unaffected.

import { Prisma } from '@prisma/client';

export type Money = Prisma.Decimal;

export function toMoney(value: number | string | Prisma.Decimal): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** Convert a stored Decimal to a JSON number for an API response. */
export function toMoneyNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}

export function subtractMoney(
  a: number | string | Prisma.Decimal,
  b: number | string | Prisma.Decimal,
): Prisma.Decimal {
  return toMoney(a).minus(toMoney(b));
}

/** Subtraction clamped at zero — a redemption never yields a negative charge. */
export function subtractMoneyFloorZero(
  a: number | string | Prisma.Decimal,
  b: number | string | Prisma.Decimal,
): Prisma.Decimal {
  const result = subtractMoney(a, b);
  return result.isNegative() ? new Prisma.Decimal(0) : result;
}

/**
 * Sum monetary values exactly. Summing a wallet in Float compounds error across
 * every token, and this total is what an agent reasons over when choosing what to
 * apply — so it is the worst place to be approximately right.
 */
export function sumMoney(values: Array<number | string | Prisma.Decimal>): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (total, value) => total.plus(toMoney(value)),
    new Prisma.Decimal(0),
  );
}

export function moneyGreaterThanOrEqual(
  a: number | string | Prisma.Decimal,
  b: number | string | Prisma.Decimal,
): boolean {
  return toMoney(a).greaterThanOrEqualTo(toMoney(b));
}

export function moneyLessThan(
  a: number | string | Prisma.Decimal,
  b: number | string | Prisma.Decimal,
): boolean {
  return toMoney(a).lessThan(toMoney(b));
}
