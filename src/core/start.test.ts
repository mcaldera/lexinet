import { pickStart, startCandidates } from './start';

const nodes = [
  { id: 'a', tier: 1, region: 0 },
  { id: 'b', tier: 1, region: 0 },
  { id: 'c', tier: 2, region: 0 },
  { id: 'x', tier: 2, region: 1 },
  { id: 'y', tier: 3, region: 1 },
  { id: 'free', tier: 1, region: null },
];
const edges = [
  { source: 'a', target: 'b' },
  { source: 'a', target: 'c' },
  { source: 'b', target: 'free' },
  { source: 'x', target: 'y' },
  { source: 'x', target: 'c' },
];

test('a category starts from its easiest words, best linked within the category', () => {
  // a is linked to b and c in its category; b only to a (free has no category).
  expect(startCandidates(nodes, edges, 0)).toEqual(['a']);
  // Category 1's easiest tier is 2: its first words come from there.
  expect(startCandidates(nodes, edges, 1)).toEqual(['x']);
});

test('words that open two neighbours beat words that open one', () => {
  const more = [...edges, { source: 'b', target: 'd' }];
  const ns = [...nodes, { id: 'd', tier: 1, region: 0 }];
  // a: b, c. b: a, d. d: b.
  expect(startCandidates(ns, more, 0)).toEqual(['a', 'b']);
});

test('anywhere means any categorised word of the easiest tier', () => {
  expect(startCandidates(nodes, edges)).toEqual(['a']);
});

test('a poorly linked category still gets a start', () => {
  expect(startCandidates([{ id: 'lone', tier: 1, region: 4 }], [], 4)).toEqual(['lone']);
  expect(startCandidates(nodes, edges, 9)).toEqual([]);
});

test('the pick is random among the candidates', () => {
  const ns = [...nodes, { id: 'd', tier: 1, region: 0 }];
  const more = [...edges, { source: 'b', target: 'd' }];
  expect(pickStart(ns, more, 0, () => 0)).toBe('a');
  expect(pickStart(ns, more, 0, () => 0.99)).toBe('b');
  expect(pickStart(nodes, edges, 9)).toBeUndefined();
});
