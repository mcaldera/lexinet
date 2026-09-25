/** Multiple choice for a word seen for the first time: its meaning among decoys. */

type Choosable = { id: string; en: string; pos?: string | null; region?: number | null };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/^(to|the|a|an) /, '')
    .trim();

/**
 * `n` English meanings: the word's own and `n - 1` decoys, shuffled. Decoys
 * share the part of speech (and, when there are enough, the category), so the
 * answer can't be guessed from its form; meanings that overlap the answer
 * ("dog" / "small dog") are never used.
 */
export function meaningChoices(
  word: Choosable,
  pool: Choosable[],
  n = 4,
  random: () => number = Math.random,
): string[] {
  const answer = norm(word.en);
  const seen = new Set([answer]);
  const usable = pool.filter((p) => {
    const e = norm(p.en);
    if (p.id === word.id || !e || e.includes(answer) || answer.includes(e)) return false;
    return true;
  });
  const shuffle = <T>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const samePos = (p: Choosable) => (p.pos ?? '') === (word.pos ?? '');
  const tiers = [
    usable.filter((p) => samePos(p) && p.region != null && p.region === word.region),
    usable.filter(samePos),
    usable,
  ];
  const picked: string[] = [];
  for (const tier of tiers) {
    for (const p of shuffle(tier)) {
      if (picked.length >= n - 1) break;
      const e = norm(p.en);
      if (seen.has(e)) continue;
      seen.add(e);
      picked.push(p.en);
    }
  }
  return shuffle([word.en, ...picked]);
}
