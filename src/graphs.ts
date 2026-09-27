import type { Graph } from './db/repo';

// Every data/graph*.json is a selectable graph (graph_<name>.json, ?graph=<name>);
// each keeps its own progress. Today there is one: the vocabulary ("oic", the
// name its progress was saved under).
const loaders = import.meta.glob<{ default: unknown }>('../data/graph*.json');

const nameOf = (path: string) => path.match(/graph_?([^/]*)\.json$/)?.[1] || 'default';

export const GRAPH_NAMES = Object.keys(loaders).map(nameOf).sort();

const LABELS: Record<string, string> = { oic: 'Italian vocabulary' };
export const graphLabel = (name: string) => LABELS[name] ?? `${name} words`;

export function currentGraphName(): string {
  const name = new URLSearchParams(window.location.search).get('graph');
  return name && GRAPH_NAMES.includes(name) ? name : GRAPH_NAMES[0];
}

export async function loadGraph(name: string): Promise<Graph> {
  const path = Object.keys(loaders).find((p) => nameOf(p) === name);
  if (!path) throw new Error(`Unknown graph "${name}"`);
  return (await loaders[path]()).default as Graph;
}
