/** Max untouched frontier nodes introduced per day. */
export const NEW_NODES_PER_DAY = 10;

/** Share of words in the open tiers to conquer before the next tier appears. */
export const TIER_UNLOCK_FRACTION = 0.8;

/** After a wrong answer ("Again") the word is locked for this long. */
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
};
