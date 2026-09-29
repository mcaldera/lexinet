import { clusterScores, totalScore, wordLinks, wordPoints } from './score';

const region: Record<string, number> = { a: 0, b: 0, c: 0, x: 1, y: 1 };
const edges = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'a', target: 'x' },
  { source: 'x', target: 'y' },
];
const regionOf = (id: string) => region[id];
const dots: Record<string, number> = { a: 2, b: 5, x: 0 };
const strengthOf = (id: string) => dots[id] ?? 0;

test('every conquered word scores 10, plus 10 per memory dot, summed per category', () => {
  const states = new Map([
    ['a', 'conquered'],
    ['b', 'conquered'],
    ['c', 'frontier'],
    ['x', 'conquered'],
    ['y', 'locked'],
  ]);
  const s = clusterScores(states, edges, regionOf, strengthOf);
  // Category 0: a (2 dots) 30 + b (5 dots) 60; a-b inside, a-x outside -> cohesion 1/2.
  expect(s[0]).toEqual({ region: 0, words: 2, inside: 1, outside: 1, cohesion: 0.5, points: 90 });
  // Category 1: x (no dots) 10; one link out, none inside.
  expect(s[1]).toMatchObject({ region: 1, words: 1, inside: 0, outside: 1, points: 10 });
  expect(totalScore(s)).toBe(100);
});

test('cohesion no longer weighs the score: better known words do', () => {
  expect(wordPoints(5)).toBeGreaterThan(wordPoints(2));
  expect(wordPoints(0)).toBe(10);
});

test('a word links into its category and out of it', () => {
  expect(wordLinks('a', edges, regionOf)).toEqual({ inside: 1, outside: 1 });
  expect(wordLinks('x', edges, regionOf)).toEqual({ inside: 1, outside: 1 });
});
