import { defend, raidStarts, raidStatus, raidTargets } from './raid';
import type { NodeState } from './unlock';

const states = new Map<string, NodeState>([
  ['a', 'conquered'],
  ['b', 'conquered'],
  ['c', 'conquered'],
  ['h', 'frontier'],
]);
const neighbours = new Map([
  ['a', ['h']],
  ['b', ['h', 'c']],
  ['c', ['b']],
  ['h', ['a', 'b']],
]);
const rules = { durationMs: 180_000, targets: 3, gapMs: 1_200_000, chance: 0.2 };

test('a raid hits the weakest words on a hostile border', () => {
  const health = new Map([
    ['a', 0.9],
    ['b', 0.6],
  ]);
  expect(raidTargets(states, neighbours, new Set(['h']), health, 3)).toEqual(['b', 'a']);
  expect(raidTargets(states, neighbours, new Set(), health, 3)).toEqual([]);
});

test('raids need a border, a pause since the last one and some luck', () => {
  expect(raidStarts(undefined, false, ['a'], 0, rules, () => 0.1)).toBe(true);
  expect(raidStarts(undefined, false, ['a'], 0, rules, () => 0.5)).toBe(false);
  expect(raidStarts(undefined, true, ['a'], 0, rules, () => 0)).toBe(false);
  expect(raidStarts(undefined, false, [], 0, rules, () => 0)).toBe(false);
  expect(raidStarts(1000, false, ['a'], 1000 + rules.gapMs - 1, rules, () => 0)).toBe(false);
});

test('defend every target in time to win; the rest are hit when time runs out', () => {
  const raid = { targets: ['a', 'b'], defended: [], start: 0, until: 100 };
  expect(raidStatus(raid, 50).state).toBe('on');
  const one = defend(defend(raid, 'a'), 'x');
  expect(one.defended).toEqual(['a']);
  expect(raidStatus(one, 100)).toEqual({ state: 'lost', hit: ['b'] });
  expect(raidStatus(defend(one, 'b'), 100)).toEqual({ state: 'won', hit: [] });
});
