/**
 * The language being learned. The code still says `it` for a word in it (and
 * `en` for its English meaning, `it-en`/`en-it` for the card directions): it
 * began as Italian only, and saves carry those names.
 *
 * One language per page load (each word list is one language; switching
 * reloads), so it is a module-level setting rather than an argument everywhere.
 */
export type Language = {
  code: string;
  /** "Italian": in prompts like "in Italian", "into Italian". */
  name: string;
  /** Speech synthesis locale; voices of the same language (prefix) also do. */
  locale: string;
  /** A sentence the menu's voice test says. */
  greeting: string;
  /** Letters a plain keyboard lacks, offered as buttons under the answer field. */
  letters: readonly string[];
  /** A word's article at its start: group 1 before a space, group 2 elided ("l'"). */
  article: RegExp;
  /** Verb tenses in the order they are taught: each is a verb level. */
  tenses: readonly string[];
  /** The persons of a conjugation table, in the order of its forms. */
  persons: readonly string[];
};

export const LANGUAGES: Record<string, Language> = {
  it: {
    code: 'it',
    name: 'Italian',
    locale: 'it-IT',
    greeting: 'Ciao! Come stai?',
    letters: ['à', 'è', 'é', 'ì', 'ò', 'ù'],
    article: /^(?:(il|lo|la|i|gli|le|un|uno|una)\s+|(l'|un'))/,
    tenses: ['presente', 'passato prossimo', 'imperfetto', 'futuro', 'condizionale', 'congiuntivo'],
    persons: ['io', 'tu', 'lui/lei', 'noi', 'voi', 'loro'],
  },
  es: {
    code: 'es',
    name: 'Spanish',
    locale: 'es-ES',
    greeting: '¡Hola! ¿Qué tal?',
    letters: ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü'],
    article: /^(?:(el|la|los|las|un|una|unos|unas)\s+)/,
    tenses: [
      'presente',
      'pretérito perfecto',
      'pretérito indefinido',
      'imperfecto',
      'futuro',
      'condicional',
      'subjuntivo',
    ],
    persons: ['yo', 'tú', 'él/ella', 'nosotros', 'vosotros', 'ellos'],
  },
};

let current: Language = LANGUAGES.it;

/** The language being learned (Italian unless set). */
export const lang = (): Language => current;

export function setLanguage(code: string) {
  current = LANGUAGES[code] ?? LANGUAGES.it;
}
