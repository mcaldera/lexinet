import { describe, expect, it } from 'vitest';
import { REGION_RGB, mixRgb, regionColors, roundShares } from './visuals';

test('regions tied by many links get different colours', () => {
  const regions = [0, 1, 2].map((id) => ({ id, words: [`${id}a`, `${id}b`] }));
  const region = (w: string) => Number(w[0]);
  const edges = [
    { source: '0a', target: '1a', weight: 1 },
    { source: '1b', target: '2a', weight: 1 },
    { source: '0b', target: '2b', weight: 1 },
  ];
  const c = regionColors(regions, edges, region);
  expect(new Set([c.get(0), c.get(1), c.get(2)]).size).toBe(3);
  expect(Math.max(...c.values())).toBeLessThan(REGION_RGB.length);
});

test('many regions still stay within the palette', () => {
  const regions = Array.from({ length: 40 }, (_, id) => ({ id, words: [`${id}`] }));
  const edges = regions.flatMap((a) =>
    regions
      .filter((b) => b.id > a.id)
      .map((b) => ({ source: `${a.id}`, target: `${b.id}`, weight: 1 })),
  );
  const c = regionColors(regions, edges, (w) => Number(w));
  expect(Math.max(...c.values())).toBeLessThan(REGION_RGB.length);
});

test('colours are spread over the palette, not piled on the first few', () => {
  const regions = Array.from({ length: 32 }, (_, id) => ({ id, words: [`${id}`] }));
  const c = regionColors(regions, [], (w) => Number(w));
  expect(new Set(c.values()).size).toBe(REGION_RGB.length);
});

describe('mixRgb', () => {
  it('moves one colour towards another', () => {
    expect(mixRgb('0, 0, 0', '255, 255, 255', 0.5)).toBe('128, 128, 128');
    expect(mixRgb('10, 20, 30', '0, 0, 0', 0)).toBe('10, 20, 30');
  });
});

test('shares round to whole percentages that add up to the total', () => {
  const r = roundShares([3.4, 3.4, 9.4]);
  expect(r.reduce((a, b) => a + b, 0)).toBe(16); // not 3 + 3 + 9 = 15
  expect(r.every((v, i) => Math.abs(v - [3.4, 3.4, 9.4][i]) < 1)).toBe(true);
  expect(roundShares([2.2, 31.1, 11.4])).toEqual([2, 31, 12]);
  expect(roundShares([0.6, 0.6, 0.6])).toEqual([1, 1, 0]);
  expect(roundShares([50])).toEqual([50]);
});
