import type { SqlDb } from './types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function openDb(): Promise<SqlDb> {
  if (isTauri()) return (await import('./tauri')).openTauriDb();
  return (await import('./sqljs')).openBrowserDb();
}

export type { SqlDb } from './types';
