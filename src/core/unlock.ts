import { Rating, type Grade } from './scheduler';

/**
 * locked: hidden · frontier: discovered "?" · claimed: answered right once but
 * fragile (see core/claim.ts) · conquered: fully won.
 */
export type NodeState = 'locked' | 'frontier' | 'claimed' | 'conquered';
export type StateChange = { id: string; state: NodeState };

export function initialStates(nodeIds: string[], seed: string): Map<string, NodeState> {
  return new Map(nodeIds.map((id) => [id, id === seed ? 'frontier' : 'locked']));
}

export function neighbourMap(edges: { source: string; target: string }[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const add = (a: string, b: string) => m.set(a, [...(m.get(a) ?? []), b]);
  for (const e of edges) {
    add(e.source, e.target);
    add(e.target, e.source);
  }
  return m;
}

/**
 * State change caused by rating one of `nodeId`'s cards: a frontier node rated
 * Hard or better is claimed (conquering it takes a few more steps). Which words
 * that reveals is up to reach (core/reach.ts).
 */
export function unlockChanges(
  nodeId: string,
  grade: Grade,
  states: Map<string, NodeState>,
): StateChange[] {
  // Anything but "Again" counts: near misses (typo, article) are graded Hard.
  if (states.get(nodeId) !== 'frontier' || grade < Rating.Hard) return [];
  return [{ id: nodeId, state: 'claimed' }];
}

export function applyChanges(states: Map<string, NodeState>, changes: StateChange[]) {
  const next = new Map(states);
  for (const c of changes) next.set(c.id, c.state);
  return next;
}

/** A real miss on `nodeId`: it and its claimed neighbours slip back to "?". */
export function slipChanges(
  nodeId: string,
  states: Map<string, NodeState>,
  neighbours: Map<string, string[]>,
): StateChange[] {
  return [nodeId, ...(neighbours.get(nodeId) ?? [])]
    .filter((id) => states.get(id) === 'claimed')
    .map((id) => ({ id, state: 'frontier' as const }));
}
