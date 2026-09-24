/** Health at or above which a word's name is fully visible. */
export const FULL_NAME = 0.9;
/** Health at or below which the name is gone entirely. */
export const NO_NAME = 0.5;

/** Stable pseudo-random order of letter positions, so erosion is gradual and repeatable. */
function erosionOrder(word: string): number[] {
  let h = 2166136261;
  for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const idx = [...word].map((_, i) => i).filter((i) => /\p{L}/u.test(word[i]));
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/**
 * The name of a fading word: letters erode as health falls from 90% to 50%
 * ("la famiglia" -> "la f·m·gl·a"), then it is gone (""). Null health = not
 * reviewed yet, shown in full.
 */
export function fadedName(word: string, health: number | null): string {
  if (health === null || health >= FULL_NAME) return word;
  if (health <= NO_NAME) return '';
  const order = erosionOrder(word);
  const keep = (health - NO_NAME) / (FULL_NAME - NO_NAME);
  const hidden = new Set(order.slice(0, Math.round(order.length * (1 - keep))));
  return [...word].map((ch, i) => (hidden.has(i) ? '·' : ch)).join('');
}
