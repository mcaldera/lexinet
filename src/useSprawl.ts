import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appNow } from './core/clock';
import { newCard, rate, Rating, State, type Grade } from './core/scheduler';
import { tierAllows, tierMap } from './core/tiers';
import { tenseCardId, type Tense, type TenseCard } from './core/verbs';
import { computeProgress, computeReach, verbLevels } from './progress';
import { afterAnswer, isHostile, neighbourWeights, simulate, type Game } from './core/influence';
import {
  CLAIM_EXPIRY_MS,
  CLAIM_GAPS,
  DANGER_MS,
  INFLUENCE,
  REACH,
  RECLAIM_MS,
  SEEDS_PER_CONQUEST,
} from './config';
import type { Achievement } from './core/achievements';
import type { PlantOption } from './core/plant';
import { recedeChanges, revealChanges } from './core/reach';
import { dangerFalls, missed, rescue } from './core/danger';
import { reclaim, reclaimable, recordFalls, type Fallen } from './core/fallen';
import {
  applyChanges,
  neighbourMap,
  unlockChanges,
  type NodeState,
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
  saveCard,
  saveMeta,
  saveReview,
  saveGame,
  saveRootUnlock,
  saveTenseReview,
  setOffsetDays,
  syncGraph,
  type AppData,
  type CardRow,
  type Edge,
  type Graph,
} from './db/repo';

