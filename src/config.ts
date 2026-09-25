/** Max untouched frontier nodes introduced per day. */
export const NEW_NODES_PER_DAY = 10;

/** Share of words in the open tiers to conquer before the next tier appears. */
export const TIER_UNLOCK_FRACTION = 0.8;

/** After a wrong answer ("Again") the word is locked for this long (app time). */
export const COOLDOWN_MS = 60_000;

/** Verbs (at the matching verb level) needed to open each next tier. */
export const VERBS_PER_TIER = 3;

/** Influence game (core/influence.ts), all rates per day of app time. */
export const INFLUENCE = {
  /** A discovered "?" word turns hostile after this many hours unconquered. */
  hostileAfterHours: 24,
  /** Control a hostile neighbour removes per day, times link strength. */
  hostilePressure: 0.25,
  /** Pressure from a rebelling conquered neighbour (control below `rebelBelow`). */
  rebelPressure: 0.2,
  rebelBelow: 0.3,
  /** Control a healthy conquered neighbour restores per day, times strength and its control. */
  support: 0.15,
  /** Extra support per verb level of the supporting word (verbs are strongholds). */
  verbSupportBonus: 0.5,
  /** Control lost immediately when a conquered word is answered wrongly. */
  wrongAnswerHit: 0.35,
  /** A bought hint (English cousin) halves hostile pressure on its word. */
  hintShield: 0.5,
};

/** A claimed word's English -> Italian step opens this long after Italian -> English. */
export const CLAIM_STEP_GAP_MS = 60_000;
/** A claimed word is conquered by a recall this long after both directions were right. */
export const CLAIM_RECALL_GAP_MS = 10 * 60_000;
export const CLAIM_GAPS = { step: CLAIM_STEP_GAP_MS, recall: CLAIM_RECALL_GAP_MS };
/** After a miss, its claimed neighbours fall unless it is won back within this (app time). */
export const DANGER_MS = 3 * 60_000;
/** A lost word can be won back as it was with one right answer for this long (app time). */
export const RECLAIM_MS = 3 * 24 * 3_600_000;
/** An unfinished claim slips back to "?" after this long (app time). */
export const CLAIM_EXPIRY_MS = 24 * 3_600_000;

/** Reach (core/reach.ts): how conquered and claimed words push the horizon. */
export const REACH = {
  /** Share of a word's push arriving 1, 2 and 3 links away. */
  decay: [1, 0.5, 0.1],
  conquered: 1,
  /** A claimed word pushes this much per finished step (1-2 of 3): enough that
   * two fresh claims next to a word open it, so the start never stalls. */
  claimedPerStep: 0.45,
  home: 1,
  /** Reach to see a word (as a ghost) and to be able to conquer it. */
  sight: 0.25,
  open: 1,
  /** Crossing into another region weakens the push by 30% (less once you know that region). */
  border: 0.7,
  /** A region is familiar after this many conquered words... */
  familiarAt: 5,
  /** ...and then carries push 50% further per link. */
  familiarBoost: 0.5,
  /** Verbs carry a territory, nouns hold it, adjectives and adverbs decorate it. */
  pos: { verb: 1.25, noun: 1, adj: 0.8, adjective: 0.8, adv: 0.8, adverb: 0.8 } as Record<
    string,
    number
  >,
  /** Each tense a verb masters adds this much push. */
  verbLevelBonus: 0.15,
};

/** Coins: earned per conquest (and from achievements), spent on planting a word. */
export const COINS_PER_CONQUEST = 1;
export const PLANT_COST = 5;
/** Price of a hint: a word's English cousin, shown next to it and shielding it. */
export const HINT_COST = 3;
/** Planting a word from a later level costs this much more per level ahead. */
export const PLANT_COST_PER_TIER = 2;
