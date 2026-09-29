import { audioSettings } from './audio';

/**
 * Pronunciation with the browser's speech synthesis: an Italian voice from the
 * operating system (or Chrome's online "Google italiano"). Where speech isn't
 * available, the speaker buttons hide; where no Italian voice is installed, the
 * menu says so and failures are reported through `onSpeechProblem`.
 */
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

export const canSpeak = () => !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

const VOICE_KEY = 'sprawl.voice';
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

/** Italian voices, the most dependable first. */
export function italianVoices(): SpeechSynthesisVoice[] {
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('it'))
    .sort((a, b) => rank(a) - rank(b));
}

/** Every voice the browser offers (to tell "no Italian voice" from "no voices at all"). */
export const voiceCount = () => synth?.getVoices().length ?? 0;

function storedVoice(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY);
  } catch {
    return null;
  }
}

/** The voice to use: the one picked in the menu, else the best Italian one. */
export function chosenVoice(): SpeechSynthesisVoice | undefined {
  const voices = italianVoices();
  const name = storedVoice();
  return voices.find((v) => v.name === name) ?? voices[0];
}

export function setVoice(name: string) {
  try {
    localStorage.setItem(VOICE_KEY, name);
  } catch {
    // private mode: not remembered
  }
  listeners.forEach((f) => f());
}

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

/** Say Italian text now (interrupting anything still being said). */
export function speak(text: string, rate = 0.9) {
  if (!canSpeak() || !text.trim()) return;
  const s = synth!;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'it-IT';
  u.rate = rate;
  const v = chosenVoice();
  try {
    if (v) u.voice = v;
  } catch {
    // a stale voice object: the system default for it-IT speaks instead
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
  if (!v && voiceCount() > 0) problem('No Italian voice installed: see Menu → Voice');
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
        : `${v?.name ?? 'The voice'} didn't speak: pick another in the menu`,
    );
  }, 2500);
}

/** Say it only if automatic pronunciation is on (menu). */
export function speakAuto(text: string) {
  if (audioSettings().speech) speak(text);
}
