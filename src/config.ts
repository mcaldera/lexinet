/** Max untouched frontier nodes introduced per day. */
export const NEW_NODES_PER_DAY = 10;

/** Share of words in the open tiers to conquer before the next tier appears. */
export const TIER_UNLOCK_FRACTION = 0.8;

/** After a wrong answer ("Again") the word is locked for this long. */
export const COOLDOWN_MS = 60_000;
