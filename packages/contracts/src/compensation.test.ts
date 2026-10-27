import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_MINOR,
  compensationFor,
  compensationRequestSchema,
  moneyInput,
  parseMoney,
} from './compensation.js';

describe('parseMoney', () => {
  it.each([
    ['3500', 350000],
    ['3500.5', 350050],
    ['3500.50', 350050],
    ['3 500,50', 350050],
    ['3.500,50', 350050],
    ['3,500.50', 350050],
    ['1,234,567.89', 123456789],
    ['12', 1200],
    ['1.234', 123400],
    ['12.345,6', 1234560],
    ['0.01', 1],
    ['  42,5 ', 4250],
    ['1 000 000 000', MAX_AMOUNT_MINOR],
  ])('reads %s as %d', (text, minor) => {
    expect(parseMoney(text)).toBe(minor);
  });

  it.each([
    '',
    ' ',
    'abc',
    '-5',
    '+5',
    '0',
    '0.00',
    '3500.505',
    '35.00.50',
    '1,23,4',
    '1..2',
    '1e3',
    '1 000 000 000,01',
    '99999999999999999999',
    '3500 EUR',
  ])('refuses %j', (text) => {
    expect(parseMoney(text)).toBeNull();
  });

  it('round-trips through the input form', () => {
    for (const minor of [1, 99, 100, 350050, 123456789, MAX_AMOUNT_MINOR]) {
      expect(parseMoney(moneyInput(minor))).toBe(minor);
    }
    expect(moneyInput(350000)).toBe('3500');
    expect(moneyInput(5)).toBe('0.05');
  });
});

describe('compensationFor', () => {
  const rows = [
    { validFrom: '2025-01-01', n: 1 },
    { validFrom: '2026-03-01', n: 2 },
    { validFrom: '2027-01-01', n: 3 },
  ];
  it('picks the latest row on or before the date', () => {
    expect(compensationFor(rows, '2026-03-01')?.n).toBe(2);
    expect(compensationFor(rows, '2026-02-28')?.n).toBe(1);
    expect(compensationFor(rows, '2030-01-01')?.n).toBe(3);
  });
  it('finds nothing before the first row or in an empty list', () => {
    expect(compensationFor(rows, '2024-12-31')).toBeNull();
    expect(compensationFor([], '2026-01-01')).toBeNull();
  });
  it('does not depend on the order of the rows', () => {
    expect(compensationFor([...rows].reverse(), '2026-06-01')?.n).toBe(2);
  });
});

describe('compensationRequestSchema', () => {
  const ok = { validFrom: '2026-03-01', basis: 'monthly', amountMinor: 350000 };
  it('accepts valid requests and defaults the currency to EUR', () => {
    expect(compensationRequestSchema.parse(ok).currency).toBe('EUR');
    for (const basis of ['monthly', 'yearly', 'hourly']) {
      expect(compensationRequestSchema.safeParse({ ...ok, basis }).success).toBe(true);
    }
    expect(compensationRequestSchema.safeParse({ ...ok, currency: 'BGN' }).success).toBe(true);
  });
  it.each([
    ['unknown basis', { basis: 'weekly' }],
    ['zero', { amountMinor: 0 }],
    ['negative', { amountMinor: -1 }],
    ['fraction of a cent', { amountMinor: 1.5 }],
    ['too large', { amountMinor: MAX_AMOUNT_MINOR + 1 }],
    ['a string amount', { amountMinor: '100' }],
    ['unknown currency', { currency: 'XXX' }],
    ['lower-case currency', { currency: 'eur' }],
    ['bad date', { validFrom: '1.3.2026' }],
    ['extra field', { note: 'bonus' }],
  ])('refuses %s', (_label, patch) => {
    expect(compensationRequestSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});
