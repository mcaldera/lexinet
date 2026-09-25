import type { NodeState } from './unlock';

/**
 * Expeditions: a timed push into one category. Take `goal` of its words
 * (claim or conquer them) before `until` (app time) for a coin reward;
 * failing costs nothing.
 */
export type Expedition = {
  region: number;
  goal: number;
  start: number;
  until: number;
  /** Words of the region already won when it started (they don't count). */
  before: string[];
};
export type ExpeditionRules = { minutes: number; goal: number };

const won = (st?: NodeState) => st === 'claimed' || st === 'conquered';

/**
 * A new expedition into a category with words to take ("?" there now), chosen
 * at random among the three with the most of them. None if nothing is open.
 */
export function planExpedition(
  regions: { id: number; words: string[] }[],
  states: Map<string, NodeState>,
  t: number,
  rules: ExpeditionRules,
  random: () => number = Math.random,
): Expedition | null {
  const open = regions
    .map((r) => ({ r, n: r.words.filter((w) => states.get(w) === 'frontier').length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  if (!open.length) return null;
  const { r } = open[Math.floor(random() * open.length)];
  const left = r.words.filter((w) => !won(states.get(w))).length;
  return {
    region: r.id,
    goal: Math.min(rules.goal, left),
    start: t,
    until: t + rules.minutes * 60_000,
    before: r.words.filter((w) => won(states.get(w))),
  };
}

/** Words taken so far, and whether it's won, lost (time out) or still on. */
export function expeditionStatus(
  exp: Expedition,
  regionWords: string[],
  states: Map<string, NodeState>,
  t: number,
) {
  const before = new Set(exp.before);
  const taken = regionWords.filter((w) => !before.has(w) && won(states.get(w))).length;
  const state = taken >= exp.goal ? 'won' : t >= exp.until ? 'lost' : 'on';
  return { taken, state } as const;
}
