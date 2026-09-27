import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appNow } from './core/clock';
import { newCard, rate, Rating, State, type Card, type Grade } from './core/scheduler';
import { nodeStrength } from './core/strength';
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
  COINS_PER_CONQUEST,
  EXPEDITION,
  HINT_COST,
  LANDMARK,
  RAID,
  ROOTS,
} from './config';
import { landmarks, landmarkWords } from './core/landmark';
import { expeditionStatus, planExpedition } from './core/expedition';
import { defend, raidStarts, raidStatus, raidTargets } from './core/raid';
import { dayKey } from './core/streak';
import type { Achievement } from './core/achievements';
import type { PlantOption } from './core/plant';
import { recedeChanges, revealChanges } from './core/reach';
import { rootOpenings } from './core/roots';
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
import { currentRun, runDbSuffix } from './runs';
import { currentGraphName, loadGraph } from './graphs';
import {
  loadAll,
  migrate,
  resetAll,
  saveCard,
  saveMeta,
  saveReview,
  saveGame,
  saveTenseReview,
  setOffsetDays,
  syncGraph,
  type AppData,
  type CardRow,
  type Edge,
  type Graph,
  type RaidState,
} from './db/repo';

const graphName = currentGraphName();
const runId = currentRun(graphName);
const claimsOf = (game: Game) => new Map([...game.nodes].map(([id, g]) => [id, g.claim]));

