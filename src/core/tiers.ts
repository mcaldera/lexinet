import type { NodeState } from './unlock';

/**
 * Levels (CEFR sub-levels A1.1 … C1, "tiers" in the data): every topic
 * (category) climbs its own ladder on its own words, and an overall level,
 * from the words you hold across the whole network plus verb points, limits
 * how far ahead any topic may run. Derived from state, never stored.
 */

/** The overall level: from the words you hold anywhere, plus verb points. */
export type OverallLevel = {
  tier: number;
  maxTier: number;
  /** Words you hold (conquered), anywhere. */
  held: number;
  /** Held words the next level needs (0 at the top). */
  needed: number;
  /** Every tense learned (not faded) of any verb is a point. */
  verbPoints: number;
  /** Verb points the next level needs (0 at the top). */
  pointsNeed: number;
};

/** A topic's level: it climbs on its own words, at most one band past the overall level. */
export type TopicLevel = {
  tier: number;
  /** Its conquered words of levels up to `tier`, and how many its next level needs (0 at the top). */
  conquered: number;
  needed: number;
  /** It has what its next level needs, but the overall level holds it back. */
  capped: boolean;
  /** All its words, and those you hold. */
  words: number;
  held: number;
};

export type Levels = {
  overall: OverallLevel;
  topics: Map<number, TopicLevel>;
  /** The highest level a topic may reach now: the end of the band after the overall level's. */
  cap: number;
};

export type LevelRules = {
  /** The next overall level needs this share of all words up to the current one, held. */
  overallShare: number;
  /** A topic's next level needs this share of its own words up to its current one. */
  topicShare: number;
  /** Verb points: leaving overall level k takes `perTier` × k. */
  perTier: number;
  /** Tenses per verb (a verb's most points). */
  maxLevel: number;
};

export type LevelWord = { id: string; tier?: number | null; region?: number | null };

/**
 * Bands from level names ("A1.2" → A1): levels of one band share a number, in
 * order. Without names every level is its own band.
 */
export function bandsOf(names?: Record<string, string> | null) {
  const band = (tier: number) => names?.[String(tier)]?.split('.')[0];
  const order = new Map<string, number>();
  const tiers = Object.keys(names ?? {}).map(Number);
  for (const t of tiers.sort((x, y) => x - y)) {
    const b = band(t)!;
    if (!order.has(b)) order.set(b, order.size);
  }
  return (tier: number) => {
    const b = band(tier);
    return b === undefined ? tier : order.get(b)!;
  };
}

export function computeLevels(
  words: LevelWord[],
  states: Map<string, NodeState>,
  /** Verb level (tenses learned, not faded) per verb. */
  verbs: Map<string, number>,
  rules: LevelRules,
  bandOf: (tier: number) => number = (t) => t,
): Levels {
  const tierOf = new Map(words.map((w) => [w.id, w.tier ?? 1]));
  const maxTier = Math.max(1, ...tierOf.values());
  const capOf = (tier: number) => {
    let cap = tier;
    while (cap < maxTier && bandOf(cap + 1) <= bandOf(tier) + 1) cap++;
    return cap;
  };
  const upTo = new Array<number>(maxTier + 2).fill(0);
  for (const t of tierOf.values()) upTo[t]++;
  for (let t = 1; t <= maxTier; t++) upTo[t] += upTo[t - 1];
  const held = words.filter((w) => states.get(w.id) === 'conquered').length;
  const verbPoints = [...verbs.values()].reduce((a, b) => a + b, 0);

  let tier = 1;
  let needed = 0;
  let pointsNeed = 0;
  for (;;) {
    if (tier >= maxTier) {
      [needed, pointsNeed] = [0, 0];
      break;
    }
    needed = Math.ceil(rules.overallShare * upTo[tier]);
    // Verb points are capped by what the verbs in reach could give: those a topic
    // may reach now, and any already started (planted from further on, say).
    const pool = [...verbs].filter(([id, lvl]) => lvl > 0 || (tierOf.get(id) ?? 1) <= capOf(tier));
    pointsNeed = Math.min(rules.perTier * tier, pool.length * rules.maxLevel);
    if (held < needed || verbPoints < pointsNeed) break;
    tier++;
  }
  const cap = capOf(tier);

  const byTopic = new Map<number, LevelWord[]>();
  for (const w of words) {
    if (w.region == null) continue;
    byTopic.set(w.region, [...(byTopic.get(w.region) ?? []), w]);
  }
  const topics = new Map<number, TopicLevel>();
  for (const [region, own] of byTopic) {
    const done = own.filter((w) => states.get(w.id) === 'conquered');
    const count = (list: LevelWord[], t: number) => list.filter((w) => (w.tier ?? 1) <= t).length;
    let t = 1;
    let capped = false;
    let need = 0;
    for (;;) {
      if (t >= maxTier) {
        need = 0;
        break;
      }
      need = Math.ceil(rules.topicShare * count(own, t));
      if (count(done, t) < need) break;
      if (t + 1 > cap) {
        capped = true;
        break;
      }
      t++;
    }
    topics.set(region, {
      tier: t,
      conquered: count(done, t),
      needed: need,
      capped,
      words: own.length,
      held: done.length,
    });
  }
  return { overall: { tier, maxTier, held, needed, verbPoints, pointsNeed }, topics, cap };
}

/** Whether a word may be revealed: its level is open in its topic (no topic: the cap). */
export function levelAllows(words: LevelWord[], levels: Levels) {
  const of = new Map(words.map((w) => [w.id, w]));
  return (id: string) => {
    const w = of.get(id);
    const open = w?.region == null ? levels.cap : (levels.topics.get(w.region)?.tier ?? 1);
    return (w?.tier ?? 1) <= open;
  };
}

/** The level a word counts as open at (its topic's), for pricing a planted word. */
export function openTierOf(words: LevelWord[], levels: Levels) {
  const of = new Map(words.map((w) => [w.id, w]));
  return (id: string) => {
    const w = of.get(id);
    return w?.region == null ? levels.cap : (levels.topics.get(w.region)?.tier ?? 1);
  };
}

export const tierMap = (nodes: { id: string; tier?: number | null }[]) =>
  new Map(nodes.map((n) => [n.id, n.tier ?? 1]));
