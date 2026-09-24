import initSqlJs from 'sql.js';
import { newCard, rate, Rating } from '../core/scheduler';
import graphJson from '../../data/graph.json';
import {
  loadAll,
  migrate,
  resetAll,
  saveReview,
  seedIfEmpty,
  setOffsetDays,
  type Graph,
} from './repo';
import { SqlJsDb } from './sqljs';

const t0 = new Date(Date.UTC(2026, 0, 1));
const graph: Graph = {
  seed: 'n1',
  nodes: [
    { id: 'n1', it: 'il cane', en: 'dog', pos: 'noun', theme: 'animals' },
    { id: 'n2', it: 'abbaiare', en: 'to bark', pos: 'verb', theme: null },
  ],
  edges: [{ source: 'n1', target: 'n2', weight: 0.8, reason: 'thematic' }],
};

async function freshDb() {
  const SQL = await initSqlJs();
  const db = new SqlJsDb(new SQL.Database());
  await migrate(db);
  return db;
}

test('seeds once and loads nodes, edges, and two cards per node', async () => {
  const db = await freshDb();
  expect(await seedIfEmpty(db, graph, t0)).toBe(true);
  expect(await seedIfEmpty(db, graph, t0)).toBe(false);
  const data = await loadAll(db);
  expect(data.nodes.map((n) => n.it)).toEqual(['il cane', 'abbaiare']);
  expect(data.edges).toEqual(graph.edges);
  expect(data.cards.map((c) => c.id)).toEqual(['n1:it-en', 'n1:en-it', 'n2:it-en', 'n2:en-it']);
  expect(data.states.get('n1')).toBe('frontier');
  expect(data.states.get('n2')).toBe('locked');
  expect(data.offsetDays).toBe(0);
});

test('reviews, state changes and offset persist; reset wipes them', async () => {
  const db = await freshDb();
  await seedIfEmpty(db, graph, t0);
  const card = rate(newCard(t0), Rating.Good, t0);
  await saveReview(db, 'n1:it-en', card, Rating.Good, t0, [
    { id: 'n1', state: 'conquered' },
    { id: 'n2', state: 'frontier' },
  ]);
  await setOffsetDays(db, 3);
  await setOffsetDays(db, 7);
  let data = await loadAll(db);
  expect(data.cards[0].card).toEqual(card);
  expect(data.states.get('n2')).toBe('frontier');
  expect(data.firstReview.get('n1')).toBe(t0.toISOString());
  expect(data.offsetDays).toBe(7);

  await resetAll(db, graph, t0);
  data = await loadAll(db);
  expect(data.states.get('n1')).toBe('frontier');
  expect(data.firstReview.size).toBe(0);
  expect(data.offsetDays).toBe(0);
});

test('the real graph.json seeds cleanly', async () => {
  const db = await freshDb();
  await seedIfEmpty(db, graphJson as Graph, t0);
  const data = await loadAll(db);
  expect(data.nodes.length).toBe(graphJson.nodes.length);
  expect(data.cards.length).toBe(graphJson.nodes.length * 2);
  expect([...data.states.values()].filter((s) => s === 'frontier')).toHaveLength(1);
});
