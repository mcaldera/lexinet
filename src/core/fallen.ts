import { claimSteps, type Claim } from './claim';
import { without, type Game } from './game';
import type { NodeState, StateChange } from './unlock';

/**
 * A word you had won and lost keeps a memory of it: for a few days a single
 * right answer wins it back as it was (conquered, or claimed with its steps).
 * After that it is fully lost. Stored on the word's game node.
 */
export type Fallen = { was: 'conquered' | 'claimed'; steps: number; at: number };

/** Remember what each word falling back to "?" in `changes` had been. */
export function recordFalls(
  game: Game,
  before: Map<string, NodeState>,
  claimsBefore: Map<string, Claim | undefined>,
  changes: StateChange[],
  at: number,
): Game {
  const falls = changes.filter(
    (c) =>
      c.state === 'frontier' &&
      (before.get(c.id) === 'conquered' || before.get(c.id) === 'claimed'),
  );
  if (!falls.length) return game;
  const nodes = new Map(game.nodes);
  for (const { id } of falls) {
    const was = before.get(id) as Fallen['was'];
    const steps = was === 'claimed' ? claimSteps(claimsBefore.get(id)) : 0;
    // Nothing to win back from a claim with no step done.
    if (was === 'claimed' && steps === 0) continue;
    // Lost: no longer broken or besieged, just remembered.
    nodes.set(id, {
      ...without(nodes.get(id), 'claim', 'missedAt', 'cutSince'),
      fallen: { was, steps, at },
    });
  }
  return { ...game, nodes };
}

/** The fallen record of a "?" word that can still be won back at `t`. */
export function reclaimable(
  game: Game,
  states: Map<string, NodeState>,
  id: string,
  t: number,
  windowMs: number,
): Fallen | null {
  const f = game.nodes.get(id)?.fallen;
  return f && states.get(id) === 'frontier' && t - f.at < windowMs ? f : null;
}

/**
 * A right answer on a reclaimable word: back to what it was. A claim resumes
 * with its steps done as of now, so its next step opens after the usual gap.
 */
export function reclaim(
  game: Game,
  id: string,
  f: Fallen,
  at: number,
): { game: Game; change: StateChange; claim?: Claim } {
  const nodes = new Map(game.nodes);
  if (f.was === 'conquered') {
    nodes.set(id, {});
    return { game: { ...game, nodes }, change: { id, state: 'conquered' } };
  }
  const claim: Claim = f.steps >= 2 ? { itEn: at, enIt: at } : { itEn: at };
  nodes.set(id, { claim });
  return { game: { ...game, nodes }, change: { id, state: 'claimed' }, claim };
}
