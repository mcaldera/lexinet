import { describe, expect, it } from 'vitest';
import { rootCharge, rootNeed, rootOpenings } from './roots';

const hub = (id: string, words: string[]) => ({ id, words });

describe('roots', () => {
  const big = hub('root:caput', ['a', 'b', 'c', 'd', 'far']);
  const pair = hub('root:soror', ['e', 'f']);

  it('charges from its words, each counting its reach up to 1', () => {
    const reach = new Map([
      ['a', 4.5], // deep in your territory: still just one word
      ['b', 1],
      ['c', 0.5], // a ghost counts partly
    ]);
    expect(rootCharge([big], reach, new Set()).get('root:caput')).toBeCloseTo(2.5);
  });

  it('opens once enough of its words are in reach (all of a small family)', () => {
    const reach = new Map([
      ['a', 1],
      ['b', 1],
      ['e', 1],
    ]);
    expect(rootOpenings([big, pair], reach, new Set(), 3)).toEqual([]);
    reach.set('c', 1);
    reach.set('f', 2);
    expect(rootOpenings([big, pair], reach, new Set(), 3).map((h) => h.id)).toEqual([
      'root:caput',
      'root:soror',
    ]);
    expect(rootNeed(pair, 3)).toBe(2);
  });

  it('never reopens an open root', () => {
    const reach = new Map(big.words.map((w) => [w, 1]));
    expect(rootOpenings([big], reach, new Set([big.id]), 3)).toEqual([]);
    expect(rootCharge([big], reach, new Set([big.id])).has(big.id)).toBe(false);
  });
});
