import {
  cardId,
  deserializeCard,
  DIRECTIONS,
  newCard,
  serializeCard,
  type Card,
  type Direction,
  type Grade,
} from '../core/scheduler';
import { tierAllows, tierMap, tierProgress } from '../core/tiers';
import { neighbourMap, repairStates, type NodeState, type StateChange } from '../core/unlock';
import { TIER_UNLOCK_FRACTION } from '../config';
import { SCHEMA } from './schema';
import type { SqlDb, SqlValue } from './types';

export type EdgeReason = 'semantic' | 'morphological' | 'etymological' | 'thematic';
export type Components = Record<EdgeReason, number>;
export type WordNode = {
  id: string;
  it: string;
  en: string;
  pos: string | null;
  theme: string | null;
  root?: string | null;
  root_lang?: string | null;
  root_meaning?: string | null;
  cognate?: string | null;
  /** How the cognate connects, e.g. "com- 'with' + panis 'bread'". */
  cognate_note?: string | null;
  /** 1 = most common words; higher tiers open as you progress. */
  tier?: number;
  /** Fixed map position and territory from the pipeline layout. */
  x?: number;
  y?: number;
  region?: number;
};
/** A territory on the map: a community of closely linked words. */
export type Region = { id: number; name: string; color: number; words: string[] };
export type Edge = {
  source: string;
  target: string;
  weight: number;
  reason: EdgeReason;
  components?: Components;
  /** tree: needed to keep the graph connected; bonus: one of a word's top partners. */
  via?: 'tree' | 'bonus';
};
/** A root shared by 2+ words, drawn as a hub node linked to its descendants. */
export type RootHub = {
  id: string;
  root: string;
  lang: string | null;
  meaning: string | null;
  words: string[];
  /** Common English words from the same root, e.g. cook, kitchen. */
  english?: string[];
};
export type Candidate = {
  id: string;
  weight: number;
  rank: number;
  components: Components;
  linked: boolean;
};
export type Graph = {
  seed: string;
  params?: {
    model: string | null;
    weights: Components;
    bonus_k: number;
    bonus_threshold: number;
    tiers?: number;
  };
  nodes: WordNode[];
  edges: Edge[];
  roots?: RootHub[];
  regions?: Region[];
  candidates?: Record<string, Candidate[]>;
};
export type CardRow = { id: string; nodeId: string; direction: Direction; card: Card };

export type AppData = {
  graph: Graph;
  nodes: WordNode[];
  edges: Edge[];
  cards: CardRow[];
  states: Map<string, NodeState>;
  /** Node id -> ISO time of its first review (for the daily new-node counter). */
  firstReview: Map<string, string>;
  offsetDays: number;
  /** Root hubs the player has unlocked by naming their meaning. */
  unlockedRoots: Set<string>;
};

async function insertMany(
  db: SqlDb,
  table: string,
  cols: string[],
  rows: SqlValue[][],
  conflict = '',
) {
  const chunk = Math.floor(900 / cols.length); // stay under SQLite's variable limit
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const ph = part.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    await db.execute(
      `INSERT ${conflict} INTO ${table} (${cols.join(',')}) VALUES ${ph}`,
      part.flat(),
    );
  }
}

export async function migrate(db: SqlDb) {
  for (const stmt of SCHEMA) await db.execute(stmt);
}

/**
 * Bring the DB in line with graph.json, keeping progress. graph.json owns words
 * and edges; the DB owns node states, cards and the review log. New words start
 * locked (or frontier if next to a conquered word); removed words are ignored.
 */
