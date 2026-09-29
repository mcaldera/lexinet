/**
 * Levels follow your campaign (core/tiers `Campaign`): the next one opens at this
 * share of your home category's words so far, and at least TIER_MIN_WORDS per level.
 */
export const TIER_UNLOCK_FRACTION = 0.6;
export const TIER_MIN_WORDS = 5;

/** After a wrong answer ("Again") the word is locked for this long (app time). */
export const COOLDOWN_MS = 60_000;

/**
 * Verb points per tier: leaving tier k takes this × k. Every tense learned (and
 * not faded) of a verb is a point, however they are spread over verbs.
 */
export const VERB_POINTS_PER_TIER = 2;

/**
 * Supply (core/supply.ts): your words count only while connected to a supply
 * node. Supply is 1 at a node and each link passes on as much as it is strong.
 * `min` 0.1: one node supplies ~37 words once they are all yours (a third of
 * its category), measured on the vocabulary graph.
 */
export const SUPPLY = {
  /** Supply a held word needs to count. */
  min: 0.1,
  /** The most one link passes on, however strong (family links are 1.0). */
  maxLink: 0.9,
  /** A cut-off word holds out as long as its memory lasts, but at least a day. */
  minHoldMs: 24 * 3_600_000,
  /** A held word breaks when its weaker direction's recall falls to this (core/fade NO_NAME). */
  breakRecall: 0.8,
  /** One more supply node for every this many words you have held at once. */
  every: 12,
  /**
   * The horizon: past your words supply seeps on at this share per word, and
   * a hidden word it reaches with `reveal` becomes a "?". Tuned on the graph:
   * with 12 words held ~8 "?" appear two links out, three links out is rare.
   */
  fog: 0.6,
  reveal: 0.08,
};

/** A claimed word's English -> Italian step opens this long after Italian -> English. */
export const CLAIM_STEP_GAP_MS = 60_000;
/** A claimed word is conquered by a recall this long after both directions were right. */
export const CLAIM_RECALL_GAP_MS = 5 * 60_000;
/** Fast track (known at first sight): producing it still waits this long, so it isn't copied. */
export const CLAIM_KNOWN_GAP_MS = 30_000;
export const CLAIM_GAPS = {
  step: CLAIM_STEP_GAP_MS,
  recall: CLAIM_RECALL_GAP_MS,
  known: CLAIM_KNOWN_GAP_MS,
};
/** A lost word can be won back as it was with one right answer for this long (app time). */
export const RECLAIM_MS = 3 * 24 * 3_600_000;
/** An unfinished claim slips back to "?" after this long (app time). */
export const CLAIM_EXPIRY_MS = 24 * 3_600_000;

/**
 * Root hubs (core/roots.ts) open by themselves once this many of their words
 * lie inside your supply (a word counts its share of SUPPLY.min up to 1).
 */
export const ROOTS = { open: 3 };

/** Coins: earned per conquest (and from achievements), spent on planting a word. */
export const COINS_PER_CONQUEST = 1;
export const PLANT_COST = 5;
/** Price of a hint: a word's English cousin, shown next to it. */
export const HINT_COST = 3;
/** Planting a word from a later level costs this much more per level ahead. */
export const PLANT_COST_PER_TIER = 2;

/** Expeditions (core/expedition.ts): take `goal` words of one category within `minutes`. */
export const EXPEDITION = { minutes: 10, goal: 5, coins: 10 };
/**
 * Raids (core/raid.ts): after a right answer, with `chance`, at most every `gapMs`,
 * a raid strikes up to `targets` supplied words (chokepoints more likely); each one left
 * undefended breaks.
 */
export const RAID = {
  durationMs: 3 * 60_000,
  targets: 3,
  gapMs: 20 * 60_000,
  chance: 0.15,
  coins: 3,
};
