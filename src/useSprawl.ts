import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import graphJson from '../data/graph.json';
import { appNow } from './core/clock';
import { rate, type Grade } from './core/scheduler';
import { applyChanges, neighbourMap, unlockChanges } from './core/unlock';
import { openDb, type SqlDb } from './db';
import {
  loadAll,
  migrate,
  resetAll,
  saveReview,
  setOffsetDays,
  syncGraph,
  type AppData,
  type CardRow,
  type Graph,
} from './db/repo';

const graph = graphJson as unknown as Graph;

// Module-level so StrictMode's double effect doesn't open/seed twice.
let dbPromise: Promise<SqlDb> | null = null;
function getDb(): Promise<SqlDb> {
  dbPromise ??= (async () => {
    const db = await openDb();
    await migrate(db);
    await syncGraph(db, graph, appNow(0));
    return db;
  })();
  return dbPromise;
}

export function useSprawl() {
  const [db, setDb] = useState<SqlDb | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Latest offset, updated synchronously so rapid time-travel clicks accumulate.
  const offsetRef = useRef(0);

  useEffect(() => {
    getDb()
      .then(async (db) => {
        setDb(db);
        const loaded = await loadAll(db, graph);
        offsetRef.current = loaded.offsetDays;
        setData(loaded);
      })
      .catch((e) => setError(String(e)));
    // Refresh the clock so health keeps decaying while the app is open.
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const offsetDays = data?.offsetDays ?? 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => appNow(offsetDays), [offsetDays, tick, data]);
  const neighbours = useMemo(() => neighbourMap(data?.edges ?? []), [data?.edges]);

  const review = useCallback(
    async (row: CardRow, grade: Grade) => {
      if (!db || !data) return;
      const at = appNow(data.offsetDays);
      const card = rate(row.card, grade, at);
      const changes = unlockChanges(row.nodeId, grade, data.states, neighbours);
      await saveReview(db, row.id, card, grade, at, changes);
      setData((d) => {
        if (!d) return d;
        const firstReview = new Map(d.firstReview);
        if (!firstReview.has(row.nodeId)) firstReview.set(row.nodeId, at.toISOString());
        return {
          ...d,
          cards: d.cards.map((c) => (c.id === row.id ? { ...c, card } : c)),
          states: applyChanges(d.states, changes),
          firstReview,
        };
      });
    },
    [db, data, neighbours],
  );

  const timeTravel = useCallback(
    async (days: number) => {
      if (!db) return;
      const next = days === 0 ? 0 : offsetRef.current + days;
      offsetRef.current = next;
      await setOffsetDays(db, next);
      setData((d) => d && { ...d, offsetDays: next });
    },
    [db],
  );

  const reset = useCallback(async () => {
    if (!db) return;
    await resetAll(db, graph, appNow(0));
    offsetRef.current = 0;
    setData(await loadAll(db, graph));
  }, [db]);

  return { data, now, error, review, timeTravel, reset };
}
