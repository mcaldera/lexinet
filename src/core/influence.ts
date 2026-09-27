import type { Claim } from './claim';
import type { NodeState, StateChange } from './unlock';

/** Game layer on top of memory: how firmly each word is held, and who is hostile. */
export type GameNode = {
  /** 0..1 for conquered words; displayed health is min(memory, control). */
  control: number;
  /** When the word became frontier (ms): it turns hostile after a grace period. */
  since?: number;
  /** Hostile until this time (ms) regardless of grace, e.g. after a wrong answer. */
  hostileUntil?: number;
  /** Claimed words: progress towards conquest (see core/claim.ts). */
  claim?: Claim;
  /** Won once and lost: a single right answer wins it back for a while (core/fallen.ts). */
  fallen?: { was: 'conquered' | 'claimed'; steps: number; at: number };
  /** Endangered by a miss on `from`: falls at `until` unless rescued (core/danger.ts). */
  danger?: { until: number; from: string };
};
export type Game = { simAt: number; nodes: Map<string, GameNode> };

export type InfluenceRules = {
  hostileAfterHours: number;
  hostilePressure: number;
  rebelPressure: number;
  rebelBelow: number;
  support: number;
  verbSupportBonus: number;
  wrongAnswerHit: number;
  /** Hostile and rebel pressure on a word with a bought hint is multiplied by this. */
  hintShield: number;
  /** Each level of memory strength (core/strength.ts) takes this share off hostile pressure. */
  strengthArmour: number;
};

export type Link = { source: string; target: string; weight: number };

const HOUR = 3_600_000;

/** A discovered, unconquered word that attacks its conquered neighbours. */
export function isHostile(
  g: GameNode | undefined,
  state: NodeState | undefined,
  t: number,
  rules: InfluenceRules,
) {
  if (state !== 'frontier' || !g) return false;
  if (g.hostileUntil && g.hostileUntil > t) return true;
  return g.since !== undefined && t - g.since >= rules.hostileAfterHours * HOUR;
}

export const isRebel = (
  g: GameNode | undefined,
  state: NodeState | undefined,
  rules: InfluenceRules,
) => state === 'conquered' && (g?.control ?? 1) < rules.rebelBelow;

export type Influence = { id: string; kind: 'attack' | 'rebel' | 'support'; perDay: number };

/**
 * Each neighbour's effect on a conquered word's control, per day. Words in
 * `shielded` (a bought hint) take only part of the hostile pressure, and so do
 * well-learned words: each level of memory `strength` is armour.
 */
export function pressureBreakdown(
  id: string,
  game: Map<string, GameNode>,
  states: Map<string, NodeState>,
  neighbours: Map<string, { id: string; weight: number }[]>,
  verbLevels: Map<string, number>,
  t: number,
  rules: InfluenceRules,
  shielded: Set<string> = new Set(),
  strength: Map<string, number> = new Map(),
): Influence[] {
  const out: Influence[] = [];
  const shield =
    (shielded.has(id) ? rules.hintShield : 1) *
    Math.max(0, 1 - rules.strengthArmour * (strength.get(id) ?? 0));
  for (const { id: n, weight } of neighbours.get(id) ?? []) {
    const g = game.get(n);
    const s = states.get(n);
    if (isHostile(g, s, t, rules))
      out.push({ id: n, kind: 'attack', perDay: -rules.hostilePressure * weight * shield });
    else if (isRebel(g, s, rules))
      out.push({ id: n, kind: 'rebel', perDay: -rules.rebelPressure * weight * shield });
    else if (s === 'conquered') {
      const bonus = 1 + rules.verbSupportBonus * (verbLevels.get(n) ?? 0);
      out.push({
        id: n,
        kind: 'support',
        perDay: rules.support * weight * (g?.control ?? 1) * bonus,
      });
    }
  }
  return out;
}

/** Net control change per day for a conquered word. */
export function pressureOn(
  id: string,
  game: Map<string, GameNode>,
  states: Map<string, NodeState>,
  neighbours: Map<string, { id: string; weight: number }[]>,
  verbLevels: Map<string, number>,
  t: number,
  rules: InfluenceRules,
  shielded: Set<string> = new Set(),
  strength: Map<string, number> = new Map(),
): number {
  return pressureBreakdown(
    id,
    game,
    states,
    neighbours,
    verbLevels,
    t,
    rules,
    shielded,
    strength,
  ).reduce((a, b) => a + b.perDay, 0);
}

/**
 * How firmly a conquered word is embedded: summed strength of its links to
 * other conquered words (0 = isolated outpost), and the size of its conquered
 * cluster (connected conquered words).
 */
