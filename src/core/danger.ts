import type { Game, GameNode } from './influence';
import type { NodeState, StateChange } from './unlock';

/**
 * Danger: a real miss makes the word fall (a claimed word drops back to a
 * hostile "?"; any missed word turns hostile) and puts its claimed neighbours
 * in danger. Win the missed word back before the deadline, or answer the
 * endangered word itself, and nothing more happens; otherwise the endangered
 * words fall too (one level, no chain reaction).
 */
export type Danger = { until: number; from: string };

const hostileNode = (at: number, hostileMs: number): GameNode => ({
  control: 0,
  since: at,
  hostileUntil: at + hostileMs,
});

/** Consequences of a real miss on `nodeId` at `at` (states already include this answer). */
export function missed(
  game: Game,
  nodeId: string,
  states: Map<string, NodeState>,
  neighbours: Map<string, string[]>,
  at: number,
  windowMs: number,
  hostileMs: number,
): { game: Game; changes: StateChange[]; endangered: string[] } {
  const nodes = new Map(game.nodes);
  const changes: StateChange[] = [];
  if (states.get(nodeId) === 'claimed') {
    changes.push({ id: nodeId, state: 'frontier' });
    nodes.set(nodeId, hostileNode(at, hostileMs));
  }
  const endangered: string[] = [];
  for (const n of neighbours.get(nodeId) ?? []) {
    if (states.get(n) !== 'claimed') continue;
    const g = nodes.get(n) ?? { control: 1 };
    // An earlier, sooner deadline stands.
    if (g.danger && g.danger.until <= at + windowMs) continue;
    nodes.set(n, { ...g, danger: { until: at + windowMs, from: nodeId } });
    endangered.push(n);
  }
  return { game: { ...game, nodes }, changes, endangered };
}

/** A correct answer on `nodeId`: the words it endangered are safe again. */
export function rescue(game: Game, nodeId: string): Game {
  let nodes: Map<string, GameNode> | null = null;
  for (const [id, g] of game.nodes) {
    if (g.danger?.from !== nodeId) continue;
    nodes ??= new Map(game.nodes);
    nodes.set(id, { ...g, danger: undefined });
  }
  return nodes ? { ...game, nodes } : game;
}

/** Endangered words whose deadline passed by `t` fall to hostile "?". */
export function dangerFalls(
  game: Game,
  states: Map<string, NodeState>,
  t: number,
  hostileMs: number,
): { game: Game; changes: StateChange[] } {
  const nodes = new Map(game.nodes);
  const changes: StateChange[] = [];
  for (const [id, g] of game.nodes) {
    if (!g.danger) continue;
    if (states.get(id) !== 'claimed') {
      nodes.set(id, { ...g, danger: undefined }); // conquered or already fallen: moot
    } else if (g.danger.until <= t) {
      nodes.set(id, hostileNode(t, hostileMs));
      changes.push({ id, state: 'frontier' });
    }
  }
  return { game: { ...game, nodes }, changes };
}

/** Words currently in danger, with their deadline and the missed word behind it. */
export function dangers(game: Game, states: Map<string, NodeState>): Map<string, Danger> {
  return new Map(
    [...game.nodes]
      .filter(([id, g]) => g.danger && states.get(id) === 'claimed')
      .map(([id, g]) => [id, g.danger!]),
  );
}
