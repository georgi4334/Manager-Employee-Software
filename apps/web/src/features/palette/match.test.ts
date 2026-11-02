import { describe, expect, it } from 'vitest';
import { matchScore, normalize, rank } from './match';

describe('normalize', () => {
  it('ignores case and accents', () => {
    expect(normalize('  Ünal Çelik ')).toBe('unal celik');
    expect(normalize('Йордан')).toBe('иордан');
  });
});

describe('matchScore', () => {
  it('matches everything on an empty query', () => {
    expect(matchScore('', 'Leave')).toBe(1);
    expect(matchScore('   ', 'Leave')).toBe(1);
  });

  it('scores a word start above a match inside a word', () => {
    expect(matchScore('app', 'Leave › Approvals')).toBe(2);
    expect(matchScore('prov', 'Leave › Approvals')).toBe(1);
  });

  it('adds one when the text starts with the query', () => {
    expect(matchScore('lea', 'Leave')).toBe(3);
    expect(matchScore('lea', 'Request leave')).toBe(2);
  });

  it('needs every typed word', () => {
    expect(matchScore('leave app', 'Leave › Approvals')).toBe(4);
    expect(matchScore('leave xyz', 'Leave › Approvals')).toBe(0);
  });

  it('does not match what is not there', () => {
    expect(matchScore('zzz', 'Dashboard')).toBe(0);
  });

  it('matches accented text typed without accents', () => {
    expect(matchScore('urlaub', 'Urlaub beantragen')).toBeGreaterThan(0);
    expect(matchScore('ubersicht', 'Übersicht')).toBeGreaterThan(0);
  });
});

describe('rank', () => {
  const items = ['Request leave', 'Leave', 'Calendar', 'Leave › Approvals'];
  it('keeps matches only, best first, ties in order', () => {
    expect(rank('leave', items, (x) => x)).toEqual(['Leave', 'Leave › Approvals', 'Request leave']);
  });

  it('keeps the order on an empty query', () => {
    expect(rank('', items, (x) => x)).toEqual(items);
  });

  it('returns nothing when nothing matches', () => {
    expect(rank('qq', items, (x) => x)).toEqual([]);
  });
});
