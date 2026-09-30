import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appNow } from './core/clock';
import { newCard, rate, Rating, State, type Grade } from './core/scheduler';
import { levelAllows, type Levels } from './core/tiers';
import { tenseCardId, type Tense, type TenseCard } from './core/verbs';
import { computeProgress } from './progress';
import { without, type Game, type GameNode } from './core/game';
import {
  CLAIM_EXPIRY_MS,
  CLAIM_GAPS,
  RECLAIM_MS,
  COINS_PER_CONQUEST,
  EXPEDITION,
  HINT_COST,
  RAID,
  ROOTS,
  SUPPLY,
} from './config';
import { expeditionStatus, planExpedition } from './core/expedition';
import { defend, raidReward, raidStarts, raidStatus, raidTargets } from './core/raid';
import { dayKey } from './core/streak';
import type { Achievement } from './core/achievements';
import type { PlantOption } from './core/plant';
import { rootOpenings } from './core/roots';
import { advanceSiege, horizonChanges } from './core/supply';
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
import { hangingOn, isStronghold, seep, siegeWorld, supplyNow } from './supplyState';
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
/** Level names ("A1.2") of the graph: their bands shape the levels. */
const names = (data: AppData) => data.graph.params?.tier_names;
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

/** A new level: the overall one, or a topic's (named). */
export type LevelUp = { tier: number; topic?: string; revealed: number };

