import {
  advanceSiege,
  coverage,
  ghostWords,
  hanging,
  horizonChanges,
  isSupplied,
  supplyFlow,
  type Weighted,
} from './supply';
import type { NodeState } from './unlock';

const RULES = { min: 0.1, maxLink: 0.9, minHoldMs: 1000, fog: 0.6, reveal: 0.08, sight: 0.04 };

/** Undirected weighted links "a-b:0.5". */
function net(...links: string[]): Weighted {
  const m: Weighted = new Map();
  const add = (a: string, b: string, weight: number) =>
    m.set(a, [...(m.get(a) ?? []), { id: b, weight }]);
  for (const l of links) {
    const [pair, w] = l.split(':');
    const [a, b] = pair.split('-');
    add(a, b, Number(w));
    add(b, a, Number(w));
  }
  return m;
}

test('supply fades by link strength and takes the best path', () => {
  const n = net('s-a:0.5', 'a-b:0.5', 's-c:0.8', 'c-b:0.8');
  const flow = supplyFlow({ sources: ['s'], carries: () => true, neighbours: n, rules: RULES });
  expect(flow.value.get('s')).toBe(1);
  expect(flow.value.get('a')).toBeCloseTo(0.5);
  // Via c (0.8 × 0.8) beats via a (0.5 × 0.5).
  expect(flow.value.get('b')).toBeCloseTo(0.64);
  expect(flow.from.get('b')).toBe('c');
});

test('even the strongest link passes on at most maxLink', () => {
  const n = net('s-a:1', 'a-b:1');
  const flow = supplyFlow({ sources: ['s'], carries: () => true, neighbours: n, rules: RULES });
  expect(flow.value.get('b')).toBeCloseTo(0.81);
});

test('only held, unbroken words pass supply on', () => {
  const n = net('s-a:0.9', 'a-b:0.9');
  const flow = supplyFlow({
    sources: ['s'],
    carries: (id) => id !== 'a',
    neighbours: n,
    rules: RULES,
  });
  expect(flow.value.get('a')).toBeCloseTo(0.9); // a receives...
  expect(flow.value.has('b')).toBe(false); // ...but passes nothing on
});

test('words hanging on a chokepoint, none on a word with a detour', () => {
  //  s - a - b - c      (and a detour s - d - b)
  const n = net('s-a:0.9', 'a-b:0.9', 'b-c:0.9', 's-d:0.5', 'd-b:0.5');
  const input = { sources: ['s'], carries: () => true, neighbours: n, rules: RULES };
  expect(hanging(input, 0.3, 'b').sort()).toEqual(['c']);
  // b still gets 0.25 via d when a breaks: above 0.2, so nothing hangs on a.
  expect(hanging(input, 0.2, 'a')).toEqual([]);
  // With a higher bar the detour isn't enough.
  expect(hanging(input, 0.3, 'a').sort()).toEqual(['b', 'c']);
});

test('coverage counts what a node would reach', () => {
  const n = net('s-a:0.5', 'a-b:0.5', 'b-c:0.5');
  expect(coverage(n, 's', { min: 0.2, maxLink: 0.9 })).toBe(2); // a (0.5), b (0.25)
  expect(isSupplied({ value: new Map([['x', 0.1]]), from: new Map() }, 'x', 0.1)).toBe(true);
});

test('a cut-off word holds out as long as it lasts, then falls', () => {
  const n = net('s-a:0.9', 'a-b:0.9');
  const breakAt = (id: string) => (id === 'a' ? 100 : Infinity);
  const world = {
    held: ['s', 'a', 'b'],
    nodes: ['s'],
    neighbours: n,
    breakAt,
    holdMs: (id: string) => (id === 'b' ? 500 : 50),
    rules: RULES,
  };
  // Before a breaks, everything is supplied.
  expect(advanceSiege(world, new Map(), 0, 99).cutSince.size).toBe(0);
  // a breaks at 100: a and b are cut off from then on.
  const mid = advanceSiege(world, new Map(), 0, 120);
  expect(mid.cutSince.get('b')).toBe(100);
  expect(mid.fallen.map((f) => f.id)).toEqual([]);
  // a (broken) falls at 150, b holds out until 600.
  const end = advanceSiege(world, mid.cutSince, 120, 1000);
  expect(end.fallen).toEqual([
    { id: 'a', at: 150 },
    { id: 'b', at: 600 },
  ]);
});

