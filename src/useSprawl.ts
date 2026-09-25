import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appNow } from './core/clock';
import { newCard, rate, Rating, type Grade } from './core/scheduler';
import { tierAllows, tierMap } from './core/tiers';
import { tenseCardId, type Tense, type TenseCard } from './core/verbs';
import { computeProgress, verbLevels } from './progress';
import { afterAnswer, neighbourWeights, simulate } from './core/influence';
import { CLAIM_EXPIRY_MS, CLAIM_GAPS, INFLUENCE } from './config';
import {
  applyChanges,
  neighbourMap,
  repairStates,
  slipChanges,
  unlockChanges,
  type StateChange,
} from './core/unlock';
import {
  claimComplete,
  claimNext,
  claimStartedAt,
  recordClaim,
  unseen,
  type Claim,
} from './core/claim';
import { openDb, type SqlDb } from './db';
import { currentGraphName, loadGraph } from './graphs';
import {
  loadAll,
  migrate,
  resetAll,
  saveReview,
  saveGame,
  saveRootUnlock,
  saveTenseReview,
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
export type ReviewOutcome = {
  levelUp: LevelUp | null;
  conquered: boolean;
  slipped: string[];
  /** Claim progress after a successful answer on a word not yet conquered. */
  claim?: Claim;
};
/** Words lost to hostile pressure in the latest simulation step. */
export type LostEvent = { at: number; ids: string[] };

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
  const weights = useMemo(() => neighbourWeights(data?.edges ?? []), [data?.edges]);
  const [lost, setLost] = useState<LostEvent | null>(null);

  // Tick when the next claim step opens, so it is offered without waiting for the minute clock.
  useEffect(() => {
    if (!data) return;
    const t = now.getTime();
    const opens = [...data.game.nodes]
      .filter(([id]) => data.states.get(id) === 'claimed')
      .map(([, g]) => claimNext(g.claim, CLAIM_GAPS)?.opensAt ?? Infinity)
      .filter((o) => o > t && o < Infinity);
    if (!opens.length) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(...opens) - t + 50);
    return () => clearTimeout(timer);
  }, [data, now]);

  // Advance the influence game whenever app time moves (clock tick, time travel).
  useEffect(() => {
    if (!db || !data || now.getTime() - data.game.simAt < 60_000) return;
    const levels = verbLevels(data.nodes, data.tenseCards, now);
    const next = simulate(data.game, data.states, weights, levels, now.getTime(), INFLUENCE);
    // Unfinished claims slip back after a day: finish what you start.
    const expired: StateChange[] = [];
    for (const [id, st] of data.states) {
      const g = next.game.nodes.get(id);
      if (st === 'claimed' && now.getTime() - claimStartedAt(g?.claim) > CLAIM_EXPIRY_MS) {
        expired.push({ id, state: 'frontier' });
        next.game.nodes.set(id, { control: 0, since: now.getTime() });
      }
    }
    const changes = [...next.lost, ...expired];
    void saveGame(db, next.game, changes);
    if (changes.length) setLost({ at: now.getTime(), ids: changes.map((l) => l.id) });
    setData((d) => d && { ...d, game: next.game, states: applyChanges(d.states, changes) });
  }, [db, data, now, weights]);

  const review = useCallback(
    /**
     * Rate a word card. Returns what happened for the UI: a newly opened tier,
     * a claim completed into a conquest, and words that slipped back to "?".
     */
    async (row: CardRow, grade: Grade): Promise<ReviewOutcome> => {
      const none: ReviewOutcome = { levelUp: null, conquered: false, slipped: [] };
      if (!db || !data) return none;
      const at = appNow(data.offsetDays);
      const t = at.getTime();
      const card = rate(row.card, grade, at);
      const stateBefore = data.states.get(row.nodeId);
      const success = grade !== Rating.Again;
      // First sight of a word (neither direction ever answered): not knowing it is
      // learning, so no hostility and no slips. Every later miss counts in the game.
      const firstSight = unseen(data.cards.filter((c) => c.nodeId === row.nodeId));
      const before = computeProgress(data.nodes, data.states, data.tenseCards, at).tier;

      let changes = unlockChanges(
        row.nodeId,
        grade,
        data.states,
        neighbours,
        tierAllows(tiers, before),
      );
      let game =
        firstSight && !success
          ? data.game
          : afterAnswer(data.game, row.nodeId, stateBefore, success, changes, t, INFLUENCE);

      // Claim bookkeeping: recognise, produce, then lock in after a break (core/claim.ts).
      let conquered = false;
      let claimed: Claim | undefined;
      if (success && (stateBefore === 'frontier' || stateBefore === 'claimed')) {
        const claim = recordClaim(
          data.game.nodes.get(row.nodeId)?.claim,
          row.direction,
          t,
          CLAIM_GAPS,
        );
        const nodes = new Map(game.nodes);
        if (stateBefore === 'claimed' && claimComplete(claim)) {
          changes = [...changes, { id: row.nodeId, state: 'conquered' }];
          nodes.set(row.nodeId, { control: 1 });
          conquered = true;
        } else {
          nodes.set(row.nodeId, { ...nodes.get(row.nodeId), control: 1, claim });
          claimed = claim;
        }
        game = { ...game, nodes };
      }

      // A real miss shakes loose the fragile claims around it.
      let slipped: string[] = [];
      if (!success && !firstSight) {
        const slips = slipChanges(row.nodeId, applyChanges(data.states, changes), neighbours);
        slipped = slips.map((c) => c.id);
        changes = [...changes, ...slips];
        const nodes = new Map(game.nodes);
        for (const id of slipped) nodes.set(id, { control: 0, since: t });
        game = { ...game, nodes };
      }

      const after = computeProgress(
        data.nodes,
        applyChanges(data.states, changes),
        data.tenseCards,
        at,
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
      await saveGame(db, game);
      setData((d) => {
        if (!d) return d;
        const firstReview = new Map(d.firstReview);
        if (!firstReview.has(row.nodeId)) firstReview.set(row.nodeId, at.toISOString());
        return {
          ...d,
          cards: d.cards.map((c) => (c.id === row.id ? { ...c, card } : c)),
          states: applyChanges(d.states, changes),
          firstReview,
          game,
        };
      });
      return { levelUp, conquered, slipped, claim: claimed };
    },
    [db, data, neighbours, tiers],
  );

  /**
   * Record a tense drill. A first success creates the tense card (the verb gains
   * a level); failing an unlearned tense records nothing. May open the next tier.
   */
  const reviewTense = useCallback(
    async (nodeId: string, tense: Tense, grade: Grade): Promise<LevelUp | null> => {
      if (!db || !data) return null;
      const at = appNow(data.offsetDays);
      const id = tenseCardId(nodeId, tense);
      const existing = data.tenseCards.find((c) => c.id === id);
      const hit = (changes: ReturnType<typeof repairStates>) =>
        afterAnswer(
          data.game,
          nodeId,
          data.states.get(nodeId),
          grade !== Rating.Again,
          changes,
          at.getTime(),
          INFLUENCE,
        );
      if (!existing && grade === Rating.Again) {
        const game = hit([]); // a failed drill still costs the verb control
        await saveGame(db, game);
        setData((d) => d && { ...d, game });
        return null;
      }
      const tc: TenseCard = {
        id,
        nodeId,
        tense,
        card: rate(existing?.card ?? newCard(at), grade, at),
      };
      const tenseCards = [...data.tenseCards.filter((c) => c.id !== id), tc];
      const before = computeProgress(data.nodes, data.states, data.tenseCards, at).tier;
      const after = computeProgress(data.nodes, data.states, tenseCards, at).tier;
      let changes: ReturnType<typeof repairStates> = [];
      let levelUp: LevelUp | null = null;
      if (after > before) {
        changes = repairStates(data.states, neighbours, data.graph.seed, tierAllows(tiers, after));
        levelUp = { tier: after, revealed: changes.length };
      }
      const game = hit(changes);
      await saveTenseReview(db, tc, grade, at, changes);
      await saveGame(db, game);
      setData((d) => d && { ...d, tenseCards, game, states: applyChanges(d.states, changes) });
      return levelUp;
    },
    [db, data, neighbours, tiers],
  );

  /** Unlock a root hub: its words all become frontier (a shortcut across the map). */
  const unlockRoot = useCallback(
    async (hubId: string): Promise<number> => {
      const hub = data?.graph.roots?.find((r) => r.id === hubId);
      if (!db || !data || !hub) return 0;
      const changes = hub.words
        .filter((w) => data.states.get(w) === 'locked')
        .map((id) => ({ id, state: 'frontier' as const }));
      const unlocked = new Set(data.unlockedRoots).add(hubId);
      const at = appNow(data.offsetDays).getTime();
      const nodes = new Map(data.game.nodes);
      for (const c of changes) nodes.set(c.id, { control: 0, since: at }); // grace starts now
      const game = { ...data.game, nodes };
      await saveRootUnlock(db, unlocked, changes);
      await saveGame(db, game);
      setData(
        (d) =>
          d && { ...d, game, unlockedRoots: unlocked, states: applyChanges(d.states, changes) },
      );
      return changes.length;
    },
    [db, data],
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

  return {
    data,
    now,
    error,
    lost,
    review,
    reviewTense,
    unlockRoot,
    timeTravel,
    reset,
    graphName,
  };
}