export function cohesion(
  id: string,
  states: Map<string, NodeState>,
  neighbours: Map<string, { id: string; weight: number }[]>,
): { links: number; cluster: number } {
  const links = (neighbours.get(id) ?? [])
    .filter((n) => states.get(n.id) === 'conquered')
    .reduce((a, n) => a + n.weight, 0);
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    for (const n of neighbours.get(stack.pop()!) ?? []) {
      if (!seen.has(n.id) && states.get(n.id) === 'conquered') {
        seen.add(n.id);
        stack.push(n.id);
      }
    }
  }
  return { links, cluster: seen.size };
}

export function neighbourWeights(links: Link[]) {
  const m = new Map<string, { id: string; weight: number }[]>();
  const add = (a: string, b: string, weight: number) =>
    m.set(a, [...(m.get(a) ?? []), { id: b, weight }]);
  for (const l of links) {
    add(l.source, l.target, l.weight);
    add(l.target, l.source, l.weight);
  }
  return m;
}

/**
 * Advance the influence game from game.simAt to `to` in 1-hour steps (at most
 * 60 days). Returns the new game and the words lost (control hit 0), which fall
 * back to hostile frontier. Frontier words without a record start their grace
 * period now.
 */
export function simulate(
  game: Game,
  states: Map<string, NodeState>,
  neighbours: Map<string, { id: string; weight: number }[]>,
  verbLevels: Map<string, number>,
  to: number,
  rules: InfluenceRules,
  /** Words with a bought hint: they take less hostile pressure. */
  shielded: Set<string> = new Set(),
  /** Memory strength per word (armour, see pressureBreakdown). */
  strength: Map<string, number> = new Map(),
): { game: Game; lost: StateChange[] } {
  const nodes = new Map(game.nodes);
  const st = new Map(states);
  for (const [id, s] of st) {
    if (s === 'frontier' && !nodes.get(id)?.since)
      nodes.set(id, { control: 0, ...nodes.get(id), since: to });
    if (s === 'conquered' && !nodes.has(id)) nodes.set(id, { control: 1 });
  }
  const lost: StateChange[] = [];
  // No history yet (first run): start now instead of simulating an empty past.
  let t = game.simAt ? Math.max(game.simAt, to - 60 * 24 * HOUR) : to;
  while (t < to) {
    const dt = Math.min(HOUR, to - t);
    const days = dt / (24 * HOUR);
    const updates: [string, number][] = [];
    for (const [id, s] of st) {
      if (s !== 'conquered') continue;
      const rate = pressureOn(id, nodes, st, neighbours, verbLevels, t, rules, shielded, strength);
      if (rate !== 0) updates.push([id, (nodes.get(id)?.control ?? 1) + rate * days]);
    }
    t += dt;
    for (const [id, c] of updates) {
      if (c <= 0) {
        // Lost: the word turns against you until you win it back.
        st.set(id, 'frontier');
        nodes.set(id, { control: 0, since: t, hostileUntil: t + rules.hostileAfterHours * HOUR });
        lost.push({ id, state: 'frontier' });
      } else {
        nodes.set(id, { ...nodes.get(id), control: Math.min(1, c) });
      }
    }
  }
  return { game: { simAt: to, nodes }, lost };
}

/**
 * Game consequences of an answer on `nodeId` (state before the answer):
 * success restores full control; a miss makes a frontier word hostile at once
 * or costs a conquered word control. Words newly revealed start their grace.
 */
export function afterAnswer(
  game: Game,
  nodeId: string,
  stateBefore: NodeState | undefined,
  success: boolean,
  revealed: StateChange[],
  at: number,
  rules: InfluenceRules,
): Game {
  const nodes = new Map(game.nodes);
  const g = nodes.get(nodeId) ?? { control: 1 };
  if (success) {
    nodes.set(nodeId, { control: 1 });
  } else if (stateBefore === 'frontier') {
    nodes.set(nodeId, {
      ...g,
      since: g.since ?? at,
      hostileUntil: at + rules.hostileAfterHours * HOUR,
    });
  } else if (stateBefore === 'conquered') {
    nodes.set(nodeId, { ...g, control: Math.max(0.01, g.control - rules.wrongAnswerHit) });
  }
  for (const c of revealed) {
    if (c.state === 'frontier' && c.id !== nodeId && !nodes.get(c.id)?.since) {
      nodes.set(c.id, { control: 0, since: at });
    }
  }
  return { ...game, nodes };
}