export async function syncGraph(db: SqlDb, graph: Graph, now: Date) {
  await insertMany(
    db,
    'nodes',
    ['id', 'it', 'en', 'pos', 'theme', 'state'],
    graph.nodes.map((w) => [w.id, w.it, w.en, w.pos, w.theme, 'locked']),
    'OR IGNORE',
  );
  const empty = serializeCard(newCard(now));
  await insertMany(
    db,
    'cards',
    ['id', 'node_id', 'direction', 'fsrs_json'],
    graph.nodes.flatMap((w) => DIRECTIONS.map((d) => [cardId(w.id, d), w.id, d, empty])),
    'OR IGNORE',
  );
  // Kept in the DB only so it can be inspected with sqlite tools.
  await db.execute('DELETE FROM edges');
  await insertMany(
    db,
    'edges',
    ['source', 'target', 'weight', 'reason'],
    graph.edges.map((e) => [e.source, e.target, e.weight, e.reason]),
  );

  const ids = new Set(graph.nodes.map((n) => n.id));
  const rows = await db.select<{ id: string; state: NodeState }>('SELECT id, state FROM nodes');
  const states = new Map(rows.filter((r) => ids.has(r.id)).map((r) => [r.id, r.state]));
  const tiers = tierMap(graph.nodes);
  const open = tierProgress(tiers, states, TIER_UNLOCK_FRACTION).tier;
  const allowed = tierAllows(tiers, open);
  for (const c of repairStates(states, neighbourMap(graph.edges), graph.seed, allowed)) {
    await db.execute('UPDATE nodes SET state = ? WHERE id = ?', [c.state, c.id]);
  }
}

export async function loadAll(db: SqlDb, graph: Graph): Promise<AppData> {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const nodeRows = await db.select<{ id: string; state: NodeState }>('SELECT id, state FROM nodes');
  const cards = (
    await db.select<{ id: string; node_id: string; direction: Direction; fsrs_json: string }>(
      'SELECT id, node_id, direction, fsrs_json FROM cards',
    )
  )
    .filter((c) => ids.has(c.node_id))
    .sort(
      (a, b) =>
        order.get(a.node_id)! - order.get(b.node_id)! ||
        DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction),
    );
  const first = await db.select<{ node_id: string; first: string }>(
    `SELECT c.node_id, MIN(r.reviewed_at) AS first FROM review_log r
     JOIN cards c ON c.id = r.card_id GROUP BY c.node_id`,
  );
  const meta = await db.select<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'debug_day_offset'",
  );
  const roots = await db.select<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'unlocked_roots'",
  );
  return {
    graph,
    nodes: graph.nodes,
    edges: graph.edges,
    cards: cards.map((c) => ({
      id: c.id,
      nodeId: c.node_id,
      direction: c.direction,
      card: deserializeCard(c.fsrs_json),
    })),
    states: new Map(nodeRows.filter((n) => ids.has(n.id)).map((n) => [n.id, n.state])),
    firstReview: new Map(first.map((f) => [f.node_id, f.first])),
    offsetDays: meta.length ? Number(meta[0].value) : 0,
    unlockedRoots: new Set(roots.length ? (JSON.parse(roots[0].value) as string[]) : []),
  };
}

export async function saveReview(
  db: SqlDb,
  id: string,
  card: Card,
  grade: Grade,
  reviewedAt: Date,
  changes: StateChange[],
) {
  await db.execute('UPDATE cards SET fsrs_json = ? WHERE id = ?', [serializeCard(card), id]);
  await db.execute('INSERT INTO review_log (card_id, rating, reviewed_at) VALUES (?, ?, ?)', [
    id,
    grade,
    reviewedAt.toISOString(),
  ]);
  for (const c of changes) {
    await db.execute('UPDATE nodes SET state = ? WHERE id = ?', [c.state, c.id]);
  }
}

/** Mark a root as unlocked and reveal its words (state changes computed by the caller). */
export async function saveRootUnlock(db: SqlDb, unlocked: Set<string>, changes: StateChange[]) {
  await db.execute(
    "INSERT INTO meta (key, value) VALUES ('unlocked_roots', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [JSON.stringify([...unlocked])],
  );
  for (const c of changes) {
    await db.execute('UPDATE nodes SET state = ? WHERE id = ?', [c.state, c.id]);
  }
}

export async function setOffsetDays(db: SqlDb, days: number) {
  await db.execute(
    "INSERT INTO meta (key, value) VALUES ('debug_day_offset', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(days)],
  );
}

/** Wipe all progress and start again from the graph's seed. */
export async function resetAll(db: SqlDb, graph: Graph, now: Date) {
  for (const t of ['review_log', 'cards', 'edges', 'nodes', 'meta']) {
    await db.execute(`DELETE FROM ${t}`);
  }
  await syncGraph(db, graph, now);
}
