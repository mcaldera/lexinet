import { claimSteps, type Claim } from './claim';
import type { NodeState, StateChange } from './unlock';

/**
 * Reach: how far your territory pushes the horizon. Every won word pushes
 * (conquered fully, claimed a little per step) and the push fades over links.
 * Pushes add up, so digging into an area moves its horizon. Familiar ground
 * (a region where you've conquered several words) carries push further; a
 * border into another region dampens it, so new areas are found slowly from
 * their edge. Computed, never stored.
 */
export type ReachRules = {
  /** Share of the push arriving 1, 2, 3... links away (none beyond). */
  decay: number[];
  conquered: number;
  claimedPerStep: number;
  /** The seed always pushes like a conquered word, so a new map has a start. */
  home: number;
  /** Seen (a ghost you can't conquer yet) from this much reach. */
  sight: number;
  /** Conquerable ("?") from this much reach. */
  open: number;
  /** Push factor when a link crosses into another region. */
  border: number;
  /** Conquered words that make a region fully familiar. */
  familiarAt: number;
  /** Extra push per link inside a fully familiar region. */
  familiarBoost: number;
  /** Push factor per part of speech (missing: 1). Verbs carry a territory. */
  pos: Record<string, number>;
  /** Extra push per verb level (tense mastered). */
  verbLevelBonus: number;
};

export type ReachInput = {
  states: Map<string, NodeState>;
  claims: Map<string, Claim | undefined>;
  neighbours: Map<string, string[]>;
  /** Region per word (undefined: no regions, every link counts as inside). */
  regionOf: (id: string) => number | undefined;
  seed: string;
  rules: ReachRules;
  /** Part of speech per word, for `rules.pos`. */
  posOf?: (id: string) => string | null | undefined;
  /** Verb level per conjugable verb, for `rules.verbLevelBonus`. */
  verbLevels?: Map<string, number>;
};

export function pushOf(input: ReachInput, id: string): number {
  const { states, claims, seed, rules } = input;
  const st = states.get(id);
  const own =
    st === 'conquered'
      ? rules.conquered
      : st === 'claimed'
        ? rules.claimedPerStep * claimSteps(claims.get(id))
        : 0;
  const pos = input.posOf?.(id)?.toLowerCase() ?? '';
  const kind = (rules.pos[pos] ?? 1) + rules.verbLevelBonus * (input.verbLevels?.get(id) ?? 0);
  return id === seed ? Math.max(own * kind, rules.home) : own * kind;
}

/** Push arriving from `src` at each word it reaches (excluding itself). */
function pushFrom(
  input: ReachInput,
  src: string,
  step: (from: string, to: string) => number,
): Map<string, number> {
  const push = pushOf(input, src);
  const best = new Map<string, number>();
  if (push <= 0) return best;
  // Best path factor to each word at each hop count, up to the decay's length.
  let layer = new Map<string, number>([[src, 1]]);
  for (const share of input.rules.decay) {
    const next = new Map<string, number>();
    for (const [id, f] of layer) {
      for (const n of input.neighbours.get(id) ?? []) {
        if (n === src) continue;
        const g = f * step(id, n);
        if (g > (next.get(n) ?? 0)) next.set(n, g);
      }
    }
    for (const [id, g] of next) best.set(id, Math.max(best.get(id) ?? 0, push * share * g));
    layer = next;
  }
  return best;
}

function stepFactor(input: ReachInput) {
  const fam = familiarity(input);
  const { regionOf, rules } = input;
  return (from: string, to: string) => {
    const [a, b] = [regionOf(from), regionOf(to)];
    const f = b === undefined ? 0 : (fam.get(b) ?? 0);
    if (a === b) return 1 + rules.familiarBoost * f;
    return Math.min(1, rules.border * (1 + f));
  };
}

/** Familiarity 0..1 per region: conquered words there, up to `familiarAt`. */
export function familiarity(input: ReachInput): Map<number, number> {
  const count = new Map<number, number>();
  for (const [id, st] of input.states) {
    const r = input.regionOf(id);
    if (st === 'conquered' && r !== undefined) count.set(r, (count.get(r) ?? 0) + 1);
  }
  return new Map([...count].map(([r, n]) => [r, Math.min(1, n / input.rules.familiarAt)]));
}

/** Reach of every word that some push arrives at (sources included). */
export function reachMap(input: ReachInput): Map<string, number> {
  const step = stepFactor(input);
  const reach = new Map<string, number>();
  for (const src of input.states.keys()) {
    const push = pushOf(input, src);
    if (push <= 0) continue;
    reach.set(src, (reach.get(src) ?? 0) + push);
    for (const [id, v] of pushFrom(input, src, step)) reach.set(id, (reach.get(id) ?? 0) + v);
  }
  return reach;
}

/** Who pushes `target` and how much, strongest first (for explaining reach). */
export function reachSources(input: ReachInput, target: string): { id: string; push: number }[] {
  const step = stepFactor(input);
  const out: { id: string; push: number }[] = [];
  for (const src of input.states.keys()) {
    if (src === target || pushOf(input, src) <= 0) continue;
    const v = pushFrom(input, src, step).get(target);
    if (v) out.push({ id: src, push: v });
  }
  return out.sort((a, b) => b.push - a.push);
}

/** Hidden words in reach that can be seen (not conquered yet). */
export function sightedWords(
  states: Map<string, NodeState>,
  reach: Map<string, number>,
  rules: ReachRules,
  allowed: (id: string) => boolean,
): Map<string, number> {
  return new Map(
    [...reach].filter(
      ([id, r]) => states.get(id) === 'locked' && r >= rules.sight - 1e-9 && allowed(id),
    ),
  );
}

/**
 * Hidden words whose reach is enough to conquer them become "?". If nothing is
 * left to work on, the best sighted word opens anyway so the map never stalls.
 */
export function revealChanges(
  states: Map<string, NodeState>,
  reach: Map<string, number>,
  rules: ReachRules,
  allowed: (id: string) => boolean,
): StateChange[] {
  const hidden = [...reach].filter(([id]) => states.get(id) === 'locked' && allowed(id));
  const open = hidden.filter(([, r]) => r >= rules.open - 1e-9);
  const changes = open.map(([id]) => ({ id, state: 'frontier' as const }));
  const busy = [...states.values()].some((s) => s === 'frontier' || s === 'claimed');
  if (!changes.length && !busy && hidden.length) {
    const [id] = hidden.reduce((a, b) => (b[1] > a[1] ? b : a));
    changes.push({ id, state: 'frontier' });
  }
  return changes;
}