/** What rose between two level states: the overall level first, else a topic's. */
function levelUpOf(
  before: Levels,
  after: Levels,
  regions: { id: number; name: string }[] | undefined,
  revealed: number,
): LevelUp | null {
  if (after.overall.tier > before.overall.tier) return { tier: after.overall.tier, revealed };
  for (const [region, topic] of after.topics) {
    if (topic.tier > (before.topics.get(region)?.tier ?? 1)) {
      const name = regions?.find((r) => r.id === region)?.name;
      return { tier: topic.tier, topic: name, revealed };
    }
  }
  return null;
}
export type ReviewOutcome = {
  levelUp: LevelUp | null;
  conquered: boolean;
  /** A miss broke a held word: the words it cut off from supply. */
  cut: number;
  /** Claim progress after a successful answer on a word not yet conquered. */
  claim?: Claim;
  /** Hidden words the answer made conquerable. */
  opened?: number;
  /** A lost word won back with one answer, and what it was restored to. */
  reclaimed?: Fallen;
  /** A broken word mended by a right answer: the words it reconnected. */
  repaired?: number;
  /** Root hubs that opened (core/roots.ts): their names and the words they revealed. */
  roots?: { names: string[]; revealed: number };
};
/** Words lost to the siege (cut off longer than they could hold out). */
export type LostEvent = { at: number; ids: string[] };
/** Something the game did on its own, for a banner (raids, expeditions, strongholds). */
export type GameEvent =
  | { kind: 'raid'; at: number; count: number; ids: string[] }
  /** A passed pop quiz: what it paid (`speed` of it for time left), how long it took. */
  | { kind: 'raid-won'; at: number; coins: number; speed: number; tookMs: number; ids: string[] }
  | { kind: 'expedition-won'; at: number; coins: number }
  | { kind: 'expedition'; at: number; region: string; goal: number }
  | { kind: 'raid-lost'; at: number; count: number }
  | { kind: 'expedition-lost'; at: number }
  /** A word you know so well it sends out full supply (core/supply.ts wordOutput). */
  | { kind: 'stronghold'; at: number; word: string };

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
  /** Real time of the last fast-forward jump (skipAhead): the siege waits until it settles. */
  const skipping = useRef(0);

  useEffect(() => {
    getDb()
      .then(async ({ db, graph }) => {
        setDb(db);
        const loaded = await loadAll(db, graph);
        offsetRef.current = loaded.offsetDays;
        setData(loaded);
      })
      .catch((e) => setError(String(e)));
    // Refresh the clock so memory keeps fading while the app is open.
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const offsetDays = data?.offsetDays ?? 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => appNow(offsetDays), [offsetDays, tick, data]);
  const neighbours = useMemo(() => neighbourMap(data?.edges ?? []), [data?.edges]);
  const [lost, setLost] = useState<LostEvent | null>(null);
  const [event, setEvent] = useState<GameEvent | null>(null);

  // Tick when the next claim step opens or a raid/expedition ends, without waiting for the minute clock.
  useEffect(() => {
    if (!data) return;
    const t = now.getTime();
    const opens = [...data.game.nodes]
      .filter(([id]) => data.states.get(id) === 'claimed')
      .map(([, g]) => claimNext(g.claim, CLAIM_GAPS)?.opensAt ?? Infinity)
      .concat([data.raid.active?.until ?? Infinity, data.expedition?.until ?? Infinity])
      .filter((o) => o > t && o < Infinity);
    if (!opens.length) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(...opens) - t + 50);
    return () => clearTimeout(timer);
  }, [data, now]);

  /**
   * Move the horizon (core/supply.ts): hidden words next to your words and a
   * working capital become "?", and so do words further out where strong
   * supply seeps (SUPPLY.fog / reveal); untried "?" left alone go back to
   * hidden. Root hubs with enough of their words inside your supply open
   * (core/roots.ts) and reveal all their words, at any level. `memory`: cards
   * after an answer not in `data` yet (what words send out follows them).
   */
  const horizon = useCallback(
    (
      states: Map<string, NodeState>,
      game: Game,
      levels: Levels,
      t: number,
      memory?: Partial<Pick<AppData, 'cards' | 'tenseCards'>>,
    ): {
      changes: StateChange[];
      opened: number;
      /** The new set of open roots, when some opened. */
      unlocked?: Set<string>;
      roots?: { names: string[]; revealed: number };
    } => {
      if (!data) return { changes: [], opened: 0 };
      const supply = supplyNow({ ...data, ...memory, states, game }, t);
      // Supply seeps past your words only from words you hold: a capital not won
      // yet shows its neighbours, as at every start, not three rings of "?".
      const reach = seep(
        supply,
        new Map([...supply.input.sources].filter(([id]) => states.get(id) === 'conquered')),
      );
      // Your words, and the capital before its first conquest: a new game shows
      // its neighbours (once held and lost, it's a word like any other).
      const fresh = game.nodes.get(data.seed)?.fallen?.was !== 'conquered';
      const anchors = new Set([
        ...(fresh ? [data.seed] : []),
        ...[...states].filter(([, st]) => st === 'conquered').map(([id]) => id),
      ]);
      // A root charges from the supply reaching its words (a full share of SUPPLY.min each).
      const charge = new Map(
        [...supply.flow.value].map(([id, v]) => [id, Math.min(1, v / SUPPLY.min)]),
      );
      // A root shows on the map once one of its words is conquered; only then can it open.
      const hubs = rootOpenings(
        (data.graph.roots ?? []).filter((r) => r.words.some((w) => states.get(w) === 'conquered')),
        charge,
        data.unlockedRoots,
        ROOTS.open,
      );
      const unlocked = hubs.length
        ? new Set([...data.unlockedRoots, ...hubs.map((h) => h.id)])
        : undefined;
      const rootWords = new Set(
        (data.graph.roots ?? [])
          .filter((r) => (unlocked ?? data.unlockedRoots).has(r.id))
          .flatMap((r) => r.words),
      );
      const started = new Set(
        data.cards.filter((c) => c.card.state !== State.New).map((c) => c.nodeId),
      );
      const moved = horizonChanges(
        states,
        neighbours,
        anchors,
        levelAllows(data.nodes, levels),
        (id) => id === data.seed || started.has(id) || rootWords.has(id),
        reach,
        SUPPLY.reveal,
      );
      const viaRoots = [...new Set(hubs.flatMap((h) => h.words))]
        .filter((w) => states.get(w) === 'locked' && !moved.some((c) => c.id === w))
        .map((id) => ({ id, state: 'frontier' as const }));
      const changes = [...moved, ...viaRoots];
      const roots = hubs.length
        ? { names: hubs.map((h) => h.root), revealed: viaRoots.length }
        : undefined;
      const opened = changes.filter((c) => c.state === 'frontier').length;
      return { changes, opened, unlocked, roots };
    },
    [data, neighbours],
  );

  // The siege runs whenever app time moves (clock tick, time travel): cut-off
  // words start their clock, reconnected ones stop it, and words cut off longer
  // than their memory lasts fall back to "?" (core/supply.ts advanceSiege).
  useEffect(() => {
    if (!db || !data || !data.started) return;
    const t = now.getTime();
    if (t - data.game.simAt < 60_000) return;
    // Not on every jump of a fast-forward (each would save the whole DB): once it settles.
    if (Date.now() - skipping.current < 1000) return;
    const cutBefore = new Map(
      [...data.game.nodes].flatMap(([id, g]) =>
        g.cutSince !== undefined ? [[id, g.cutSince] as const] : [],
      ),
    );
    const siege = advanceSiege(siegeWorld(data, t), cutBefore, data.game.simAt || t, t);
    const nodes = new Map(data.game.nodes);
    for (const [id, g] of nodes) {
      if (g.cutSince !== undefined && !siege.cutSince.has(id))
        nodes.set(id, without(g, 'cutSince'));
    }
    for (const [id, since] of siege.cutSince) nodes.set(id, { ...nodes.get(id), cutSince: since });
    // Unfinished claims slip back after a day: finish what you start.
    const expired: StateChange[] = [];
    for (const [id, st] of data.states) {
      if (
        st === 'claimed' &&
        t - claimStartedAt(data.game.nodes.get(id)?.claim) > CLAIM_EXPIRY_MS
      ) {
        expired.push({ id, state: 'frontier' });
        nodes.set(id, without(nodes.get(id), 'claim'));
      }
    }
    const falls: StateChange[] = siege.fallen.map((f) => ({ id: f.id, state: 'frontier' }));
    const fallen = [...falls, ...expired];
    // Lost words remember what they were: one right answer wins them back for a while.
    const game = recordFalls({ simAt: t, nodes }, data.states, claimsOf(data.game), fallen, t);
    const states = applyChanges(data.states, fallen);
    const levels = computeProgress(data.nodes, states, data.tenseCards, now, names(data));
    // Supply moves with time too (words fading break): the horizon follows.
    const moved = horizon(states, game, levels, t);
    const changes = [...fallen, ...(moved?.changes ?? [])];
    void saveGame(db, game, changes);
    if (moved?.unlocked) void saveMeta(db, 'unlocked_roots', [...moved.unlocked]);
    if (falls.length) setLost({ at: t, ids: falls.map((l) => l.id) });
    setData(
      (d) =>
        d && {
          ...d,
          game,
          states: applyChanges(d.states, changes),
          unlockedRoots: moved?.unlocked ?? d.unlockedRoots,
        },
    );
  }, [db, data, now, horizon]);

  // A raid whose time ran out breaks every word left undefended.
  useEffect(() => {
    const raid = data?.raid.active;
    if (!db || !data || !raid) return;
    const status = raidStatus(raid, now.getTime());
    if (status.state !== 'lost') return;
    const nodes = new Map(data.game.nodes);
    for (const id of status.hit) {
      if (data.states.get(id) === 'conquered') {
        nodes.set(id, { ...nodes.get(id), missedAt: raid.until });
      }
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
    const region = data.graph.regions?.find((r) => r.id === exp.region)?.name ?? '';
    setEvent({ kind: 'expedition', at: exp.start, region, goal: exp.goal });
    return true;
  }, [db, data]);

  const review = useCallback(
    /**
     * Rate a word card. Returns what happened for the UI: a newly opened tier,
     * a claim completed into a conquest, words a miss cut off.
     */
    async (row: CardRow, grade: Grade, typed = true): Promise<ReviewOutcome> => {
      const none: ReviewOutcome = { levelUp: null, conquered: false, cut: 0 };
      if (!db || !data) return none;
      const at = appNow(data.offsetDays);
      const t = at.getTime();
      const card = rate(row.card, grade, at);
      const id = row.nodeId;
      const stateBefore = data.states.get(id);
      const success = grade !== Rating.Again;
      // First sight of a word (neither direction ever answered): not knowing it is
      // learning, nothing breaks. Every later miss counts in the game.
      const firstSight = unseen(data.cards.filter((c) => c.nodeId === id));
      const before = computeProgress(data.nodes, data.states, data.tenseCards, at, names(data));
      const supplyBefore = supplyNow(data, t);

      // A word you had won and lost: one right answer brings its old status back.
      const wasWon = reclaimable(data.game, data.states, id, t, RECLAIM_MS);
      let changes = unlockChanges(id, grade, data.states);
      let game: Game = data.game;
      const set = (fn: (nodes: Map<string, GameNode>) => void) => {
        const nodes = new Map(game.nodes);
        fn(nodes);
        game = { ...game, nodes };
      };

      // Claim bookkeeping: recognise, produce, then lock in after a break (core/claim.ts).
      let conquered = false;
      let claimed: Claim | undefined;
      let repaired: number | undefined;
      if (success && wasWon) {
        const back = reclaim(game, id, wasWon, t);
        changes = [back.change];
        game = back.game;
        conquered = wasWon.was === 'conquered';
        claimed = back.claim;
      } else if (success && (stateBefore === 'frontier' || stateBefore === 'claimed')) {
        const claim = recordClaim(
          data.game.nodes.get(id)?.claim,
          row.direction,
          t,
          CLAIM_GAPS,
          // Picked from choices, it isn't known well enough for the fast track.
          firstSight && typed,
        );
        if (stateBefore === 'claimed' && claimComplete(claim)) {
          changes = [...changes, { id, state: 'conquered' }];
          set((nodes) => nodes.set(id, {}));
          conquered = true;
        } else {
          set((nodes) => nodes.set(id, { ...nodes.get(id), claim }));
          claimed = claim;
        }
      } else if (success && stateBefore === 'conquered' && supplyBefore.broken.has(id)) {
        // A right answer mends a broken word and reconnects what hung on it.
        repaired = hangingOn(supplyBefore, id).length;
        set((nodes) => nodes.set(id, without(nodes.get(id), 'missedAt')));
      }

      // A real miss: a held word breaks (a gap in your supply until a right
      // answer), a claim falls back to "?".
      let cut = 0;
      if (!success && !firstSight) {
        if (stateBefore === 'conquered') {
          set((nodes) => nodes.set(id, { ...nodes.get(id), missedAt: t }));
          const after = supplyNow({ ...data, game }, t);
          cut = [...after.cut].filter((x) => x !== id && !supplyBefore.cut.has(x)).length;
        } else if (stateBefore === 'claimed') {
          const falls: StateChange[] = [{ id, state: 'frontier' }];
          changes = [...changes, ...falls];
          game = recordFalls(game, data.states, claimsOf(data.game), falls, t);
        }
      }

      const statesAfter = applyChanges(data.states, changes);
      const after = computeProgress(data.nodes, statesAfter, data.tenseCards, at, names(data));
      // Conquest locks in both directions: the other card (right in step 1 or 2,
      // still in FSRS learning) graduates too, so the word isn't asked again at once.
      const other = conquered
        ? data.cards.find(
            (c) => c.nodeId === id && c.id !== row.id && c.card.state !== State.Review,
          )
        : undefined;
      const graduated = other && { ...other, card: rate(other.card, Rating.Good, at) };
      const cardsAfter = data.cards.map((c) =>
        c.id === row.id ? { ...c, card } : c.id === graduated?.id ? graduated : c,
      );
      // What the new territory opens (and, on a level up, the new tier): a word
      // known better sends out more supply, so it may see further.
      const revealed = horizon(statesAfter, game, after, t, { cards: cardsAfter });
      changes = [...changes, ...revealed.changes];
      const levelUp = levelUpOf(before, after, data.graph.regions, revealed.opened);
      // Known well enough to send out full supply: a stronghold.
      const stronghold =
        statesAfter.get(id) === 'conquered' &&
        !isStronghold(supplyBefore.world, id) &&
        isStronghold(siegeWorld({ ...data, cards: cardsAfter }, t), id);
      await saveReview(db, row.id, card, grade, at, changes);
      if (graduated) await saveCard(db, graduated.id, graduated.card);
      await saveGame(db, game);
      if (revealed.unlocked) await saveMeta(db, 'unlocked_roots', [...revealed.unlocked]);

      // Raids: a right answer defends a raided word; now and then a new raid strikes.
      let raid = data.raid;
      let raidEvent: GameEvent | null = null;
      if (success && raid.active) {
        const active = defend(raid.active, id);
        raid = { ...raid, active };
        if (raidStatus(active, t).state === 'won') {
          raid = { last: raid.last };
          raidEvent = {
            kind: 'raid-won',
            at: t,
            ...raidReward(active, t, RAID),
            ids: active.targets,
          };
        }
      } else if (success && raidStarts(raid.last, false, [id], t, RAID)) {
        // The luck is in: strike the words the most hangs on (worth the work only now).
        const s = supplyNow({ ...data, states: applyChanges(data.states, changes), game }, t);
        // The capital is fortified: raids strike the words around it. Weighing
        // every word takes long on a big map; a random few are enough to draw from.
        const pool = [...s.flow.value.keys()].filter(
          (x) => s.input.carries(x) && !s.cut.has(x) && x !== s.world.home,
        );
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const hang = new Map(pool.slice(0, 30).map((x) => [x, hangingOn(s, x).length] as const));
        const targets = raidTargets(hang, RAID.targets);
        if (targets.length) {
          raid = {
            last: t,
            active: { targets, defended: [], start: t, until: t + RAID.durationMs },
          };
          raidEvent = { kind: 'raid', at: t, count: targets.length, ids: targets };
        }
      }
      if (raid !== data.raid) await saveMeta(db, 'raid', raid);
      if (raidEvent) setEvent(raidEvent);
      else if (stronghold) {
        const word = data.nodes.find((n) => n.id === id)?.it ?? id;
        setEvent({ kind: 'stronghold', at: t, word });
      }
      // Every real conquest (not a win-back) earns a coin; a won raid pays too.
      const coins =
        data.coins +
        (conquered && !wasWon ? COINS_PER_CONQUEST : 0) +
        (raidEvent?.kind === 'raid-won' ? raidEvent.coins : 0);
      if (coins !== data.coins) await saveMeta(db, 'coins', coins);
      setData((d) => {
        if (!d) return d;
        const firstReview = new Map(d.firstReview);
        if (!firstReview.has(id)) firstReview.set(id, at.toISOString());
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
        cut,
        claim: claimed,
        opened: revealed.opened,
        roots: revealed.roots,
        repaired,
        reclaimed: success && wasWon ? wasWon : undefined,
      };
    },
    [db, data, horizon],
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
      if (!existing && grade === Rating.Again) return null;
      const tc: TenseCard = {
        id,
        nodeId,
        tense,
        card: rate(existing?.card ?? newCard(at), grade, at),
      };
      const tenseCards = [...data.tenseCards.filter((c) => c.id !== id), tc];
      const before = computeProgress(data.nodes, data.states, data.tenseCards, at, names(data));
      const after = computeProgress(data.nodes, data.states, tenseCards, at, names(data));
      let changes: StateChange[] = [];
      let levelUp: LevelUp | null = null;
      let unlocked: Set<string> | undefined;
      if (levelUpOf(before, after, data.graph.regions, 0)) {
        const revealed = horizon(data.states, data.game, after, at.getTime(), { tenseCards });
        changes = revealed.changes;
        unlocked = revealed.unlocked;
        levelUp = levelUpOf(before, after, data.graph.regions, revealed.opened);
      }
      await saveTenseReview(db, tc, grade, at, changes);
      if (unlocked) await saveMeta(db, 'unlocked_roots', [...unlocked]);
      // Enough tenses make a verb send out full supply: a stronghold.
      const t = at.getTime();
      if (
        data.states.get(nodeId) === 'conquered' &&
        !isStronghold(siegeWorld(data, t), nodeId) &&
        isStronghold(siegeWorld({ ...data, tenseCards }, t), nodeId)
      ) {
        const word = data.nodes.find((n) => n.id === nodeId)?.it ?? nodeId;
        setEvent({ kind: 'stronghold', at: t, word });
      }
      setData(
        (d) =>
          d && {
            ...d,
            tenseCards,
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
   * The link carries supply too: a planted detour protects a chokepoint.
   */
  const plant = useCallback(
    async (anchor: string, option: PlantOption): Promise<boolean> => {
      if (!db || !data || data.coins < option.cost) return false;
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
      const coins = data.coins - option.cost;
      await saveMeta(db, 'user_edges', userEdges);
      await saveMeta(db, 'coins', coins);
      await saveGame(db, data.game, changes);
      setData(
        (d) =>
          d && {
            ...d,
            userEdges,
            edges: option.linked ? d.edges : [...d.edges, edge],
            coins,
            states: applyChanges(d.states, changes),
          },
      );
      return true;
    },
    [db, data],
  );

  /** Buy a word's hint: its English cousin shows next to it. */
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

  /**
   * Fast-forward (App, FAST_FORWARD): app time moves on by up to `maxMs`, never
   * past `until` (app ms). Called twice a second while it runs, so the offset is
   * saved only once it settles.
   */
  const saveOffset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skipAhead = useCallback(
    (maxMs: number, until: number) => {
      if (!db) return;
      const ms = Math.min(maxMs, until - appNow(offsetRef.current).getTime());
      if (ms <= 0) return;
      const next = offsetRef.current + ms / 86_400_000;
      offsetRef.current = next;
      skipping.current = Date.now();
      setData((d) => d && { ...d, offsetDays: next });
      clearTimeout(saveOffset.current);
      saveOffset.current = setTimeout(() => {
        void setOffsetDays(db, offsetRef.current);
        setTick((n) => n + 1); // the siege catches up (see above)
      }, 1500);
    },
    [db],
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

  /** Wipe progress; with a capital, a new game starts there (else the picker shows). */
  const reset = useCallback(
    async (seed?: string) => {
      if (!db || !data) return;
      await resetAll(db, data.graph, appNow(0), seed);
      offsetRef.current = 0;
      setData(await loadAll(db, data.graph));
    },
    [db, data],
  );

  /** Reload the page (another run) once everything written is stored. */
  const reload = useCallback(async () => {
    await db?.flush?.();
    window.location.reload();
  }, [db]);

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
    skipAhead,
    reset,
    reload,
    graphName,
    runId,
    event,
    startExpedition,
  };
}
