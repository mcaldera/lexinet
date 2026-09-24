import initSqlJs from 'sql.js';
import { newCard, rate, Rating } from '../core/scheduler';
import graphJson from '../../data/graph.json';
import {
  loadAll,
  migrate,
  resetAll,
  saveReview,
  setOffsetDays,
  syncGraph,
  type Graph,
} from './repo';
import { SqlJsDb } from './sqljs';

const t0 = new Date(Date.UTC(2026, 0, 1));
const graph: Graph = {
  seed: 'il-cane',
  nodes: [
    { id: 'il-cane', it: 'il cane', en: 'dog', pos: 'noun', theme: 'animals' },
    { id: 'abbaiare', it: 'abbaiare', en: 'to bark', pos: 'verb', theme: null },
  ],
  edges: [{ source: 'il-cane', target: 'abbaiare', weight: 0.8, reason: 'thematic' }],
};

async function freshDb() {
  const SQL = await initSqlJs();
  const db = new SqlJsDb(new SQL.Database());
  await migrate(db);
  return db;
}

test('first sync seeds nodes, edges and two cards per node; resync is idempotent', async () => {
  const db = await freshDb();
  await syncGraph(db, graph, t0);
  await syncGraph(db, graph, t0);
  const data = await loadAll(db, graph);
  expect(data.nodes.map((n) => n.it)).toEqual(['il cane', 'abbaiare']);
  expect(data.cards.map((c) => c.id)).toEqual([
    'il-cane:it-en',
    'il-cane:en-it',
    'abbaiare:it-en',
    'abbaiare:en-it',
  ]);
  expect(data.states.get('il-cane')).toBe('frontier');
  expect(data.states.get('abbaiare')).toBe('locked');
  expect(data.offsetDays).toBe(0);
});

test('reviews, state changes and offset persist; reset wipes them', async () => {
  const db = await freshDb();
  await syncGraph(db, graph, t0);
  const card = rate(newCard(t0), Rating.Good, t0);
  await saveReview(db, 'il-cane:it-en', card, Rating.Good, t0, [
    { id: 'il-cane', state: 'conquered' },
    { id: 'abbaiare', state: 'frontier' },
  ]);
  await setOffsetDays(db, 3);
  await setOffsetDays(db, 7);
  let data = await loadAll(db, graph);
  expect(data.cards[0].card).toEqual(card);
  expect(data.states.get('abbaiare')).toBe('frontier');
  expect(data.firstReview.get('il-cane')).toBe(t0.toISOString());
  expect(data.offsetDays).toBe(7);

  await resetAll(db, graph, t0);
  data = await loadAll(db, graph);
  expect(data.states.get('il-cane')).toBe('frontier');
  expect(data.firstReview.size).toBe(0);
  expect(data.offsetDays).toBe(0);
});

test('adding a word next to a conquered one keeps progress and opens it as frontier', async () => {
  const db = await freshDb();
  await syncGraph(db, graph, t0);
  await saveReview(db, 'il-cane:it-en', rate(newCard(t0), Rating.Good, t0), Rating.Good, t0, [
    { id: 'il-cane', state: 'conquered' },
    { id: 'abbaiare', state: 'frontier' },
  ]);
  const grown: Graph = {
    ...graph,
    nodes: [
      ...graph.nodes,
      { id: 'il-gatto', it: 'il gatto', en: 'cat', pos: 'noun', theme: 'animals' },
    ],
    edges: [
      ...graph.edges,
      { source: 'il-cane', target: 'il-gatto', weight: 0.5, reason: 'thematic' },
    ],
  };
  await syncGraph(db, grown, t0);
  const data = await loadAll(db, grown);
  expect(data.states.get('il-cane')).toBe('conquered');
  expect(data.states.get('il-gatto')).toBe('frontier');
  expect(data.cards).toHaveLength(6);
});

test('the real graph.json syncs cleanly', async () => {
  const db = await freshDb();
  const g = graphJson as unknown as Graph;
  await syncGraph(db, g, t0);
  const data = await loadAll(db, g);
  expect(data.cards.length).toBe(g.nodes.length * 2);
  expect([...data.states.values()].filter((s) => s === 'frontier')).toEqual(['frontier']);
});
