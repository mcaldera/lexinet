import { Capacitor } from '@capacitor/core';

/**
 * What differs between the website and the Android app (Capacitor wraps the same
 * build). Features never fork on this: only what the phone's WebView lacks or the
 * phone adds goes through here (CLAUDE.md, "Android app"). The plugins load only
 * in the app.
 */
export const isNative = () => Capacitor.isNativePlatform();

/** A phone or tablet (in the app or a browser): a finger, not a mouse. */
export const isTouch = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/**
 * Phones draw the map at most this many device pixels per CSS pixel. The map
 * redraws every frame while anything moves on it, and a Pixel 7's 2.6 made it
 * crawl: the cost follows the pixel count. force-graph reads `devicePixelRatio`
 * wherever it sizes or draws, so the cap goes there; HTML text stays sharp, as
 * the browser doesn't read the property back. 1.5 looked soft on the phone; with
 * the ground cached (GraphView `drawGround`), 2 keeps ~85% of 1.5's frame rate
 * (2.6: ~60%; Chrome, CPU ×4 slower).
 */
const TOUCH_MAX_PIXEL_RATIO = 2;

/** Before the map is created (main.tsx). */
export function capPixelRatio() {
  if (!isTouch() || window.devicePixelRatio <= TOUCH_MAX_PIXEL_RATIO) return;
  Object.defineProperty(window, 'devicePixelRatio', { get: () => TOUCH_MAX_PIXEL_RATIO });
}

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
