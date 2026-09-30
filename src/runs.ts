/**
 * Runs: several saved games per word list (e.g. a Geography campaign and a
 * Food one). Each run is its own database; this registry (localStorage) says
 * which runs exist, which is current, and a small summary for the list.
 * The first run is "main" and uses the database from before runs existed.
 */
export type Run = {
  id: string;
  name: string;
  created: number;
  /** Summary kept up to date while playing, for the run list. */
  conquered?: number;
  played?: number;
};
type Registry = Record<string, { current: string; runs: Run[] }>;

const KEY = 'sprawl.runs';
export const MAIN = 'main';

function load(): Registry {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Registry;
  } catch {
    return {};
  }
}
function save(r: Registry) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // private mode: runs just aren't remembered
  }
}
function entry(r: Registry, graph: string) {
  r[graph] ??= { current: MAIN, runs: [{ id: MAIN, name: 'First run', created: Date.now() }] };
  return r[graph];
}

export function listRuns(graph: string): { current: string; runs: Run[] } {
  const r = load();
  return entry(r, graph);
}

export const currentRun = (graph: string) => listRuns(graph).current;

/** Database name of a run (the main run keeps the pre-runs name). */
export const runDbSuffix = (run: string) => (run === MAIN ? '' : `~${run}`);

export function updateRun(graph: string, id: string, patch: Partial<Run>) {
  const r = load();
  const e = entry(r, graph);
  e.runs = e.runs.map((run) => (run.id === id ? { ...run, ...patch } : run));
  save(r);
}

/** Make a new, empty run current (its start picker shows on load). */
export function newRun(graph: string): string {
  const r = load();
  const e = entry(r, graph);
  const id = Date.now().toString(36);
  e.runs.push({ id, name: 'New run', created: Date.now() });
  e.current = id;
  save(r);
  return id;
}

export function switchRun(graph: string, id: string) {
  const r = load();
  const e = entry(r, graph);
  if (e.runs.some((run) => run.id === id)) e.current = id;
  save(r);
}

/** Forget a run (not the current one); true if it was forgotten, and its database may go. */
export function deleteRun(graph: string, id: string): boolean {
  const r = load();
  const e = entry(r, graph);
  if (id === e.current) return false;
  e.runs = e.runs.filter((run) => run.id !== id);
  save(r);
  return true;
}
