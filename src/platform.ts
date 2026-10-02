import { Capacitor } from '@capacitor/core';

/**
 * What differs between the website and the Android app (Capacitor wraps the same
 * build). Features never fork on this: only what the phone's WebView lacks or the
 * phone adds goes through here (CLAUDE.md, "Android app"). The plugins load only
 * in the app.
 */
export const isNative = () => Capacitor.isNativePlatform();

/**
 * Android's back button. `handler` returns true when it closed something;
 * otherwise the app goes to the background, as Back does in other apps.
 */
export function onBackButton(handler: () => boolean): () => void {
  if (!isNative()) return () => {};
  let removed = false;
  let remove = () => {};
  void import('@capacitor/app').then(({ App }) =>
    App.addListener('backButton', () => {
      if (!handler()) void App.minimizeApp();
    }).then((h) => {
      remove = () => void h.remove();
      if (removed) remove();
    }),
  );
  return () => {
    removed = true;
    remove();
  };
}

/** Say text with the phone's own text-to-speech (Android WebViews have no speechSynthesis). */
export async function nativeSpeak(text: string, locale: string, rate: number) {
  const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
  await TextToSpeech.speak({ text, lang: locale, rate });
}
