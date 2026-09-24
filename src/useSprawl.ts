import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appNow } from './core/clock';
import { rate, type Grade } from './core/scheduler';
import { tierAllows, tierMap, tierProgress } from './core/tiers';
import { applyChanges, neighbourMap, repairStates, unlockChanges } from './core/unlock';
import { TIER_UNLOCK_FRACTION } from './config';
import { openDb, type SqlDb } from './db';
import { currentGraphName, loadGraph } from './graphs';
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

const graphName = currentGraphName();

// Module-level so StrictMode's double effect doesn't open/seed twice.
let dbPromise: Promise<{ db: SqlDb; graph: Graph }> | null = null;
function getDb() {
  dbPromise ??= (async () => {
    const graph = await loadGraph(graphName);
    const db = await openDb(graphName);
    await migrate(db);
    await syncGraph(db, graph, appNow(0));
    return { db, graph };
  })();
  return dbPromise;
}

export type LevelUp = { tier: number; revealed: number };

export function useSprawl() {
  const [db, setDb] = useState<SqlDb | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Latest offset, updated synchronously so rapid time-travel clicks accumulate.
  const offsetRef = useRef(0);

  useEffect(() => {
    getDb()
      .then(async ({ db, graph }) => {
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
  const tiers = useMemo(() => tierMap(data?.nodes ?? []), [data?.nodes]);

  const review = useCallback(
    /** Returns the newly opened tier and how many words it revealed, if any. */
    async (row: CardRow, grade: Grade): Promise<LevelUp | null> => {
      if (!db || !data) return null;
      const at = appNow(data.offsetDays);
      const card = rate(row.card, grade, at);
      const before = tierProgress(tiers, data.states, TIER_UNLOCK_FRACTION).tier;
      let changes = unlockChanges(
        row.nodeId,
        grade,
        data.states,
        neighbours,
        tierAllows(tiers, before),
      );
      const after = tierProgress(
        tiers,
        applyChanges(data.states, changes),
        TIER_UNLOCK_FRACTION,
      ).tier;
      let levelUp: LevelUp | null = null;
      if (after > before) {
        const revealed = repairStates(
          applyChanges(data.states, changes),
          neighbours,
          data.graph.seed,
          tierAllows(tiers, after),
        );
        changes = [...changes, ...revealed];
        levelUp = { tier: after, revealed: revealed.length };
      }
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
      return levelUp;
    },
    [db, data, neighbours, tiers],
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
    if (!db || !data) return;
    await resetAll(db, data.graph, appNow(0));
    offsetRef.current = 0;
    setData(await loadAll(db, data.graph));
  }, [db, data]);

  return { data, now, error, review, timeTravel, reset, graphName };
}