// Module-level so StrictMode's double effect doesn't open/seed twice.
let dbPromise: Promise<{ db: SqlDb; graph: Graph }> | null = null;
function getDb() {
  dbPromise ??= (async () => {
    const graph = await loadGraph(graphName);
    const db = await openDb(graphName, runDbSuffix(runId));
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
  /** Root hubs that opened (core/roots.ts): their names and the words they revealed. */
  roots?: { names: string[]; revealed: number };
};
/** Words lost to hostile pressure in the latest simulation step. */
export type LostEvent = { at: number; ids: string[] };
/** Something the game did on its own, for a banner (raids, expeditions, landmarks). */
export type GameEvent =
  | { kind: 'raid'; at: number; count: number }
  | { kind: 'raid-won' | 'expedition-won'; at: number; coins: number }
  | { kind: 'raid-lost'; at: number; count: number }
  | { kind: 'expedition-lost'; at: number }
  | { kind: 'landmark'; at: number; regions: number[]; coins: number };

/** Answers per day, one more for `at`'s day. */
const counted = (activity: Map<string, number>, at: Date) =>
  new Map(activity).set(dayKey(at), (activity.get(dayKey(at)) ?? 0) + 1);

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
  const home = data?.home;
  const weights = useMemo(() => neighbourWeights(data?.edges ?? []), [data?.edges]);
  const [lost, setLost] = useState<LostEvent | null>(null);
  const [event, setEvent] = useState<GameEvent | null>(null);
  /** Memory strength per word (0-5, core/strength.ts): armour against hostile pressure. */
  const armour = useMemo(() => {
    const byNode = new Map<string, Card[]>();
    for (const c of data?.cards ?? [])
      byNode.set(c.nodeId, [...(byNode.get(c.nodeId) ?? []), c.card]);
    return new Map([...byNode].map(([id, cards]) => [id, nodeStrength(cards).level]));
  }, [data?.cards]);
  /** Words shielded from hostile pressure: bought hints and standing landmarks' categories. */
  const shielded = useMemo(() => {
    if (!data) return new Set<string>();
    const regions = data.graph.regions ?? [];
    return new Set([
      ...data.hints,
      ...landmarkWords(regions, landmarks(regions, data.states, LANDMARK)),
    ]);
  }, [data]);

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
      .concat([data.raid.active?.until ?? Infinity, data.expedition?.until ?? Infinity])
      .filter((o) => o > t && o < Infinity);
    if (!opens.length) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(...opens) - t + 50);
    return () => clearTimeout(timer);
  }, [data, now]);

  /**
   * Move the horizon (core/reach.ts): hidden words the territory now reaches
   * become "?" (their grace period starts now), and untried "?" that lost their
   * reach go back to ghosts. Root hubs with enough of their words in reach open
   * (core/roots.ts) and reveal all their words, at any level.
   */
  const horizon = useCallback(
    (
      states: Map<string, NodeState>,
      game: Game,
      tier: number,
      t: number,
    ): {
      changes: StateChange[];
      game: Game;
      opened: number;
      /** The new set of open roots, when some opened. */
      unlocked?: Set<string>;
      roots?: { names: string[]; revealed: number };
    } => {
      if (!data) return { changes: [], game, opened: 0 };
      const claims = new Map([...game.nodes].map(([id, g]) => [id, g.claim]));
      const levels = verbLevels(data.nodes, data.tenseCards, appNow(data.offsetDays));
      const reach = computeReach(data.nodes, neighbours, states, claims, data.seed, levels);
      const revealed = revealChanges(states, reach, REACH, tierAllows(tiers, tier, home));
      // A root shows on the map once one of its words is conquered; only then can it open.
      const hubs = rootOpenings(
        (data.graph.roots ?? []).filter((r) => r.words.some((w) => states.get(w) === 'conquered')),
        reach,
        data.unlockedRoots,
        ROOTS.open,
      );
      const unlocked = hubs.length
        ? new Set([...data.unlockedRoots, ...hubs.map((h) => h.id)])
        : undefined;
      const viaRoots = [...new Set(hubs.flatMap((h) => h.words))]
        .filter((w) => states.get(w) === 'locked' && !revealed.some((c) => c.id === w))
        .map((id) => ({ id, state: 'frontier' as const }));
      const opened = [...revealed, ...viaRoots];
      const roots = hubs.length
        ? { names: hubs.map((h) => h.root), revealed: viaRoots.length }
        : undefined;
      const rootWords = new Set(
        (data.graph.roots ?? [])
          .filter((r) => (unlocked ?? data.unlockedRoots).has(r.id))
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
          id === data.seed ||
          started.has(id) ||
          rootWords.has(id) ||
          isHostile(game.nodes.get(id), 'frontier', t, INFLUENCE),
      );
      const changes = [...opened, ...receded];
      if (!changes.length) return { changes, game, opened: 0, unlocked, roots };
      const nodes = new Map(game.nodes);
      for (const c of opened) nodes.set(c.id, { control: 0, since: t });
      for (const c of receded) nodes.delete(c.id); // grace restarts if it comes back
      return { changes, game: { ...game, nodes }, opened: opened.length, unlocked, roots };
    },
    [data, neighbours, tiers, home],
  );

  // Advance the influence game whenever app time moves (clock tick, time travel).
  useEffect(() => {
    if (!db || !data) return;
    const t = now.getTime();
    const dangerDue = [...data.game.nodes.values()].some((g) => g.danger && g.danger.until <= t);
    if (t - data.game.simAt < 60_000 && !dangerDue) return;
    const levels = verbLevels(data.nodes, data.tenseCards, now);
    const next = simulate(
      data.game,
      data.states,
      weights,
      levels,
      now.getTime(),
      INFLUENCE,
      shielded,
      armour,
    );
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
    const tier = computeProgress(data.nodes, states, data.tenseCards, now, data.home).tier;
    const moved = fallen.length ? horizon(states, remembered, tier, t) : null;
    const game = moved?.game ?? remembered;
    const changes = [...fallen, ...(moved?.changes ?? [])];
    void saveGame(db, game, changes);
    if (moved?.unlocked) void saveMeta(db, 'unlocked_roots', [...moved.unlocked]);
    if (fallen.length) setLost({ at: t, ids: fallen.map((l) => l.id) });
    setData(
      (d) =>
        d && {
          ...d,
          game,
          states: applyChanges(d.states, changes),
          unlockedRoots: moved?.unlocked ?? d.unlockedRoots,
        },
    );
  }, [db, data, now, weights, horizon, shielded, armour]);

  // A raid whose time ran out hits every word left undefended.
  useEffect(() => {
    const raid = data?.raid.active;
    if (!db || !data || !raid) return;
    const status = raidStatus(raid, now.getTime());
    if (status.state !== 'lost') return;
    const nodes = new Map(data.game.nodes);
    for (const id of status.hit) {
      const g = nodes.get(id);
      if (g) nodes.set(id, { ...g, control: Math.max(0.01, g.control - RAID.hit) });
    }
    const game = { ...data.game, nodes };
    const next: RaidState = { last: data.raid.last };
    void saveGame(db, game);
    void saveMeta(db, 'raid', next);
    setEvent({ kind: 'raid-lost', at: now.getTime(), count: status.hit.length });
    setData((d) => d && { ...d, game, raid: next });
  }, [db, data, now]);

  // An expedition ends when its goal is reached (coins) or its time runs out.
  useEffect(() => {
    const exp = data?.expedition;
    if (!db || !data || !exp) return;
    const words = data.graph.regions?.find((r) => r.id === exp.region)?.words ?? [];
    const { state } = expeditionStatus(exp, words, data.states, now.getTime());
    if (state === 'on') return;
    const coins = data.coins + (state === 'won' ? EXPEDITION.coins : 0);
    void saveMeta(db, 'expedition', null);
    if (state === 'won') void saveMeta(db, 'coins', coins);
    setEvent(
      state === 'won'
        ? { kind: 'expedition-won', at: now.getTime(), coins: EXPEDITION.coins }
        : { kind: 'expedition-lost', at: now.getTime() },
    );
    setData((d) => d && { ...d, expedition: null, coins });
  }, [db, data, now]);

  // A landmark built for the first time pays out once.
  useEffect(() => {
    if (!db || !data) return;
    const built = landmarks(data.graph.regions ?? [], data.states, LANDMARK);
    const fresh = [...built].filter((r) => !(String(r) in data.landmarks));
    if (!fresh.length) return;
    const at = appNow(data.offsetDays).getTime();
    const paid = { ...data.landmarks, ...Object.fromEntries(fresh.map((r) => [String(r), at])) };
    const coins = data.coins + fresh.length * LANDMARK.coins;
    void saveMeta(db, 'landmarks', paid);
    void saveMeta(db, 'coins', coins);
    setEvent({ kind: 'landmark', at, regions: fresh, coins: fresh.length * LANDMARK.coins });
    setData((d) => d && { ...d, landmarks: paid, coins });
  }, [db, data]);

  /** Start an expedition into a category with words to take (none if there's nothing open). */
  const startExpedition = useCallback(async () => {
    if (!db || !data || data.expedition) return false;
    const exp = planExpedition(
      data.graph.regions ?? [],
      data.states,
      appNow(data.offsetDays).getTime(),
      EXPEDITION,
    );
    if (!exp) return false;
    await saveMeta(db, 'expedition', exp);
    setData((d) => d && { ...d, expedition: exp });
    return true;
  }, [db, data]);

  const review = useCallback(
    /**
     * Rate a word card. Returns what happened for the UI: a newly opened tier,
     * a claim completed into a conquest, and words a miss put in danger.
     */
    async (row: CardRow, grade: Grade, typed = true): Promise<ReviewOutcome> => {
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
      const before = computeProgress(data.nodes, data.states, data.tenseCards, at, data.home).tier;

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
          // Picked from choices, it isn't known well enough for the fast track.
          firstSight && typed,
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
      const after = computeProgress(data.nodes, statesAfter, data.tenseCards, at, data.home).tier;
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
      if (revealed.unlocked) await saveMeta(db, 'unlocked_roots', [...revealed.unlocked]);
      // Raids: a right answer defends a raided word; now and then a new raid strikes.
      let raid = data.raid;
      let raidEvent: GameEvent | null = null;
      if (success && raid.active) {
        const active = defend(raid.active, row.nodeId);
        raid = { ...raid, active };
        if (raidStatus(active, t).state === 'won') {
          raid = { last: raid.last };
          raidEvent = { kind: 'raid-won', at: t, coins: RAID.coins };
        }
      } else if (success) {
        const statesNow = applyChanges(data.states, changes);
        const hostile = new Set(
          [...statesNow]
            .filter(([id, st]) => isHostile(game.nodes.get(id), st, t, INFLUENCE))
            .map(([id]) => id),
        );
        const control = new Map([...game.nodes].map(([id, g]) => [id, g.control]));
        const targets = raidTargets(statesNow, neighbours, hostile, control, RAID.targets);
        if (raidStarts(raid.last, false, targets, t, RAID)) {
          raid = {
            last: t,
            active: { targets, defended: [], start: t, until: t + RAID.durationMs },
          };
          raidEvent = { kind: 'raid', at: t, count: targets.length };
        }
      }
      if (raid !== data.raid) await saveMeta(db, 'raid', raid);
      if (raidEvent) setEvent(raidEvent);
      // Every real conquest (not a win-back) earns a coin; a won raid pays too.
      const coins =
        data.coins +
        (conquered && !wasWon ? COINS_PER_CONQUEST : 0) +
        (raidEvent?.kind === 'raid-won' ? RAID.coins : 0);
      if (coins !== data.coins) await saveMeta(db, 'coins', coins);
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
          unlockedRoots: revealed.unlocked ?? d.unlockedRoots,
          firstReview,
          game,
          coins,
          raid,
          activity: counted(d.activity, at),
        };
      });
      return {
        levelUp,
        conquered,
        endangered,
        claim: claimed,
        opened: revealed.opened,
        roots: revealed.roots,
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
      const before = computeProgress(data.nodes, data.states, data.tenseCards, at, data.home).tier;
      const after = computeProgress(data.nodes, data.states, tenseCards, at, data.home).tier;
      let changes: StateChange[] = [];
      let levelUp: LevelUp | null = null;
      let game = hit([]);
      let unlocked: Set<string> | undefined;
      if (after > before) {
        const revealed = horizon(data.states, game, after, at.getTime());
        changes = revealed.changes;
        game = revealed.game;
        unlocked = revealed.unlocked;
        levelUp = { tier: after, revealed: changes.length };
      }
      await saveTenseReview(db, tc, grade, at, changes);
      await saveGame(db, game);
      if (unlocked) await saveMeta(db, 'unlocked_roots', [...unlocked]);
      setData(
        (d) =>
          d && {
            ...d,
            tenseCards,
            game,
            states: applyChanges(d.states, changes),
            unlockedRoots: unlocked ?? d.unlockedRoots,
            activity: counted(d.activity, at),
          },
      );
      return levelUp;
    },
    [db, data, horizon],
  );

  /** Record newly earned achievements and pay out their coins. */
  const earnAchievements = useCallback(
    async (earned: Achievement[]) => {
      if (!db || !data || !earned.length) return;
      const at = appNow(data.offsetDays).getTime();
      const achievements = { ...data.achievements };
      for (const a of earned) achievements[a.id] = at;
      const coins = data.coins + earned.reduce((n, a) => n + a.coins, 0);
      await saveMeta(db, 'achievements', achievements);
      await saveMeta(db, 'coins', coins);
      setData((d) => d && { ...d, achievements, coins });
    },
    [db, data],
  );

  /**
   * Plant `option` next to the conquered word `anchor` (core/plant.ts): it
   * becomes a "?" there, joined by your link, for the option's cost in coins.
   */
  const plant = useCallback(
    async (anchor: string, option: PlantOption): Promise<boolean> => {
      if (!db || !data || data.coins < option.cost) return false;
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
      const coins = data.coins - option.cost;
      await saveMeta(db, 'user_edges', userEdges);
      await saveMeta(db, 'coins', coins);
      await saveGame(db, game, changes);
      setData(
        (d) =>
          d && {
            ...d,
            userEdges,
            edges: option.linked ? d.edges : [...d.edges, edge],
            coins,
            game,
            states: applyChanges(d.states, changes),
          },
      );
      return true;
    },
    [db, data],
  );

  /** Buy a word's hint: its English cousin shows next to it and shields it. */
  const buyHint = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const word = data?.nodes.find((n) => n.id === nodeId);
      if (!db || !data || !word?.cognate || data.hints.has(nodeId) || data.coins < HINT_COST)
        return false;
      const hints = new Set(data.hints).add(nodeId);
      const coins = data.coins - HINT_COST;
      await saveMeta(db, 'hints', [...hints]);
      await saveMeta(db, 'coins', coins);
      setData((d) => d && { ...d, hints, coins });
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

  /** Wipe progress; with a first word, a new game starts there (else the picker shows). */
  const reset = useCallback(
    async (seed?: string) => {
      if (!db || !data) return;
      await resetAll(db, data.graph, appNow(0), seed);
      offsetRef.current = 0;
      setData(await loadAll(db, data.graph));
    },
    [db, data],
  );

  return {
    data,
    now,
    error,
    lost,
    review,
    reviewTense,
    earnAchievements,
    plant,
    buyHint,
    timeTravel,
    reset,
    graphName,
    runId,
    event,
    startExpedition,
    shielded,
  };
}
