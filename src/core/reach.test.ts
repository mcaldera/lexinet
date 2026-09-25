import { reachMap, reachSources, revealChanges, sightedWords, type ReachInput } from './reach';
import { neighbourMap, type NodeState } from './unlock';

const RULES = {
  decay: [1, 0.5, 0.1],
  conquered: 1,
  claimedPerStep: 0.25,
  home: 1,
  sight: 0.25,
  open: 1,
  border: 0.5,
  familiarAt: 2,
  familiarBoost: 0.5,
  pos: {} as Record<string, number>,
  verbLevelBonus: 0,
};
const yes = () => true;

// A chain a-b-c-d-e in one region, f hangs off a in another region.
const chain = neighbourMap(
  [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['d', 'e'],
    ['a', 'f'],
  ].map(([source, target]) => ({ source, target })),
);
const regions: Record<string, number> = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 1 };
const input = (states: Record<string, NodeState>, extra: Partial<ReachInput> = {}): ReachInput => ({
  states: new Map(Object.entries(states)),
  claims: new Map(),
  neighbours: chain,
  regionOf: (id) => regions[id],
  seed: 'zzz',
  rules: RULES,
  ...extra,
});
const round = (m: Map<string, number>) =>
  Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

test('push fades over links: 100%, 50%, 10%, and halves across a region border', () => {
  const r = reachMap(
    input(
      { a: 'conquered', b: 'locked', c: 'locked', d: 'locked', e: 'locked', f: 'locked' },
      { rules: { ...RULES, familiarBoost: 0 } },
    ),
  );
  expect(round(r)).toEqual({ a: 1, b: 1, c: 0.5, d: 0.1, f: 0.5 });
});

test('pushes add up, and familiar ground carries them further', () => {
  const states = {
    a: 'conquered',
    b: 'conquered',
    c: 'locked',
    d: 'locked',
    e: 'locked',
    f: 'locked',
  } as const;
  const r = reachMap(input(states));
  // Region 0 is familiar (2 conquered): each link inside carries 1.5x.
  expect(round(r).c).toBeCloseTo(1.5 + 0.5 * 1.5 * 1.5, 3);
  expect(r.get('f')).toBeCloseTo(0.5 + 0.5 * 1.5 * 0.5, 3);
});

test('claimed words push a little per finished step', () => {
  const r = reachMap(
    input(
      { a: 'claimed', b: 'locked', c: 'locked', d: 'locked', e: 'locked', f: 'locked' },
      { claims: new Map([['a', { itEn: 1, enIt: 2 }]]) },
    ),
  );
  expect(r.get('b')).toBeCloseTo(0.5);
});

test('the seed pushes from the start', () => {
  const r = reachMap(input({ a: 'frontier', b: 'locked', f: 'locked' }, { seed: 'a' }));
  expect(r.get('b')).toBe(1);
});

test('enough reach opens a word, a little makes it visible only', () => {
  const states = new Map<string, NodeState>([
    ['a', 'conquered'],
    ['b', 'locked'],
    ['c', 'locked'],
    ['f', 'locked'],
    ['x', 'frontier'],
  ]);
  const reach = new Map([
    ['a', 1],
    ['b', 1],
    ['c', 0.5],
    ['f', 0.1],
  ]);
  expect(revealChanges(states, reach, RULES, yes)).toEqual([{ id: 'b', state: 'frontier' }]);
  expect([...sightedWords(states, reach, RULES, yes).keys()]).toEqual(['b', 'c']);
  expect(revealChanges(states, reach, RULES, (id) => id !== 'b')).toEqual([]);
});

test('with nothing left to work on, the best sighted word opens so the map never stalls', () => {
  const states = new Map<string, NodeState>([
    ['a', 'conquered'],
    ['c', 'locked'],
    ['f', 'locked'],
  ]);
  const reach = new Map([
    ['c', 0.5],
    ['f', 0.3],
  ]);
  expect(revealChanges(states, reach, RULES, yes)).toEqual([{ id: 'c', state: 'frontier' }]);
});

test('verbs push more than nouns, adjectives less, levelled verbs more still', () => {
  const rules = { ...RULES, familiarBoost: 0, pos: { verb: 1.25, adj: 0.8 }, verbLevelBonus: 0.15 };
  const at = (pos: string, level = 0) =>
    reachMap(
      input(
        { a: 'conquered', b: 'locked' },
        { rules, posOf: () => pos, verbLevels: new Map([['a', level]]) },
      ),
    ).get('b');
  expect(at('noun')).toBeCloseTo(1);
  expect(at('verb')).toBeCloseTo(1.25);
  expect(at('verb', 2)).toBeCloseTo(1.55);
  expect(at('adj')).toBeCloseTo(0.8);
});

test("reach sources explain where a word's reach comes from", () => {
  const inp = input(
    { a: 'conquered', b: 'conquered', c: 'locked', d: 'locked', e: 'locked', f: 'locked' },
    { rules: { ...RULES, familiarBoost: 0 } },
  );
  expect(reachSources(inp, 'c').map((s) => [s.id, Math.round(s.push * 100) / 100])).toEqual([
    ['b', 1],
    ['a', 0.5],
  ]);
});