test('reconnecting in time stops the clock', () => {
  const n = net('s-a:0.9', 'a-b:0.9');
  const world = {
    held: ['s', 'a', 'b'],
    nodes: ['s'],
    neighbours: n,
    breakAt: () => Infinity, // a was repaired
    holdMs: () => 500,
    rules: RULES,
  };
  const { cutSince, fallen } = advanceSiege(world, new Map([['b', 100]]), 200, 1000);
  expect(cutSince.size).toBe(0);
  expect(fallen).toEqual([]);
});

test('a broken supply node stops supplying', () => {
  const n = net('s-a:0.9');
  const world = {
    held: ['s', 'a'],
    nodes: ['s'],
    neighbours: n,
    breakAt: (id: string) => (id === 's' ? 0 : Infinity),
    holdMs: () => 500,
    rules: RULES,
  };
  expect(advanceSiege(world, new Map(), 10, 20).cutSince.get('a')).toBe(10);
});

test('the horizon opens words next to anchors and closes lone "?"', () => {
  const neighbours = new Map([
    ['s', ['a']],
    ['a', ['s', 'b']],
    ['b', ['a']],
    ['x', ['y']],
    ['y', ['x']],
  ]);
  const states = new Map<string, NodeState>([
    ['s', 'conquered'],
    ['a', 'locked'],
    ['b', 'locked'],
    ['x', 'frontier'],
    ['y', 'locked'],
  ]);
  const changes = horizonChanges(
    states,
    neighbours,
    new Set(['s']),
    () => true,
    () => false,
  );
  expect(changes).toContainEqual({ id: 'a', state: 'frontier' });
  expect(changes).toContainEqual({ id: 'x', state: 'locked' });
  expect(changes.some((c) => c.id === 'b')).toBe(false);
  // Kept "?" stay.
  const kept = horizonChanges(
    states,
    neighbours,
    new Set(['s']),
    () => true,
    (id) => id === 'x',
  );
  expect(kept.some((c) => c.id === 'x')).toBe(false);
});

test('with nothing to do, the nearest allowed word opens', () => {
  const neighbours = new Map([
    ['s', ['a']],
    ['a', ['s', 'b']],
    ['b', ['a']],
  ]);
  const states = new Map<string, NodeState>([
    ['s', 'conquered'],
    ['a', 'locked'],
    ['b', 'locked'],
  ]);
  // a isn't allowed (a later level): b, two links out, opens instead.
  const changes = horizonChanges(
    states,
    neighbours,
    new Set(['s']),
    (id) => id !== 'a',
    () => false,
  );
  expect(changes).toEqual([{ id: 'b', state: 'frontier' }]);
});

test('ghosts: hidden words a little supply seeps to', () => {
  const states = new Map<string, NodeState>([
    ['s', 'conquered'],
    ['a', 'frontier'],
    ['b', 'locked'],
    ['c', 'locked'],
    ['x', 'locked'],
  ]);
  const reach = new Map([
    ['s', 1],
    ['a', 0.5],
    ['b', 0.05],
    ['c', 0.01],
    ['x', 0.2],
  ]);
  // c gets almost nothing: unseen. x is from a later level: not shown yet.
  expect([...ghostWords(states, reach, 0.04, (id) => id !== 'x')]).toEqual(['b']);
});

test('towards the horizon, supply seeps on past your words with its fog share', () => {
  const n = net('s-a:0.9', 'a-b:0.9', 'b-c:0.9');
  const flow = supplyFlow({
    sources: ['s'],
    carries: (id) => id === 's',
    neighbours: n,
    rules: RULES,
    fog: 0.5,
  });
  expect(flow.value.get('a')).toBeCloseTo(0.9);
  expect(flow.value.get('b')).toBeCloseTo(0.9 * 0.5 * 0.9);
  expect(flow.value.get('c')).toBeCloseTo(0.9 * 0.5 * 0.9 * 0.5 * 0.9);
});

test('strong supply reveals words beyond the first ring', () => {
  const neighbours = new Map([
    ['s', ['a']],
    ['a', ['s', 'b']],
    ['b', ['a', 'c']],
    ['c', ['b']],
  ]);
  const states = new Map<string, NodeState>([
    ['s', 'conquered'],
    ['a', 'frontier'],
    ['b', 'locked'],
    ['c', 'frontier'],
  ]);
  const reach = new Map([
    ['a', 0.9],
    ['b', 0.4],
    ['c', 0.05],
  ]);
  const changes = horizonChanges(
    states,
    neighbours,
    new Set(['s']),
    () => true,
    () => false,
    reach,
    0.3,
  );
  expect(changes).toContainEqual({ id: 'b', state: 'frontier' }); // two links out, strong enough
  expect(changes).toContainEqual({ id: 'c', state: 'locked' }); // too little reaches it
});
