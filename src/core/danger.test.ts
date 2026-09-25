import { dangerFalls, dangers, missed, rescue } from './danger';
import type { Game } from './influence';
import { neighbourMap, type NodeState } from './unlock';

const nb = neighbourMap([
  { source: 'x', target: 'a' },
  { source: 'x', target: 'b' },
  { source: 'x', target: 'c' },
]);
const states = new Map<string, NodeState>([
  ['x', 'claimed'],
  ['a', 'claimed'],
  ['b', 'conquered'],
  ['c', 'frontier'],
]);
const game: Game = { simAt: 0, nodes: new Map([['a', { control: 1, claim: { itEn: 1 } }]]) };
const WIN = 180_000;
const HOSTILE = 86_400_000;

test('a miss drops the word to hostile "?" and endangers only its claimed neighbours', () => {
  const m = missed(game, 'x', states, nb, 1000, WIN, HOSTILE);
  expect(m.changes).toEqual([{ id: 'x', state: 'frontier' }]);
  expect(m.game.nodes.get('x')).toEqual({ control: 0, since: 1000, hostileUntil: 1000 + HOSTILE });
  expect(m.endangered).toEqual(['a']);
  expect(m.game.nodes.get('a')?.claim).toEqual({ itEn: 1 }); // progress kept while in danger
  expect(dangers(m.game, states)).toEqual(new Map([['a', { until: 1000 + WIN, from: 'x' }]]));
});

test('in time: winning the missed word back saves them', () => {
  const m = missed(game, 'x', states, nb, 1000, WIN, HOSTILE);
  const saved = rescue(m.game, 'x');
  expect(dangerFalls(saved, states, 1000 + WIN, HOSTILE).changes).toEqual([]);
  expect(dangers(saved, states).size).toBe(0);
});

test('too late: endangered words fall, but not before the deadline', () => {
  const m = missed(game, 'x', states, nb, 1000, WIN, HOSTILE);
  expect(dangerFalls(m.game, states, 1000 + WIN - 1, HOSTILE).changes).toEqual([]);
  const late = dangerFalls(m.game, states, 1000 + WIN, HOSTILE);
  expect(late.changes).toEqual([{ id: 'a', state: 'frontier' }]);
  expect(late.game.nodes.get('a')?.hostileUntil).toBe(1000 + WIN + HOSTILE);
});

test('danger on a word that got conquered meanwhile is dropped', () => {
  const m = missed(game, 'x', states, nb, 1000, WIN, HOSTILE);
  const done = new Map(states).set('a', 'conquered');
  const r = dangerFalls(m.game, done, 1000 + WIN, HOSTILE);
  expect(r.changes).toEqual([]);
  expect(r.game.nodes.get('a')?.danger).toBeUndefined();
});
