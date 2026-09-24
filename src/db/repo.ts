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
import type { NodeState, StateChange } from '../core/unlock';
import { SCHEMA } from './schema';
import type { SqlDb, SqlValue } from './types';

export type EdgeReason = 'semantic' | 'morphological' | 'thematic';
export type WordNode = {
  id: string;
  it: string;
  en: string;
  pos: string | null;
  theme: string | null;
};
export type Edge = { source: string; target: string; weight: number; reason: EdgeReason };
export type Graph = { seed: string; nodes: WordNode[]; edges: Edge[] };
export type CardRow = { id: string; nodeId: string; direction: Direction; card: Card };

export type AppData = {
  nodes: WordNode[];
  edges: Edge[];
  cards: CardRow[];
  states: Map<string, NodeState>;
  /** Node id -> ISO time of its first review (for the daily new-node limit). */
  firstReview: Map<string, string>;
  offsetDays: number;
};

async function insertMany(db: SqlDb, table: string, cols: string[], rows: SqlValue[][]) {
  const chunk = Math.floor(900 / cols.length); // stay under SQLite's variable limit
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const ph = part.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    await db.execute(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph}`, part.flat());
  }
}

export async function migrate(db: SqlDb) {
  for (const stmt of SCHEMA) await db.execute(stmt);
}

/** Seed from graph.json on first run. Returns true if it seeded. */
export async function seedIfEmpty(db: SqlDb, graph: Graph, now: Date): Promise<boolean> {
  const [{ n }] = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM nodes');
  if (n > 0) return false;
  await insertMany(
    db,
    'nodes',
    ['id', 'it', 'en', 'pos', 'theme', 'state'],
    graph.nodes.map((w) => [
      w.id,
      w.it,
      w.en,
      w.pos,
      w.theme,
      w.id === graph.seed ? 'frontier' : 'locked',
    ]),
  );
  await insertMany(
    db,
    'edges',
    ['source', 'target', 'weight', 'reason'],
    graph.edges.map((e) => [e.source, e.target, e.weight, e.reason]),
  );
  const empty = serializeCard(newCard(now));
  await insertMany(
    db,
    'cards',
    ['id', 'node_id', 'direction', 'fsrs_json'],
    graph.nodes.flatMap((w) => DIRECTIONS.map((d) => [cardId(w.id, d), w.id, d, empty])),
  );
  return true;
}

export async function loadAll(db: SqlDb): Promise<AppData> {
  const nodes = await db.select<WordNode & { state: NodeState; rowid: number }>(
    'SELECT rowid, id, it, en, pos, theme, state FROM nodes ORDER BY rowid',
  );
  const edges = await db.select<Edge>('SELECT source, target, weight, reason FROM edges');
  const cards = await db.select<{
    id: string;
    node_id: string;
    direction: Direction;
    fsrs_json: string;
  }>(
    `SELECT c.id, c.node_id, c.direction, c.fsrs_json FROM cards c
     JOIN nodes n ON n.id = c.node_id ORDER BY n.rowid, c.direction DESC`,
  );
  const first = await db.select<{ node_id: string; first: string }>(
    `SELECT c.node_id, MIN(r.reviewed_at) AS first FROM review_log r
     JOIN cards c ON c.id = r.card_id GROUP BY c.node_id`,
  );
  const meta = await db.select<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'debug_day_offset'",
  );
  return {
    nodes: nodes.map(({ id, it, en, pos, theme }) => ({ id, it, en, pos, theme })),
    edges,
    cards: cards.map((c) => ({
      id: c.id,
      nodeId: c.node_id,
      direction: c.direction,
      card: deserializeCard(c.fsrs_json),
    })),
    states: new Map(nodes.map((n) => [n.id, n.state])),
    firstReview: new Map(first.map((f) => [f.node_id, f.first])),
    offsetDays: meta.length ? Number(meta[0].value) : 0,
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

export async function setOffsetDays(db: SqlDb, days: number) {
  await db.execute(
    "INSERT INTO meta (key, value) VALUES ('debug_day_offset', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(days)],
  );
}

/** Wipe all progress and reseed from the graph. */
export async function resetAll(db: SqlDb, graph: Graph, now: Date) {
  for (const t of ['review_log', 'cards', 'edges', 'nodes', 'meta']) {
    await db.execute(`DELETE FROM ${t}`);
  }
  await seedIfEmpty(db, graph, now);
}
