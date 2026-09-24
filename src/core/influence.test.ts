import { INFLUENCE } from '../config';
import { afterAnswer, isHostile, neighbourWeights, simulate, type Game } from './influence';
import type { NodeState } from './unlock';

const H = 3_600_000;
const t0 = Date.UTC(2026, 0, 1);
const nb = neighbourWeights([
  { source: 'a', target: 'b', weight: 1 },
  { source: 'b', target: 'c', weight: 1 },
]);
const st = (o: Record<string, NodeState>) => new Map(Object.entries(o));
const empty: Game = { simAt: t0, nodes: new Map() };

test('fresh frontier words are neutral, then turn hostile', () => {
  const r = simulate(
    empty,
    st({ a: 'conquered', b: 'frontier' }),
    nb,
    new Map(),
    t0 + 10 * H,
    INFLUENCE,
  );
  expect(r.game.nodes.get('a')!.control).toBe(1); // grace period: no pressure yet
  const g = r.game.nodes.get('b')!;
  expect(isHostile(g, 'frontier', t0 + 10 * H, INFLUENCE)).toBe(false);
  expect(
    isHostile(g, 'frontier', t0 + 10 * H + (INFLUENCE.hostileAfterHours + 1) * H, INFLUENCE),
  ).toBe(true);
});

test('hostile neighbours drain control until the word is lost', () => {
  const game: Game = { simAt: t0, nodes: new Map([['b', { control: 0, since: t0 - 24 * H }]]) };
  const day = simulate(
    game,
    st({ a: 'conquered', b: 'frontier' }),
    nb,
    new Map(),
    t0 + 24 * H,
    INFLUENCE,
  );
  expect(day.game.nodes.get('a')!.control).toBeCloseTo(1 - INFLUENCE.hostilePressure, 1);
  const later = simulate(
    game,
    st({ a: 'conquered', b: 'frontier' }),
    nb,
    new Map(),
    t0 + 5 * 24 * H,
    INFLUENCE,
  );
  expect(later.lost).toEqual([{ id: 'a', state: 'frontier' }]);
});

test('conquered neighbours support each other; verbs support more', () => {
  const game: Game = {
    simAt: t0,
    nodes: new Map([
      ['a', { control: 0.5 }],
      ['b', { control: 1 }],
    ]),
  };
  const plain = simulate(
    game,
    st({ a: 'conquered', b: 'conquered' }),
    nb,
    new Map(),
    t0 + 24 * H,
    INFLUENCE,
  );
  const verb = simulate(
    game,
    st({ a: 'conquered', b: 'conquered' }),
    nb,
    new Map([['b', 2]]),
    t0 + 24 * H,
    INFLUENCE,
  );
  expect(plain.game.nodes.get('a')!.control).toBeGreaterThan(0.6);
  expect(verb.game.nodes.get('a')!.control).toBeGreaterThan(plain.game.nodes.get('a')!.control);
});

test('a lost word rebels: collapse spreads along the cluster', () => {
  const game: Game = {
    simAt: t0,
    nodes: new Map([
      ['a', { control: 0.05 }],
      ['b', { control: 0.4 }],
      ['c', { control: 0.4 }],
    ]),
  };
  const r = simulate(
    game,
    st({ a: 'conquered', b: 'conquered', c: 'conquered' }),
    nb,
    new Map(),
    t0 + 10 * 24 * H,
    INFLUENCE,
  );
  expect(r.lost.map((l) => l.id)).toContain('a');
  expect(r.lost.length).toBeGreaterThan(1);
});

test('answers: success restores, misses make hostile or cost control', () => {
  const game: Game = { simAt: t0, nodes: new Map([['a', { control: 0.6 }]]) };
  expect(afterAnswer(game, 'a', 'conquered', true, [], t0, INFLUENCE).nodes.get('a')!.control).toBe(
    1,
  );
  expect(
    afterAnswer(game, 'a', 'conquered', false, [], t0, INFLUENCE).nodes.get('a')!.control,
  ).toBeCloseTo(0.25);
  const f = afterAnswer(game, 'b', 'frontier', false, [], t0, INFLUENCE).nodes.get('b');
  expect(isHostile(f, 'frontier', t0 + 1, INFLUENCE)).toBe(true);
  const rev = afterAnswer(
    game,
    'a',
    'frontier',
    true,
    [{ id: 'c', state: 'frontier' }],
    t0,
    INFLUENCE,
  );
  expect(rev.nodes.get('c')!.since).toBe(t0);
});
