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
/** `minGoal`: a topic with fewer "?" open than this is no focus. */
export type ExpeditionRules = { minutes: number; goal: number; minGoal: number };

const won = (st?: NodeState) => st === 'claimed' || st === 'conquered';

/**
 * A new expedition into a category with at least `goal` words to take ("?"
 * there now), chosen at random among the three with the most of them. The goal
 * counts only open "?": words still hidden there open only after a conquest,
 * three steps and five minutes away, and chasing them made a focus fail
 * (author, Sep 2026). With no topic that open, the one(s) with the most, if at
 * least `minGoal`, for a smaller goal; else none.
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
    .filter((x) => x.n >= rules.minGoal)
    .sort((a, b) => b.n - a.n);
  if (!open.length) return null;
  const full = open.filter((x) => x.n >= rules.goal);
  const pool = (full.length ? full : open.filter((x) => x.n === open[0].n)).slice(0, 3);
  const { r, n } = pool[Math.floor(random() * pool.length)];
  return {
    region: r.id,
    goal: Math.min(rules.goal, n),
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
