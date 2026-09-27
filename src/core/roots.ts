/**
 * Root hubs are hyperdrives. A sealed root charges from its words: each counts
 * its reach (core/reach.ts) up to 1, so a word in reach counts fully and a
 * ghost partly. It opens by itself at `need` (a word opens at reach 1; a root
 * needs several of its words in reach, or all of a smaller family). Opening
 * turns all its hidden words into "?", wherever they lie on the map.
 */
export type Family = { id: string; words: string[] };

/** Charge of each sealed root: the reach at its words, summed. */
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
