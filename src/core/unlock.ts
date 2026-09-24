import { Rating, type Grade } from './scheduler';

export type NodeState = 'locked' | 'frontier' | 'conquered';
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
 * State changes caused by rating one of `nodeId`'s cards. A frontier node rated
 * Good or Easy is conquered, and its locked neighbours become frontier.
 */
export function unlockChanges(
  nodeId: string,
  grade: Grade,
  states: Map<string, NodeState>,
  neighbours: Map<string, string[]>,
): StateChange[] {
  if (states.get(nodeId) !== 'frontier' || grade < Rating.Good) return [];
  const changes: StateChange[] = [{ id: nodeId, state: 'conquered' }];
  for (const n of neighbours.get(nodeId) ?? []) {
    if (states.get(n) === 'locked') changes.push({ id: n, state: 'frontier' });
  }
  return changes;
}

export function applyChanges(states: Map<string, NodeState>, changes: StateChange[]) {
  const next = new Map(states);
  for (const c of changes) next.set(c.id, c.state);
  return next;
}

/**
 * Fix states after the graph changed (words added/removed, new edges): locked
 * nodes next to conquered ones become frontier, and an empty map restarts at the seed.
 */
export function repairStates(
  states: Map<string, NodeState>,
  neighbours: Map<string, string[]>,
  seed: string,
): StateChange[] {
  const changes: StateChange[] = [];
  for (const [id, state] of states) {
    if (state !== 'locked') continue;
    if ((neighbours.get(id) ?? []).some((n) => states.get(n) === 'conquered')) {
      changes.push({ id, state: 'frontier' });
    }
  }
  const started = [...states.values()].some((s) => s !== 'locked');
  if (!started && states.has(seed)) changes.push({ id: seed, state: 'frontier' });
  return changes;
}
