import { LANGUAGES } from './core/language';
import type { Graph } from './db/repo';

// Every data/graph*.json is a selectable graph (graph_<name>.json, ?graph=<name>);
// each keeps its own progress. One per language learned: "oic" is the Italian
// vocabulary (the name its progress was saved under), the others are named by
// their language code (graph_es.json: Spanish).
const loaders = import.meta.glob<{ default: unknown }>('../data/graph*.json');

const nameOf = (path: string) => path.match(/graph_?([^/]*)\.json$/)?.[1] || 'default';

/** The language a graph teaches. */
export const languageOf = (name: string) => (name === 'oic' ? 'it' : LANGUAGES[name] ? name : 'it');

// Italian first: it is the default (no ?graph=), as it was before there were others.
export const GRAPH_NAMES = Object.keys(loaders)
  .map(nameOf)
  .sort((a, b) => Number(b === 'oic') - Number(a === 'oic') || a.localeCompare(b));

export const graphLabel = (name: string) => LANGUAGES[languageOf(name)]?.name ?? `${name} words`;

export function currentGraphName(): string {
  const name = new URLSearchParams(window.location.search).get('graph');
  return name && GRAPH_NAMES.includes(name) ? name : GRAPH_NAMES[0];
}

/** Open another word list (a reload: its language, database and runs are its own). */
export function switchGraph(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('graph', name);
  window.location.href = url.toString();
}

export async function loadGraph(name: string): Promise<Graph> {
  const path = Object.keys(loaders).find((p) => nameOf(p) === name);
  if (!path) throw new Error(`Unknown graph "${name}"`);
  return (await loaders[path]()).default as Graph;
}
