import { audioSettings } from './audio';
import { lang } from './core/language';

/**
 * Pronunciation with the browser's speech synthesis: a voice of the language
 * being learned from the operating system (or Chrome's online ones, "Google
 * italiano"). Where speech isn't available, the speaker buttons hide; where no
 * voice of the language is installed, the menu says so and failures are
 * reported through `onSpeechProblem`.
 */
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

export const canSpeak = () => !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

const listeners = new Set<() => void>();
const problems = new Set<(message: string) => void>();

/**
 * macOS's novelty voices (Eloquence: Eddy, Flo, Grandma, ...) are listed in
 * Chrome but play silently there; they work in Safari.
 */
const ELOQUENCE = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
export const mayBeSilent = (v: SpeechSynthesisVoice) => ELOQUENCE.test(v.name);

/** How likely a voice is to sound good: Google's, then the system's proper voices. */
const rank = (v: SpeechSynthesisVoice) =>
  mayBeSilent(v)
    ? 3
    : /google/i.test(v.name)
      ? 0
      : /natural|premium|enhanced/i.test(v.name)
        ? 1
        : 2;

/**
 * Voices of the language being learned, the most dependable first; its own
 * country's before others (es-ES before es-MX).
 */
export function languageVoices(): SpeechSynthesisVoice[] {
  if (!synth) return [];
  const tag = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-');
  const locale = lang().locale.toLowerCase();
  return synth
    .getVoices()
    .filter((v) => tag(v).startsWith(lang().code))
    .sort((a, b) => Number(tag(b) === locale) - Number(tag(a) === locale) || rank(a) - rank(b));
}

/** Every voice the browser offers (to tell "no voice of the language" from "no voices at all"). */
export const voiceCount = () => synth?.getVoices().length ?? 0;

/** The voice to use: the best of the language (Google's online one where there is one). */
export const chosenVoice = (): SpeechSynthesisVoice | undefined => languageVoices()[0];

/** Voices arrive asynchronously in Chrome: re-render menus when they do. */
export function onVoices(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
synth?.addEventListener?.('voiceschanged', () => listeners.forEach((f) => f()));

/** Called with a short message when speaking fails (shown as a notice). */
export function onSpeechProblem(f: (message: string) => void) {
  problems.add(f);
  return () => void problems.delete(f);
}
const problem = (message: string) => problems.forEach((f) => f(message));

// Chrome drops an utterance that is garbage-collected mid-speech: keep it alive.
let current: SpeechSynthesisUtterance | null = null;

/** Say text in the language being learned now (interrupting anything still being said). */
export function speak(text: string, rate = 0.9) {
  if (!canSpeak() || !text.trim()) return;
  const s = synth!;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang().locale;
  u.rate = rate;
  const v = chosenVoice();
  try {
    if (v) u.voice = v;
  } catch {
    // a stale voice object: the system default for the locale speaks instead
  }
  let started = false;
  u.onstart = () => {
    started = true;
  };
  u.onend = () => {
    if (current === u) current = null;
  };
  u.onerror = (e) => {
    // Interrupting our own speech is not a problem.
    if (e.error !== 'interrupted' && e.error !== 'canceled') problem(`Speech failed (${e.error})`);
  };
  current = u;
  if (!v && voiceCount() > 0) problem(`No ${lang().name} voice installed (see “How it works”)`);
  // Chrome can swallow an utterance queued right after cancel(), and sometimes
  // sits paused after a tab switch: cancel only when busy, then speak a tick later.
  if (s.speaking || s.pending) s.cancel();
  setTimeout(() => {
    s.resume();
    s.speak(u);
  }, 50);
  // Some voices accept the text and never make a sound: say so instead of staying silent.
  setTimeout(() => {
    if (started || current !== u) return;
    // Chrome's engine can hang for good after an error (still "speaking", no sound):
    // only quitting the browser clears that.
    const stuck = s.speaking || s.pending;
    s.cancel();
    problem(
      stuck
        ? "The browser's speech is stuck: quit Chrome completely and reopen"
        : `${v?.name ?? 'The voice'} didn't speak`,
    );
  }, 2500);
}

/** Say it only if automatic pronunciation is on (menu). */
export function speakAuto(text: string) {
  if (audioSettings().speech) speak(text);
}
