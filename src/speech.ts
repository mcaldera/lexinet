import { audioSettings } from './audio';

/**
 * Pronunciation with the browser's speech synthesis (an Italian voice when the
 * system has one). Nothing to download; where speech isn't available, every
 * call is a no-op and the speaker buttons hide.
 */
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

export const canSpeak = () => !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

let voice: SpeechSynthesisVoice | undefined;
function italianVoice() {
  if (voice || !synth) return voice;
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('it'));
  // Prefer a local voice (no network) and a natural-sounding one if named so.
  voice =
    voices.find((v) => v.localService && /natural|premium|enhanced/i.test(v.name)) ??
    voices.find((v) => v.localService) ??
    voices[0];
  return voice;
}
synth?.addEventListener?.('voiceschanged', () => {
  voice = undefined;
});

/** Say Italian text now (interrupting anything still being said). */
export function speak(text: string, rate = 0.9) {
  if (!canSpeak() || !text.trim()) return;
  synth!.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'it-IT';
  u.rate = rate;
  const v = italianVoice();
  if (v) u.voice = v;
  synth!.speak(u);
}

/** Say it only if automatic pronunciation is on (menu). */
export function speakAuto(text: string) {
  if (audioSettings().speech) speak(text);
}
