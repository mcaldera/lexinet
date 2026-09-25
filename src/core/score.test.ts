import { clusterPoints, clusterScores, totalScore, wordLinks } from './score';

const region: Record<string, number> = { a: 0, b: 0, c: 0, x: 1, y: 1 };
const edges = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'a', target: 'x' },
  { source: 'x', target: 'y' },
];
const regionOf = (id: string) => region[id];

test('a category scores its conquered words, weighted by how tightly they hang together', () => {
  const states = new Map([
    ['a', 'conquered'],
    ['b', 'conquered'],
    ['c', 'frontier'],
    ['x', 'conquered'],
    ['y', 'locked'],
  ]);
  const s = clusterScores(states, edges, regionOf);
  // Category 0: a-b inside, a-x outside -> cohesion 1/2 -> 10 * 2 * (1 + 1) = 40.
  expect(s[0]).toEqual({ region: 0, words: 2, inside: 1, outside: 1, cohesion: 0.5, points: 40 });
  // Category 1: x alone, one link out -> 10 * 1 * 1 = 10.
  expect(s[1]).toMatchObject({ region: 1, words: 1, inside: 0, outside: 1, points: 10 });
  expect(totalScore(s)).toBe(50);
});

test('tighter clusters beat loose ones of the same size', () => {
  expect(clusterPoints(5, 0.8)).toBeGreaterThan(clusterPoints(5, 0.2));
});

test('a word links into its category and out of it', () => {
  expect(wordLinks('a', edges, regionOf)).toEqual({ inside: 1, outside: 1 });
  expect(wordLinks('x', edges, regionOf)).toEqual({ inside: 1, outside: 1 });
});
