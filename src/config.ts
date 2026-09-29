/**
 * Levels (core/tiers.ts): each topic climbs on its own words, its next level
 * opening at TOPIC_SHARE of its words so far; the overall level needs
 * OVERALL_SHARE of all words so far held (A1.2 at ~70 words, C1 at ~650 of
 * 2663) plus verb points, and a topic may run at most one band (A1, A2, …)
 * past it.
 */
export const TOPIC_SHARE = 0.6;
export const OVERALL_SHARE = 0.25;

/** After a wrong answer ("Again") the word is locked for this long (app time). */
export const COOLDOWN_MS = 60_000;

/**
 * Verb points per overall level: leaving level k takes this × k. Every tense
 * learned (and not faded) of a verb is a point, however they are spread over verbs.
 */
export const VERB_POINTS_PER_TIER = 4;

/**
 * Supply (core/supply.ts): your words count only while the words around them
 * hold them up. Every word you hold sends out supply by how well you know it
 * (`output` by memory strength level, core/strength; the capital always 1), and
 * each link passes on as much as it is strong. A word gets the shares of its
 * other words added up. Simulated on the vocabulary graph (6 new words a day,
 * walking to nearby words): 92-95% of your words supplied without a miss; one
 * break cuts off up to ~5 words (under 1 on average); three linked words far
 * from home never hold while fresh, 13% after their first review, 60% after
 * two weeks.
 */
export const SUPPLY = {
  /** Supply a held word needs to count (shares add up, so this is well above one share). */
  min: 0.5,
  /**
   * What a held word sends out by memory strength level 0-5: a fresh conquest
   * is level 2 (stability ~3 days), the first review (day 3) makes it 3, two
   * weeks 4, about seven weeks 5 (full, like the capital).
   */
  output: [0.05, 0.1, 0.25, 0.4, 0.65, 1],
  /** A verb sends out this much more per tense learned (not faded), up to 1. */
  perTense: 0.1,
  /** The most one link passes on, however strong (family links are 1.0). */
  maxLink: 0.9,
  /** A cut-off word holds out as long as its memory lasts, but at least a day. */
  minHoldMs: 24 * 3_600_000,
  /** A held word breaks when its weaker direction's recall falls to this (core/fade NO_NAME). */
  breakRecall: 0.8,
  /**
   * The horizon: past your words supply seeps on at this share per word; a
   * hidden word it reaches with `reveal` (summed, like supply) becomes a "?",
   * with `sight` a ghost (less: unseen). Tuned on the graph: with 12 words held
   * ~8 "?" appear beyond the first ring and ~17 ghosts; the stronger your
   * territory, the further it sees (~25 and ~30 at 60 held, ~70 and ~65 at 150).
   */
  fog: 0.6,
  reveal: 0.3,
  sight: 0.12,
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
/**
 * Fast-forward (App): while nothing can be answered and something opens within
 * `horizonMs` (a learning step, a lock, a review), app time runs `speed` times
 * faster until it does, one jump every `tickMs`. Never sooner than `afterAnswerMs`
 * (real time) after an answer: the fast track's gap, so a step can't be answered
 * by copying what was just on screen. Reviews further off than `horizonMs` are
 * never pulled forward (that would be cramming). The author asked for it (Sep 2026):
 * waiting minutes for a step with nothing to do felt dead.
 */
export const FAST_FORWARD = {
  speed: 60,
  horizonMs: 15 * 60_000,
  afterAnswerMs: CLAIM_KNOWN_GAP_MS,
  tickMs: 500,
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
