/** Fill-the-gap: an example sentence with the word taken out. */

export type Example = { it: string; en: string; blank: string };

/** The sentence around the gap, or null if the blank isn't in it as a whole word. */
export function cloze(ex: Example): { before: string; after: string } | null {
  const esc = ex.blank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?<![\\p{L}'])${esc}(?![\\p{L}])`, 'iu').exec(ex.it);
  if (!m) return null;
  return { before: ex.it.slice(0, m.index), after: ex.it.slice(m.index + m[0].length) };
}
