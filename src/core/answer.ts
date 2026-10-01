import { lang } from './language';
import { Rating, type Grade } from './scheduler';

export type Verdict = 'correct' | 'almost' | 'wrong';
export type AnswerCheck = { verdict: Verdict; grade: Grade; notes: string[] };

const EN_PREFIX = /^(to|the|a|an)\s+/;

export function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '');
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Edit distance counting a swap of adjacent letters as one edit. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Typos tolerated for a word of this length; short words must be exact. */
export function allowedTypos(length: number): number {
  if (length < 4) return 0;
  return length < 8 ? 1 : 2;
}

function splitArticle(s: string): { article: string; core: string } {
  const m = s.match(lang().article);
  if (!m) return { article: '', core: s };
  return { article: (m[1] ?? m[2]).trim(), core: s.slice(m[0].length) };
}

const RESULT: Record<Verdict, Grade> = {
  correct: Rating.Good,
  almost: Rating.Hard,
  wrong: Rating.Again,
};
const result = (verdict: Verdict, notes: string[] = []): AnswerCheck => ({
  verdict,
  grade: RESULT[verdict],
  notes,
});

/** A word in its plain spelling (Mädchen -> maedchen), where the language has one. */
const plainSpelling = (s: string) =>
  (lang().spellings ?? []).reduce((t, [letter, plain]) => t.replaceAll(letter, plain), s);

function checkWord(input: string, expected: string): AnswerCheck {
  const a = splitArticle(input);
  const e = splitArticle(expected);
  const notes: string[] = [];
  if (a.article !== e.article) {
    notes.push(e.article ? `Article: ${expected}` : 'No article needed');
    // German: die Hund is a mistake about the word itself.
    if (lang().strictArticle && a.article && e.article) return result('wrong', notes);
  }
  if (a.core === e.core || plainSpelling(a.core) === plainSpelling(e.core)) {
    return result(notes.length ? 'almost' : 'correct', notes);
  }
  const ca = stripAccents(a.core);
  const ce = stripAccents(e.core);
  if (ca === ce) return result('almost', [...notes, 'Mind the accent']);
  if (editDistance(ca, ce) <= allowedTypos(ce.length)) {
    return result('almost', [...notes, 'Small typo']);
  }
  return result('wrong');
}

function checkEnglish(input: string, expected: string): AnswerCheck {
  const core = (s: string) => s.replace(EN_PREFIX, '');
  const a = core(input);
  // Glosses may list alternatives ("to look at / to watch") and carry notes
  // that need not be typed ("clubs (card suit)", "to spend (time)").
  const options = expected
    .split(/\s*[/;,]\s*/)
    .flatMap((o) => [o, o.replace(/\s*\([^)]*\)\s*/g, ' ').trim()])
    .map(core)
    .filter(Boolean);
  if (options.includes(a)) return result('correct');
  if (options.some((o) => editDistance(a, o) <= allowedTypos(o.length))) {
    return result('almost', ['Small typo']);
  }
  return result('wrong');
}

/**
 * Compare a typed answer with the expected one and suggest an FSRS grade.
 * `side`: 'it' for the language being learned (whichever it is), 'en' for English.
 */
export function checkAnswer(input: string, expected: string, side: 'it' | 'en'): AnswerCheck {
  const a = normalize(input);
  const e = normalize(expected);
  if (!a) return result('wrong');
  if (a === e) return result('correct');
  return side === 'it' ? checkWord(a, e) : checkEnglish(a, e);
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'that',
  'this',
  'into',
  'of',
  'to',
  'a',
  'an',
  'or',
]);
const keywords = (s: string) =>
  normalize(s)
    .replace(/[()"“”]/g, ' ')
    .split(/[^a-z']+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

/**
 * Looser check for a root's meaning ("provisions for a journey (from via, road)"):
 * the usual English check, or sharing a content word with the meaning ("journey").
 */
export function checkMeaning(input: string, meaning: string): AnswerCheck {
  const cleaned = meaning.replace(/\([^)]*\)/g, '').trim() || meaning;
  const strict = checkAnswer(input, cleaned, 'en');
  if (strict.verdict !== 'wrong') return strict;
  const want = new Set(keywords(meaning));
  const hit = keywords(input).some(
    (w) => want.has(w) || [...want].some((m) => m.length >= 5 && editDistance(w, m) <= 1),
  );
  return hit ? result('correct', ['Close enough']) : strict;
}
