/**
 * Achievements: milestones checked against a snapshot of your progress. Once
 * earned they stay (stored with the time), even if words are lost later, and
 * each pays out coins for planting words (see core/plant.ts).
 */
export type Stats = {
  conquered: number;
  /** Words discovered (anything not hidden). */
  revealed: number;
  /** Per category: its size and how many of its words are conquered. */
  categories: { words: number; conquered: number }[];
  /** Best cohesion among categories with at least n conquered words. */
  cohesionAt: (minWords: number) => number;
  verbLevels: number[];
  score: number;
  planted: number;
};

export type Achievement = {
  id: string;
  title: string;
  description: string;
  coins: number;
  earned: (s: Stats) => boolean;
};

const words = (n: number, title: string, coins: number): Achievement => ({
  id: `words-${n}`,
  title,
  description: n === 1 ? 'Conquer your first word' : `Conquer ${n} words`,
  coins,
  earned: (s) => s.conquered >= n,
});
const seen = (n: number, title: string): Achievement => ({
  id: `seen-${n}`,
  title,
  description: `Discover ${n} words`,
  coins: 2,
  earned: (s) => s.revealed >= n,
});
const score = (n: number, title: string, coins: number): Achievement => ({
  id: `score-${n}`,
  title,
  description: `Reach a score of ${n}`,
  coins,
  earned: (s) => s.score >= n,
});

export const ACHIEVEMENTS: Achievement[] = [
  words(1, 'First foothold', 1),
  words(10, 'Settlement', 2),
  words(25, 'Village', 3),
  words(50, 'Town', 4),
  words(100, 'City', 5),
  words(250, 'Province', 6),
  words(500, 'Region', 8),
  words(1000, 'Empire', 10),
  seen(25, 'Look-out'),
  seen(100, 'Cartographer'),
  seen(300, 'Voyager'),
  {
    id: 'cat-settler',
    title: 'Settler',
    description: 'Conquer 5 words of one category',
    coins: 2,
    earned: (s) => s.categories.some((c) => c.conquered >= 5),
  },
  {
    id: 'cat-half',
    title: 'Stronghold',
    description: 'Conquer half of a category (at least 6 words)',
    coins: 4,
    earned: (s) => s.categories.some((c) => c.words >= 6 && c.conquered * 2 >= c.words),
  },
  {
    id: 'cat-full',
    title: 'Master of a category',
    description: 'Conquer every word of a category',
    coins: 8,
    earned: (s) => s.categories.some((c) => c.words >= 3 && c.conquered === c.words),
  },
  {
    id: 'cat-explorer',
    title: 'Explorer',
    description: 'Conquer words in 5 categories',
    coins: 2,
    earned: (s) => s.categories.filter((c) => c.conquered > 0).length >= 5,
  },
  {
    id: 'cat-globetrotter',
    title: 'Globetrotter',
    description: 'Conquer words in 15 categories',
    coins: 5,
    earned: (s) => s.categories.filter((c) => c.conquered > 0).length >= 15,
  },
  {
    id: 'tight-knit',
    title: 'Tight-knit',
    description: 'A category of 5+ conquered words with cohesion of 60%',
    coins: 3,
    earned: (s) => s.cohesionAt(5) >= 0.6,
  },
  {
    id: 'fortress',
    title: 'Fortress',
    description: 'A category of 10+ conquered words with cohesion of 75%',
    coins: 6,
    earned: (s) => s.cohesionAt(10) >= 0.75,
  },
  {
    id: 'verb-first',
    title: 'First tense',
    description: 'Level a verb to the presente',
    coins: 2,
    earned: (s) => s.verbLevels.some((l) => l >= 1),
  },
  {
    id: 'verb-squad',
    title: 'Verb squad',
    description: 'Three verbs at the presente or beyond',
    coins: 3,
    earned: (s) => s.verbLevels.filter((l) => l >= 1).length >= 3,
  },
  {
    id: 'verb-three',
    title: 'Time traveller',
    description: 'Level a verb to three tenses',
    coins: 4,
    earned: (s) => s.verbLevels.some((l) => l >= 3),
  },
  {
    id: 'verb-all',
    title: 'Fully conjugated',
    description: 'Level a verb through all six tenses',
    coins: 8,
    earned: (s) => s.verbLevels.some((l) => l >= 6),
  },
  score(100, 'Scorer', 1),
  score(500, 'High scorer', 3),
  score(1000, 'Four digits', 5),
  score(2500, 'Landmark', 6),
  score(5000, 'Legend', 10),
  {
    id: 'plant-1',
    title: 'Gardener',
    description: 'Plant a word next to one of yours',
    coins: 2,
    earned: (s) => s.planted >= 1,
  },
  {
    id: 'plant-5',
    title: 'Green thumb',
    description: 'Plant 5 words',
    coins: 5,
    earned: (s) => s.planted >= 5,
  },
];

/** Achievements earned by `stats` that aren't in `earned` yet. */
export const newlyEarned = (stats: Stats, earned: Record<string, number>) =>
  ACHIEVEMENTS.filter((a) => !(a.id in earned) && a.earned(stats));
