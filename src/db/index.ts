import type { SqlDb } from './types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** One database per graph, so experimenting with another graph keeps your progress. */
export async function openDb(graphName = 'default'): Promise<SqlDb> {
  const suffix = graphName === 'default' ? '' : `-${graphName}`;
  if (isTauri()) return (await import('./tauri')).openTauriDb(`sprawl${suffix}.db`);
  return (await import('./sqljs')).openBrowserDb(`sprawl${suffix}.db`);
}

export type { SqlDb } from './types';
