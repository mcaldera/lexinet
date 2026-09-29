/**
 * Root hubs are hyperdrives. A sealed root charges from its words: each counts
 * the supply reaching it (core/supply.ts, as a share of what a word needs) up
 * to 1, so a word inside your supply counts fully and one at its edge partly.
 * It opens by itself at `need` (several of its words, or all of a smaller
 * family). Opening turns all its hidden words into "?", wherever they lie.
 */
export type Family = { id: string; words: string[] };

/** Charge of each sealed root: the supply at its words (each up to 1), summed. */
export function rootCharge(
  hubs: Family[],
  reach: Map<string, number>,
  unlocked: Set<string>,
): Map<string, number> {
  return new Map(
    hubs
      .filter((h) => !unlocked.has(h.id))
      .map((h) => [h.id, h.words.reduce((sum, w) => sum + Math.min(1, reach.get(w) ?? 0), 0)]),
  );
}

/** What a root needs: `need` words' worth, or all of a smaller family. */
export const rootNeed = (h: Family, need: number) => Math.min(need, h.words.length);

/** Sealed roots whose charge has reached what they need: they open now. */
export function rootOpenings<T extends Family>(
  hubs: T[],
  reach: Map<string, number>,
  unlocked: Set<string>,
  need: number,
): T[] {
  const charge = rootCharge(hubs, reach, unlocked);
  return hubs.filter((h) => (charge.get(h.id) ?? 0) >= rootNeed(h, need) - 1e-9);
}