const graphName = currentGraphName();
const claimsOf = (game: Game) => new Map([...game.nodes].map(([id, g]) => [id, g.claim]));

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
  /** Claimed neighbours put in danger by a miss (they fall unless it is won back). */
  endangered: string[];
  /** Claim progress after a successful answer on a word not yet conquered. */
  claim?: Claim;
  /** Hidden words the answer's push made conquerable. */
  opened?: number;
  /** A lost word won back with one answer, and what it was restored to. */
  reclaimed?: Fallen;
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

  // Tick when the next claim step opens or a danger deadline passes, without waiting for the minute clock.
  useEffect(() => {
    if (!data) return;
    const t = now.getTime();
    const opens = [...data.game.nodes]
      .filter(([id]) => data.states.get(id) === 'claimed')
      .flatMap(([, g]) => [
        claimNext(g.claim, CLAIM_GAPS)?.opensAt ?? Infinity,
        g.danger?.until ?? Infinity,
      ])
      .filter((o) => o > t && o < Infinity);
    if (!opens.length) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(...opens) - t + 50);
    return () => clearTimeout(timer);
  }, [data, now]);

  /**
   * Move the horizon (core/reach.ts): hidden words the territory now reaches
   * become "?" (their grace period starts now), and untried "?" that lost their
   * reach go back to ghosts.
   */
  const horizon = useCallback(
    (states: Map<string, NodeState>, game: Game, tier: number, t: number) => {
      if (!data) return { changes: [] as StateChange[], game, opened: 0 };
      const claims = new Map([...game.nodes].map(([id, g]) => [id, g.claim]));
      const levels = verbLevels(data.nodes, data.tenseCards, appNow(data.offsetDays));
      const reach = computeReach(data.nodes, neighbours, states, claims, data.graph.seed, levels);
      const opened = revealChanges(states, reach, REACH, tierAllows(tiers, tier));
      const rootWords = new Set(
        (data.graph.roots ?? [])
          .filter((r) => data.unlockedRoots.has(r.id))
          .flatMap((r) => r.words),
      );
      const started = new Set(
        data.cards.filter((c) => c.card.state !== State.New).map((c) => c.nodeId),
      );
      const receded = recedeChanges(
        states,
        reach,
        REACH,
        (id) =>
          id === data.graph.seed ||
          started.has(id) ||
          rootWords.has(id) ||
          isHostile(game.nodes.get(id), 'frontier', t, INFLUENCE),
      );
      const changes = [...opened, ...receded];
      if (!changes.length) return { changes, game, opened: 0 };
      const nodes = new Map(game.nodes);
      for (const c of opened) nodes.set(c.id, { control: 0, since: t });
      for (const c of receded) nodes.delete(c.id); // grace restarts if it comes back
      return { changes, game: { ...game, nodes }, opened: opened.length };
    },
    [data, neighbours, tiers],
  );

  // Advance the influence game whenever app time moves (clock tick, time travel).
  useEffect(() => {
    if (!db || !data) return;
    const t = now.getTime();
    const dangerDue = [...data.game.nodes.values()].some((g) => g.danger && g.danger.until <= t);
    if (t - data.game.simAt < 60_000 && !dangerDue) return;
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
    // Words left in danger by a miss fall once their deadline passes.
    const falls = dangerFalls(
      next.game,
      applyChanges(data.states, [...next.lost, ...expired]),
      t,
      INFLUENCE.hostileAfterHours * 3_600_000,
    );
    const fallen = [...next.lost, ...expired, ...falls.changes];
    // Lost words remember what they were: one right answer wins them back for a while.
    const remembered = recordFalls(falls.game, data.states, claimsOf(data.game), fallen, t);
    const states = applyChanges(data.states, fallen);
    const tier = computeProgress(data.nodes, states, data.tenseCards, now).tier;
    const moved = fallen.length ? horizon(states, remembered, tier, t) : null;
    const game = moved?.game ?? remembered;
    const changes = [...fallen, ...(moved?.changes ?? [])];
    void saveGame(db, game, changes);
    if (fallen.length) setLost({ at: t, ids: fallen.map((l) => l.id) });
    setData((d) => d && { ...d, game, states: applyChanges(d.states, changes) });
  }, [db, data, now, weights, horizon]);

  const review = useCallback(
    /**
     * Rate a word card. Returns what happened for the UI: a newly opened tier,
     * a claim completed into a conquest, and words a miss put in danger.
     */
    async (row: CardRow, grade: Grade): Promise<ReviewOutcome> => {
      const none: ReviewOutcome = { levelUp: null, conquered: false, endangered: [] };
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

      // A word you had won and lost: one right answer brings its old status back.
      const wasWon = reclaimable(data.game, data.states, row.nodeId, t, RECLAIM_MS);
      let changes = unlockChanges(row.nodeId, grade, data.states);
      let game =
        firstSight && !success
          ? data.game
          : afterAnswer(data.game, row.nodeId, stateBefore, success, changes, t, INFLUENCE);

      // Claim bookkeeping: recognise, produce, then lock in after a break (core/claim.ts).
      let conquered = false;
      let claimed: Claim | undefined;
      if (success && wasWon) {
        const back = reclaim(game, row.nodeId, wasWon, t);
        changes = [back.change];
        game = back.game;
        conquered = wasWon.was === 'conquered';
        claimed = back.claim;
      } else if (success && (stateBefore === 'frontier' || stateBefore === 'claimed')) {
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

      // A real miss: the word falls and turns hostile, and puts the fragile
      // claims around it in danger (core/danger.ts). A win lifts its dangers.
      let endangered: string[] = [];
      if (!success && !firstSight) {
        const miss = missed(
          game,
          row.nodeId,
          applyChanges(data.states, changes),
          neighbours,
          t,
          DANGER_MS,
          INFLUENCE.hostileAfterHours * 3_600_000,
        );
        changes = [...changes, ...miss.changes];
        game = recordFalls(miss.game, data.states, claimsOf(data.game), miss.changes, t);
        endangered = miss.endangered;
      }
      if (success) game = rescue(game, row.nodeId);

      const statesAfter = applyChanges(data.states, changes);
      const after = computeProgress(data.nodes, statesAfter, data.tenseCards, at).tier;
      // What the new territory pushes into reach (and, on a level up, the new tier).
      const revealed = horizon(statesAfter, game, after, t);
      changes = [...changes, ...revealed.changes];
      game = revealed.game;
      const levelUp: LevelUp | null =
        after > before ? { tier: after, revealed: revealed.opened } : null;
      // Conquest locks in both directions: the other card (right in step 1 or 2,
      // still in FSRS learning) graduates too, so the word isn't asked again at once.
      const other = conquered
        ? data.cards.find(
            (c) => c.nodeId === row.nodeId && c.id !== row.id && c.card.state !== State.Review,
          )
        : undefined;
      const graduated = other && { ...other, card: rate(other.card, Rating.Good, at) };
      await saveReview(db, row.id, card, grade, at, changes);
      if (graduated) await saveCard(db, graduated.id, graduated.card);
      await saveGame(db, game);
      // Every real conquest (not a win-back) earns a seed for planting.
      const seeds = data.seeds + (conquered && !wasWon ? SEEDS_PER_CONQUEST : 0);
      if (seeds !== data.seeds) await saveMeta(db, 'seeds', seeds);
      setData((d) => {
        if (!d) return d;
        const firstReview = new Map(d.firstReview);
        if (!firstReview.has(row.nodeId)) firstReview.set(row.nodeId, at.toISOString());
        return {
          ...d,
          cards: d.cards.map((c) =>
            c.id === row.id ? { ...c, card } : c.id === graduated?.id ? graduated : c,
          ),
          states: applyChanges(d.states, changes),
          firstReview,
          game,
          seeds,
        };
      });
      return {
        levelUp,
        conquered,
        endangered,
        claim: claimed,
        opened: revealed.opened,
        reclaimed: success && wasWon ? wasWon : undefined,
      };
    },
    [db, data, neighbours, horizon],
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
      const hit = (changes: StateChange[]) =>
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
      let changes: StateChange[] = [];
      let levelUp: LevelUp | null = null;
      let game = hit([]);
      if (after > before) {
        const revealed = horizon(data.states, game, after, at.getTime());
        changes = revealed.changes;
        game = revealed.game;
        levelUp = { tier: after, revealed: changes.length };
      }
      await saveTenseReview(db, tc, grade, at, changes);
      await saveGame(db, game);
      setData((d) => d && { ...d, tenseCards, game, states: applyChanges(d.states, changes) });
      return levelUp;
    },
    [db, data, horizon],
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

  /** Record newly earned achievements and pay out their seeds. */
  const earnAchievements = useCallback(
    async (earned: Achievement[]) => {
      if (!db || !data || !earned.length) return;
      const at = appNow(data.offsetDays).getTime();
      const achievements = { ...data.achievements };
      for (const a of earned) achievements[a.id] = at;
      const seeds = data.seeds + earned.reduce((n, a) => n + a.seeds, 0);
      await saveMeta(db, 'achievements', achievements);
      await saveMeta(db, 'seeds', seeds);
      setData((d) => d && { ...d, achievements, seeds });
    },
    [db, data],
  );

  /**
   * Plant `option` next to the conquered word `anchor` (core/plant.ts): it
   * becomes a "?" there, joined by your link, for the option's cost in seeds.
   */
  const plant = useCallback(
    async (anchor: string, option: PlantOption): Promise<boolean> => {
      if (!db || !data || data.seeds < option.cost) return false;
      const t = appNow(data.offsetDays).getTime();
      const edge: Edge = {
        source: anchor,
        target: option.id,
        weight: option.weight,
        reason: option.reason,
        via: 'user',
      };
      const userEdges = option.linked ? data.userEdges : [...data.userEdges, edge];
      const changes: StateChange[] =
        data.states.get(option.id) === 'locked' ? [{ id: option.id, state: 'frontier' }] : [];
      const nodes = new Map(data.game.nodes);
      for (const c of changes) nodes.set(c.id, { control: 0, since: t }); // grace starts now
      const game = { ...data.game, nodes };
      const seeds = data.seeds - option.cost;
      await saveMeta(db, 'user_edges', userEdges);
      await saveMeta(db, 'seeds', seeds);
      await saveGame(db, game, changes);
      setData(
        (d) =>
          d && {
            ...d,
            userEdges,
            edges: option.linked ? d.edges : [...d.edges, edge],
            seeds,
            game,
            states: applyChanges(d.states, changes),
          },
      );
      return true;
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
    earnAchievements,
    plant,
    timeTravel,
    reset,
    graphName,
  };
}
