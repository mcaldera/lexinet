import { useSyncExternalStore } from 'react';

/**
 * How the map looks and handles on this device (menu): the direction pad on a
 * touch screen (some like tapping words instead), and the map at the screen's
 * full resolution (sharper, costs frame rate and battery; platform.ts caps it
 * otherwise). Stored in localStorage `sprawl.view`.
 */
export type ViewPrefs = { pad: boolean; sharp: boolean };

const KEY = 'sprawl.view';
const DEFAULTS: ViewPrefs = { pad: true, sharp: false };

function load(): ViewPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let prefs = load();
const listeners = new Set<() => void>();

export const viewPrefs = () => prefs;

export function setViewPref<K extends keyof ViewPrefs>(key: K, value: ViewPrefs[K]) {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // private mode: the choice holds until the page reloads
  }
  listeners.forEach((f) => f());
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export const useViewPrefs = () => useSyncExternalStore(subscribe, viewPrefs);
