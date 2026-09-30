import type { SqlDb } from './types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Storage name of a graph's run: `sprawl.db`, `sprawl-oic.db`, `sprawl-oic~<run>.db`. */
export const dbName = (graphName: string, runSuffix = '') =>
  `sprawl${graphName === 'default' ? '' : `-${graphName}`}${runSuffix}.db`;

/** One database per graph and run, so another graph or run keeps its own progress. */
export async function openDb(graphName = 'default', runSuffix = ''): Promise<SqlDb> {
  const name = dbName(graphName, runSuffix);
  if (isTauri()) return (await import('./tauri')).openTauriDb(name);
  return (await import('./sqljs')).openBrowserDb(name);
}

/** Forget a run's database (the browser's; a desktop run's file stays). */
export async function deleteDb(graphName: string, runSuffix: string) {
  if (!isTauri()) await (await import('./store')).deleteSnapshot(dbName(graphName, runSuffix));
}

export type { SqlDb } from './types';
