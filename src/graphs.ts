import type { Graph } from './db/repo';

// Every data/graph*.json is a selectable graph: graph.json is "default",
// graph_1000.json is "1000" (open with ?graph=1000). Each keeps its own progress.
const loaders = import.meta.glob<{ default: unknown }>('../data/graph*.json');

const nameOf = (path: string) => path.match(/graph_?([^/]*)\.json$/)?.[1] || 'default';

export const GRAPH_NAMES = Object.keys(loaders).map(nameOf).sort();

const LABELS: Record<string, string> = {
  default: 'My words',
  oic: 'Italian vocabulary',
  '1000': '1000 frequent words',
};
export const graphLabel = (name: string) => LABELS[name] ?? `${name} words`;

export function currentGraphName(): string {
  const name = new URLSearchParams(window.location.search).get('graph') ?? 'default';
  return GRAPH_NAMES.includes(name) ? name : 'default';
}

export async function loadGraph(name: string): Promise<Graph> {
  const path = Object.keys(loaders).find((p) => nameOf(p) === name);
  if (!path) throw new Error(`Unknown graph "${name}"`);
  return (await loaders[path]()).default as Graph;
}
