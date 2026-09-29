import { reclaim, reclaimable, recordFalls } from './fallen';
import type { Game } from './game';
import type { NodeState } from './unlock';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);
const before = new Map<string, NodeState>([
  ['c', 'conquered'],
  ['k', 'claimed'],
  ['z', 'claimed'],
  ['f', 'frontier'],
]);
const claims = new Map([
  ['k', { itEn: 1, enIt: 2 }],
  ['z', {}],
]);
const game: Game = { simAt: 0, nodes: new Map([['c', { missedAt: t0, cutSince: t0 }]]) };
const falls = ['c', 'k', 'z', 'f'].map((id) => ({ id, state: 'frontier' as const }));

test('falls remember what the word was (a claim with no step done is not worth it)', () => {
  const g = recordFalls(game, before, claims, falls, t0);
  // A lost word is no longer broken or besieged, just remembered.
  expect(g.nodes.get('c')).toEqual({ fallen: { was: 'conquered', steps: 0, at: t0 } });
  expect(g.nodes.get('k')?.fallen).toEqual({ was: 'claimed', steps: 2, at: t0 });
  expect(g.nodes.get('z')?.fallen).toBeUndefined();
  expect(g.nodes.get('f')?.fallen).toBeUndefined();
});

test('reclaimable for three days, then fully lost', () => {
  const g = recordFalls(game, before, claims, falls, t0);
  const now = new Map<string, NodeState>([['c', 'frontier']]);
  expect(reclaimable(g, now, 'c', t0 + 2.9 * DAY, 3 * DAY)?.was).toBe('conquered');
  expect(reclaimable(g, now, 'c', t0 + 3 * DAY, 3 * DAY)).toBeNull();
  expect(reclaimable(g, new Map([['c', 'claimed']]), 'c', t0, 3 * DAY)).toBeNull();
});

test('one right answer restores the old status', () => {
  const g = recordFalls(game, before, claims, falls, t0);
  const back = reclaim(g, 'c', g.nodes.get('c')!.fallen!, t0 + DAY);
  expect(back.change).toEqual({ id: 'c', state: 'conquered' });
  expect(back.game.nodes.get('c')).toEqual({});
  const claim = reclaim(g, 'k', g.nodes.get('k')!.fallen!, t0 + DAY);
  expect(claim.change).toEqual({ id: 'k', state: 'claimed' });
  expect(claim.claim).toEqual({ itEn: t0 + DAY, enIt: t0 + DAY });
});
