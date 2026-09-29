/**
 * Achievements: milestones checked against a snapshot of your progress. Once
 * earned they stay (stored with the time), even if words are lost later, and
 * each pays out sparks (coins in the code) for connecting words (see core/plant.ts).
 * Ids are stored: rename titles freely, never ids.
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
  description: n === 1 ? 'Learn your first word' : `Learn ${n} words`,
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
  words(1, 'First word', 1),
  words(10, 'Train of thought', 2),
  words(25, 'Brainstorm', 3),
  words(50, 'Well read', 4),
  words(100, 'Wordsmith', 5),
  words(250, 'Bookworm', 6),
  words(500, 'Walking dictionary', 8),
  words(1000, 'Mastermind', 10),
  seen(25, 'Curious'),
  seen(100, 'Open mind'),
  seen(300, 'Big picture'),
  {
    id: 'cat-settler',
    title: 'Warming up',
    description: 'Learn 5 words of one topic',
    coins: 2,
    earned: (s) => s.categories.some((c) => c.conquered >= 5),
  },
  {
    id: 'cat-half',
    title: 'Deep dive',
    description: 'Learn half of a topic (at least 6 words)',
    coins: 4,
    earned: (s) => s.categories.some((c) => c.words >= 6 && c.conquered * 2 >= c.words),
  },
  {
    id: 'cat-full',
    title: 'Master of a topic',
    description: 'Learn every word of a topic',
    coins: 8,
    earned: (s) => s.categories.some((c) => c.words >= 3 && c.conquered === c.words),
  },
  {
    id: 'cat-explorer',
    title: 'Wide interests',
    description: 'Learn words in 5 topics',
    coins: 2,
    earned: (s) => s.categories.filter((c) => c.conquered > 0).length >= 5,
  },
  {
    id: 'cat-globetrotter',
    title: 'Renaissance mind',
    description: 'Learn words in 15 topics',
    coins: 5,
    earned: (s) => s.categories.filter((c) => c.conquered > 0).length >= 15,
  },
  {
    id: 'tight-knit',
    title: 'Tight-knit',
    description: 'A topic of 5+ learned words with cohesion of 60%',
    coins: 3,
    earned: (s) => s.cohesionAt(5) >= 0.6,
  },
  {
    id: 'fortress',
    title: 'Well connected',
    description: 'A topic of 10+ learned words with cohesion of 75%',
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
  score(2500, 'Milestone', 6),
  score(5000, 'Legend', 10),
  {
    id: 'plant-1',
    title: 'Connector',
    description: 'Connect a new word to one of yours',
    coins: 2,
    earned: (s) => s.planted >= 1,
  },
  {
    id: 'plant-5',
    title: 'Networker',
    description: 'Connect 5 new words',
    coins: 5,
    earned: (s) => s.planted >= 5,
  },
];

/** Achievements earned by `stats` that aren't in `earned` yet. */
export const newlyEarned = (stats: Stats, earned: Record<string, number>) =>
  ACHIEVEMENTS.filter((a) => !(a.id in earned) && a.earned(stats));
