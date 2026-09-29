import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CLAIM_GAPS,
  COOLDOWN_MS,
  EXPEDITION,
  RAID,
  HINT_COST,
  PLANT_COST,
  PLANT_COST_PER_TIER,
  RECLAIM_MS,
  ROOTS,
  SUPPLY,
} from './config';
import { reclaimable } from './core/fallen';
import { attentionList, newlyRevealed } from './core/attention';
import { claimNext, CLAIM_STEPS, unseen, type Claim } from './core/claim';
import { FULL_NAME, hintedName } from './core/fade';
import { appNow } from './core/clock';
import { nodeHealth } from './core/health';
import { buildQueue, closest, nearby, openOrder } from './core/queue';
import { tierAllows, tierMap, type TierProgress } from './core/tiers';
import { ghostWords } from './core/supply';
import { rootCharge, rootNeed } from './core/roots';
import { neighbourMap } from './core/unlock';
import { nextDrill, TENSES, type Tense } from './core/verbs';
import { computeProgress, verbLevels as computeVerbLevels } from './progress';
import { cardId, dueAt, isDue, Rating, retrievability, type Grade } from './core/scheduler';
import type { NodeState } from './core/unlock';
import { nextPractice, nodeStrength } from './core/strength';
import type { AppData, CardRow } from './db/repo';
import { useSprawl, type GameEvent, type LevelUp } from './useSprawl';
import { hangingOn, nodesToPlace, previewNode, supplyNodes, supplyNow } from './supplyState';
import PlacePanel from './views/PlacePanel';
import Menu from './views/Menu';
import Guide from './views/Guide';
import StartPicker from './views/StartPicker';
import { pickStart } from './core/start';
import { streak } from './core/streak';
import { expeditionStatus } from './core/expedition';
import { newRun, switchRun, updateRun, deleteRun, runDbSuffix } from './runs';
import { dbName } from './db';
import GraphView from './views/GraphView';
import InspectPanel from './views/InspectPanel';
import ReviewView from './views/ReviewView';
import VerbDrill from './views/VerbDrill';
import WordInfo from './views/WordInfo';
import WaitCard from './views/WaitCard';
import ProgressPanel from './views/ProgressPanel';
import PlantPicker from './views/PlantPicker';
import { clusterScores, totalScore, wordLinks } from './core/score';
import { newlyEarned, type Achievement, type Stats } from './core/achievements';
import { plantOptions } from './core/plant';
import { resumeOnGesture, sfx } from './audio';
import { onSpeechProblem } from './speech';
import NodeDetails from './views/NodeDetails';
import VerbGoals, { type VerbGoal } from './views/VerbGoals';

/** A node the user clicked: its cards are reviewed before the automatic queue. */
type Session = { nodeId: string; cardIds: string[]; mode: 'conquer' | 'practice' };

export default function App() {
  const {
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
    placeNode,
    liftNode,
  } = useSprawl();
  const [lastCardId, setLastCardId] = useState<string>();
  const [session, setSession] = useState<Session | null>(null);
  const [turn, setTurn] = useState(0);
  const [inspect, setInspect] = useState(false);
  const [showRoots, setShowRoots] = useState(true);
  const [inspectId, setInspectId] = useState<string>();
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  /** A verb that just mastered a new tense: celebrated over the map. */
  const [verbUp, setVerbUp] = useState<{ nodeId: string; level: number } | null>(null);
  /** Node id -> real time (ms) until which it is locked after a wrong answer. */
  const [cooldowns, setCooldowns] = useState<Map<string, number>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  /** Last word clicked or reached with the arrow keys: shown in the details panel. */
  const [selectedId, setSelectedId] = useState<string>();
  const [showVerbGoals, setShowVerbGoals] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === '?' && !typing) setShowGuide((v) => !v);
      else if (e.key === 'Escape') setShowGuide(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** A conquered word opened for viewing (it isn't due): meaning, etymology, tenses. */
  const [info, setInfo] = useState<{ nodeId: string; status: string } | null>(null);
  /**
   * A selected word that can't be worked on right now: the panel stays on it and
   * says why (out of reach, locked after a miss, next claim step not open).
   */
  const [waitOn, setWaitOn] = useState<{
    nodeId: string;
    reason: 'reach' | 'locked' | 'claim' | 'root';
    note?: string;
  } | null>(null);
  const [verbDrill, setVerbDrill] = useState<{
    nodeId: string;
    tense: Tense;
    kind: 'learn' | 'defend';
  } | null>(null);
  const [, setSecond] = useState(0);
  /** Words revealed during this visit and not opened yet: flagged as new on the map. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const prevStates = useRef<Map<string, NodeState> | null>(null);
  /** Word id -> the card whose prompt is on show, not answered yet (core/queue.openOrder). */
  const shown = useRef(new Map<string, string>());

  useEffect(() => {
    if (!data) return;
    const prev = prevStates.current;
    prevStates.current = data.states;
    if (!prev || prev === data.states) return;
    const revealed = newlyRevealed(prev, data.states);
    if (revealed.length) setFresh((f) => new Set([...f, ...revealed]));
  }, [data, data?.states]);

  // Locks run on app time, so time travel (+15 min) lifts them too.
  const offsetDays = data?.offsetDays ?? 0;
  const appMs = () => appNow(offsetDays).getTime();
  // Tick every second while something is cooling down (countdown rings), then expire.
  useEffect(() => {
    if (!cooldowns.size) return;
    const expire = () => {
      const t = appNow(offsetDays).getTime();
      const live = [...cooldowns].filter(([, until]) => until > t);
      if (live.length < cooldowns.size) setCooldowns(new Map(live));
    };
    expire();
    const t = setInterval(() => {
      setSecond((s) => s + 1);
      expire();
    }, 1000);
    return () => clearInterval(t);
  }, [cooldowns, offsetDays]);

  // A soft bell when a claim step opens (not on load).
  const readyCount = useMemo(
    () =>
      data
        ? [...data.states].filter(
            ([id, st]) =>
              st === 'claimed' &&
              (claimNext(data.game.nodes.get(id)?.claim, CLAIM_GAPS)?.opensAt ?? Infinity) <=
                now.getTime(),
          ).length
        : 0,
    [data, now],
  );
  const prevReady = useRef<number | null>(null);
  useEffect(() => {
    if (prevReady.current !== null && readyCount > prevReady.current) sfx('ready');
    prevReady.current = data ? readyCount : null;
  }, [readyCount, data]);
  useEffect(() => resumeOnGesture(), []);
  useEffect(() => onSpeechProblem((m) => setNotice(m)), []);
  // Keep the run list's summary current (menu → Runs).
  const conqueredCount = data
    ? [...data.states.values()].filter((st) => st === 'conquered').length
    : 0;
  useEffect(() => {
    if (data?.started)
      updateRun(graphName, runId, { conquered: conqueredCount, played: Date.now() });
  }, [conqueredCount, data?.started, graphName, runId]);

  // While a claimed word waits for its next step, count down every second.
  const claiming = !!data && [...data.states.values()].includes('claimed');
  useEffect(() => {
    if (!claiming) return;
    const t = setInterval(() => setSecond((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [claiming]);

  useEffect(() => {
    if (!lost || !data) return;
    const names = lost.ids.map((id) => data.nodes.find((n) => n.id === id)?.it ?? id);
    setNotice(
      `Cut off too long: ${names.join(', ')} · ↺ ${RECLAIM_MS / 86_400_000} days to win back`,
    );
    sfx('lost');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lost]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!verbUp) return;
    const t = setTimeout(() => setVerbUp(null), 6000);
    return () => clearTimeout(t);
  }, [verbUp]);

  useEffect(() => {
    if (!levelUp) return;
    const t = setTimeout(() => setLevelUp(null), 6000);
    return () => clearTimeout(t);
  }, [levelUp]);

  const health = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!data) return m;
    const byNode = new Map<string, typeof data.cards>();
    for (const c of data.cards) byNode.set(c.nodeId, [...(byNode.get(c.nodeId) ?? []), c]);
    for (const [id, cards] of byNode) {
      m.set(
        id,
        data.states.get(id) === 'conquered'
          ? // Its weaker direction: due at 90%, broken at 80% (SUPPLY.breakRecall).
            (nodeHealth(
              cards.map((c) => c.card),
              now,
            ) ?? 1)
          : null,
      );
    }
    return m;
  }, [data, now]);

  const cardsByNode = useMemo(() => {
    const m = new Map<string, CardRow[]>();
    for (const c of data?.cards ?? []) m.set(c.nodeId, [...(m.get(c.nodeId) ?? []), c]);
    return m;
  }, [data?.cards]);
  const strength = useMemo(
    () =>
      new Map([...cardsByNode].map(([id, cs]) => [id, nodeStrength(cs.map((c) => c.card)).level])),
    [cardsByNode],
  );

  const progress = useMemo(
    () => (data ? computeProgress(data.nodes, data.states, data.tenseCards, now, data.home) : null),
    [data, now],
  );
  const neighbours = useMemo(() => neighbourMap(data?.edges ?? []), [data?.edges]);
  /** Supply (core/supply.ts): who carries it, who's broken, who's cut off. */
  const supply = useMemo(() => (data ? supplyNow(data, now.getTime()) : null), [data, now]);
  /** Hidden words one link beyond your "?": the ghosts of what lies ahead. */
  const ghosts = useMemo(
    () =>
      data && progress
        ? ghostWords(
            data.states,
            neighbours,
            tierAllows(tierMap(data.nodes), progress.tier, data.home),
          )
        : new Set<string>(),
    [data, neighbours, progress],
  );
  const verbLevels = useMemo(
    () => (data ? computeVerbLevels(data.nodes, data.tenseCards, now) : new Map<string, number>()),
    [data, now],
  );

  // Score (core/score.ts): conquered words per category, weighted by cohesion.
  const regionOf = useMemo(() => {
    const m = new Map((data?.nodes ?? []).map((n) => [n.id, n.region ?? undefined]));
    return (id: string) => m.get(id);
  }, [data?.nodes]);
  // Cut-off words don't score until they are reconnected.
  const clusters = useMemo(() => {
    if (!data) return [];
    const scored = new Map(data.states);
    for (const id of supply?.cut ?? []) scored.set(id, 'claimed');
    return clusterScores(scored, data.edges, regionOf);
  }, [data, regionOf, supply]);
  const score = totalScore(clusters);

  // Achievements: check the milestones whenever progress changes; new ones pay coins.
  const [earnedNow, setEarnedNow] = useState<Achievement[]>([]);
  useEffect(() => {
    if (!data) return;
    const regions = data.graph.regions ?? [];
    const stats: Stats = {
      conquered: [...data.states.values()].filter((st) => st === 'conquered').length,
      revealed: [...data.states.values()].filter((st) => st !== 'locked').length,
      categories: regions.map((r) => ({
        words: r.words.length,
        conquered: r.words.filter((w) => data.states.get(w) === 'conquered').length,
      })),
      cohesionAt: (n) =>
        Math.max(0, ...clusters.filter((c) => c.words >= n).map((c) => c.cohesion)),
      verbLevels: [...verbLevels.values()],
      score,
      planted: data.userEdges.length,
    };
    const gained = newlyEarned(stats, data.achievements);
    if (!gained.length) return;
    void earnAchievements(gained);
    setEarnedNow(gained);
    sfx('achievement');
  }, [data, clusters, verbLevels, score, earnAchievements]);
  useEffect(() => {
    if (!earnedNow.length) return;
    const t = setTimeout(() => setEarnedNow([]), 6000);
    return () => clearTimeout(t);
  }, [earnedNow]);
  const [showProgress, setShowProgress] = useState(false);
  /** Conquered word whose plant picker is open. */
  const [planting, setPlanting] = useState<string | null>(null);
  /** Placing an earned supply node: the word whose preview the map shows. */
  const [placing, setPlacing] = useState(false);
  const [previewId, setPreviewId] = useState<string>();

  /** Charge of each sealed root: the supply at its words, each up to 1 (core/roots.ts). */
  const rootCharges = useMemo(() => {
    if (!data || !supply) return new Map<string, number>();
    const charge = new Map(
      [...supply.flow.value].map(([id, v]) => [id, Math.min(1, v / SUPPLY.min)]),
    );
    return rootCharge(data.graph.roots ?? [], charge, data.unlockedRoots);
  }, [data, supply]);

  const queue = useMemo(() => {
    if (!data) return [];
    // Words being conquered only offer the card of their open claim step.
    const stepOpen = (c: CardRow) => {
      const st = data.states.get(c.nodeId);
      if (st !== 'frontier' && st !== 'claimed') return true;
      const next = claimNext(data.game.nodes.get(c.nodeId)?.claim, CLAIM_GAPS);
      return !!next && next.directions.includes(c.direction) && next.opensAt <= now.getTime();
    };
    const open = buildQueue({ cards: data.cards, states: data.states, now, lastCardId }).filter(
      (c) =>
        !cooldowns.has(c.nodeId) &&
        stepOpen(c) &&
        // The raid bar names raided words in English: they wait for their en→it card.
        !(c.direction === 'it-en' && isRaided(data, c.nodeId)),
    );
    // Chokepoints first: of the due words, the one the most hangs on (a stable
    // sort, so ties keep the queue's own order, weakest first).
    if (!supply) return open;
    const hang = new Map<string, number>();
    const hangOf = (id: string) => {
      if (!hang.has(id)) {
        const held = data.states.get(id) === 'conquered' && !supply.cut.has(id);
        hang.set(id, held || supply.broken.has(id) ? hangingOn(supply, id).length : 0);
      }
      return hang.get(id)!;
    };
    const sorted = [...open].sort((a, b) => hangOf(b.nodeId) - hangOf(a.nodeId));
    if (sorted.length > 1 && sorted[0].id === lastCardId) sorted.push(sorted.shift()!);
    return sorted;
  }, [data, now, lastCardId, cooldowns, supply]);

  if (error) return <div className="p-6 text-red-400">Failed to open database: {error}</div>;
  if (!data) return <div className="p-6 text-slate-400">Loading…</div>;

  // The review stays local: only the word you're on or a word linked to it comes
  // next. With nothing due there, it stays put (N / the jump bar find the rest).
  const nearQueue = nearby(queue, selectedId, neighbours);
  const isNear = (id: string) =>
    !selectedId || id === selectedId || !!neighbours.get(selectedId)?.includes(id);
  const current: CardRow | undefined = session
    ? data.cards.find((c) => c.id === session.cardIds[0])
    : nearQueue[0];
  const mode = session?.mode ?? 'due';
  // Due tense drills defend automatically once no word card is waiting.
  const dueTense =
    !session && !current
      ? data.tenseCards.find(
          (c) => isDue(c.card, now) && !cooldowns.has(c.nodeId) && isNear(c.nodeId),
        )
      : undefined;
  const activeDrill =
    verbDrill ??
    (dueTense && !info
      ? { nodeId: dueTense.nodeId, tense: dueTense.tense, kind: 'defend' as const }
      : null);
  const dueCount = queue.filter((c) => !session?.cardIds.includes(c.id)).length;

  // Details panel: the word being worked on, else the last one selected.
  const detailsId =
    planting ??
    waitOn?.nodeId ??
    activeDrill?.nodeId ??
    info?.nodeId ??
    session?.nodeId ??
    selectedId ??
    current?.nodeId;
  const detailsWord = data.nodes.find((n) => n.id === detailsId);
  // The word the side panel is about, in the order the panel picks its card: the
  // map rings exactly this one (a due card waits while you look at another word).
  const panelId =
    planting ??
    waitOn?.nodeId ??
    activeDrill?.nodeId ??
    info?.nodeId ??
    current?.nodeId ??
    selectedId;
  // The word whose Italian name is the answer being asked: hidden everywhere meanwhile.
  const answerId =
    !waitOn && !activeDrill && !info && current?.direction === 'en-it' ? current.nodeId : undefined;
  /** Raided words still to defend (core/raid.ts). */
  const raided = new Set(
    (data.raid.active?.targets ?? []).filter((id) => !data.raid.active?.defended.includes(id)),
  );
  // Conquered words about to be asked into Italian (an en→it card due, or raided,
  // which is defended that way): their names show only a few letters until then,
  // so the map doesn't hand out the answer before the card opens.
  const recall = new Set([
    ...raided,
    ...(data.cards ?? [])
      .filter((c) => c.direction === 'en-it' && isDue(c.card, now))
      .map((c) => c.nodeId)
      .filter((id) => data.states.get(id) === 'conquered'),
  ]);
  const nameOf = (id: string) => {
    if (data.states.get(id) !== 'conquered' || id === answerId) return '';
    const w = data.nodes.find((n) => n.id === id);
    return w ? hintedName(w.it, health.get(id) ?? null, recall.has(id)) : '';
  };

  const claims = new Map([...data.game.nodes].map(([id, g]) => [id, g.claim]));
  const days = streak(data.activity, now);
  const expedition = data.expedition && {
    ...data.expedition,
    name: data.graph.regions?.find((r) => r.id === data.expedition!.region)?.name ?? '',
    ...expeditionStatus(
      data.expedition,
      data.graph.regions?.find((r) => r.id === data.expedition!.region)?.words ?? [],
      data.states,
      appMs(),
    ),
  };
  /** Broken held words and how many words hang on each (cut off until it's mended). */
  const brokenHang = new Map(
    [...(supply?.broken ?? [])].map((id) => [id, supply ? hangingOn(supply, id).length : 0]),
  );
  /** Supply as the map draws it: flow, broken words, supply nodes, siege clocks. */
  const supplyView = supply && {
    value: supply.flow.value,
    from: supply.flow.from,
    broken: supply.broken,
    nodes: new Set(supplyNodes(data)),
    working: supply.working,
    cut: new Map(
      [...supply.cut].map((id) => {
        const since = data.game.nodes.get(id)?.cutSince ?? now.getTime();
        return [id, { since, until: since + supply.world.holdMs(id) }] as const;
      }),
    ),
    min: SUPPLY.min,
  };
  const toPlace = nodesToPlace(data);
  /** While placing: the supply the previewed word would bring. */
  const preview =
    placing && supply && previewId && data.states.get(previewId) === 'conquered'
      ? { id: previewId, ...previewNode(supply, previewId) }
      : undefined;
  /** Lost words that one right answer still wins back as they were (core/fallen.ts). */
  const reclaimMap = new Map(
    [...data.game.nodes].flatMap(([id]) => {
      const f = reclaimable(data.game, data.states, id, now.getTime(), RECLAIM_MS);
      return f ? [[id, { ...f, until: f.at + RECLAIM_MS }] as const] : [];
    }),
  );
  // Claimed words waiting for their next step: when it opens and how long the wait is.
  const claimWaits = new Map(
    [...claims].flatMap(([id, c]) => {
      const next = data.states.get(id) === 'claimed' ? claimNext(c, CLAIM_GAPS) : null;
      if (!next || next.opensAt <= now.getTime()) return [];
      const total = next.step === 2 ? CLAIM_GAPS.step : CLAIM_GAPS.recall;
      return [[id, { opensAt: next.opensAt, total }] as const];
    }),
  );
  const attention = attentionList({
    raid: raided,
    states: data.states,
    claims,
    broken: brokenHang,
    fresh,
    nowMs: now.getTime(),
    gaps: CLAIM_GAPS,
    blocked: (id) => (cooldowns.get(id) ?? 0) > appMs(),
    reclaim: new Set(reclaimMap.keys()),
    due: new Set([
      ...queue.map((c) => c.nodeId),
      ...data.tenseCards
        .filter((c) => isDue(c.card, now) && !cooldowns.has(c.nodeId))
        .map((c) => c.nodeId),
    ]),
  });

  const states = [...data.states.values()];
  const conquered = states.filter((s) => s === 'conquered').length;
  const claimed = states.filter((s) => s === 'claimed').length;

  const wordOf = (id: string) => data.nodes.find((n) => n.id === id)?.it ?? id;
  const regionName = (r: number | undefined) =>
    data.graph.regions?.find((g) => g.id === r)?.name ?? 'no category';
  const tierName = (t: number | undefined) =>
    data.graph.params?.tier_names?.[String(t ?? 1)] ?? `tier ${t ?? 1}`;
  /** What can be planted next to a conquered word (core/plant.ts). */
  const plantChoices = (anchor: string) =>
    plantOptions({
      anchor,
      candidates: data.graph.candidates?.[anchor] ?? [],
      nodes: data.nodes,
      states: data.states,
      neighbours,
      openTier: progress?.tier ?? 1,
      cost: { base: PLANT_COST, perTierAhead: PLANT_COST_PER_TIER },
    }).map((o) => {
      const word = data.nodes.find((n) => n.id === o.id)!;
      return {
        ...o,
        word,
        category: regionName(word.region ?? undefined),
        level: tierName(word.tier),
      };
    });

  /** The selected word's place in your supply (NodeDetails). */
  const detailsSupply = (() => {
    if (!detailsWord || !supply) return undefined;
    const id = detailsWord.id;
    const st = data.states.get(id);
    const node = supplyNodes(data).includes(id);
    const cut = supplyView?.cut.get(id);
    return {
      value: supply.flow.value.get(id) ?? 0,
      min: SUPPLY.min,
      node: node ? (id === data.seed ? ('capital' as const) : ('node' as const)) : undefined,
      working: supply.working.has(id),
      broken: supply.broken.has(id),
      missed: data.game.nodes.get(id)?.missedAt !== undefined,
      cutUntil: cut && !supply.broken.has(id) ? cut.until : undefined,
      brokenUntil: cut && supply.broken.has(id) ? cut.until : undefined,
      hanging:
        st === 'conquered' && (!supply.cut.has(id) || supply.broken.has(id))
          ? hangingOn(supply, id).length
          : undefined,
      onLift:
        node && id !== data.seed
          ? async () => {
              await liftNode(id);
              setPlacing(true);
              setPreviewId(undefined);
            }
          : undefined,
    };
  })();
  const detailsDue = (() => {
    const cards = detailsWord ? (cardsByNode.get(detailsWord.id) ?? []) : [];
    return cards.length ? Math.min(...cards.map((c) => dueAt(c.card))) : undefined;
  })();

  const onRate = async (row: CardRow, grade: Grade, typed = true) => {
    const firstSight = unseen(cardsByNode.get(row.nodeId) ?? []);
    const outcome = await review(row, grade, typed);
    shown.current.delete(row.nodeId);
    if (outcome.levelUp) setLevelUp(outcome.levelUp);
    sfx(
      grade === Rating.Again
        ? firstSight
          ? 'learn'
          : 'miss'
        : outcome.levelUp
          ? 'levelUp'
          : outcome.conquered
            ? 'conquer'
            : 'correct',
    );
    if (outcome.opened && !outcome.levelUp) setTimeout(() => sfx('reveal'), 450);
    setLastCardId(row.id);
    setSelectedId(row.nodeId); // the next card comes from around this word
    setTurn((t) => t + 1);
    if (grade === Rating.Again) {
      // Locked for a minute either way, so recalling it needs real memory.
      setCooldowns((m) => new Map(m).set(row.nodeId, appMs() + COOLDOWN_MS));
      const n = outcome.cut;
      if (!firstSight)
        setNotice(`Missed${n ? ` · ${n} ${n === 1 ? 'word' : 'words'} cut off` : ''}`);
      setSession((s) => (s?.nodeId === row.nodeId ? null : s));
      // Stay on the missed word (locked) instead of jumping to the next card.
      setWaitOn({ nodeId: row.nodeId, reason: 'locked', note: firstSight ? 'new' : 'missed' });
      return;
    }
    if (outcome.roots) {
      setNotice(`⬢ ${outcome.roots.names.join(', ')} opened · +${outcome.roots.revealed} ?`);
      setTimeout(() => sfx('conquer'), 450);
    }
    const opened = outcome.opened && !outcome.levelUp ? `+${outcome.opened} ?` : '';
    const said = outcome.reclaimed
      ? 'Won back'
      : outcome.repaired !== undefined
        ? `Mended${outcome.repaired ? ` · ${outcome.repaired} reconnected` : ''}`
        : outcome.conquered
          ? `${wordOf(row.nodeId)} ✓`
          : outcome.claim
            ? claimNotice(outcome.claim, appNow(data.offsetDays).getTime())
            : '';
    if ((said || opened) && !outcome.roots) setNotice([said, opened].filter(Boolean).join(' · '));
    setSession((s) => {
      if (!s) return s;
      const rest = s.cardIds.filter((id) => id !== row.id);
      return rest.length ? { ...s, cardIds: rest } : null;
    });
  };

  /** Open the next conjugation step of a conquered verb, if one is available. */
  const startConjugate = (nodeId: string) => {
    const drill = nextDrill(
      data.tenseCards.filter((c) => c.nodeId === nodeId),
      now,
    );
    setSelectedId(nodeId);
    if (drill.kind === 'learn' || drill.kind === 'defend') {
      setSession(null);
      setInfo(null);
      setWaitOn(null);
      setVerbDrill({ nodeId, tense: drill.tense, kind: drill.kind });
    }
  };

  // Verbs that can satisfy the next tier's requirement (open tiers, conjugable).
  const verbGoals: VerbGoal[] = data.nodes
    .filter(
      (n) => n.conjugations && ((n.tier ?? 1) <= (progress?.tier ?? 1) || data.home.has(n.id)),
    )
    .map((n) => {
      const st = data.states.get(n.id) ?? 'locked';
      return {
        id: n.id,
        name:
          st === 'conquered'
            ? hintedName(n.it, health.get(n.id) ?? null, recall.has(n.id))
            : st === 'locked'
              ? ''
              : '?',
        state: st,
        level: verbLevels.get(n.id) ?? 0,
        drill:
          st === 'conquered'
            ? nextDrill(
                data.tenseCards.filter((c) => c.nodeId === n.id),
                now,
              )
            : null,
      };
    })
    // Furthest first: conjugated, conquered, discovered; undiscovered ones last.
    .sort(
      (a, b) =>
        b.level - a.level ||
        Number(b.state === 'conquered') - Number(a.state === 'conquered') ||
        Number(b.state !== 'locked') - Number(a.state !== 'locked'),
    );

  /** What the wait card says about a word that can't be worked on right now. */
  const waitCard = (w: NonNullable<typeof waitOn>) => {
    const hub = data.graph.roots?.find((r) => r.id === w.nodeId);
    const word = data.nodes.find((n) => n.id === w.nodeId);
    const title = hub ? hub.root : nameOf(w.nodeId) || '?';
    const subtitle = hub ? `${hub.lang ?? ''} root` : (word?.pos ?? undefined);
    const retry = (label: string) => ({ label, onClick: () => selectNode(w.nodeId) });
    const base = { title, subtitle, onNext: nextTask ? goNext : undefined };
    const left = Math.ceil(((cooldowns.get(w.nodeId) ?? 0) - appMs()) / 1000);
    const locked = {
      ...base,
      tone: 'locked' as const,
      message: `${w.note === 'new' ? 'New word · ' : ''}back in ${left} s`,
      progress: 1 - (left * 1000) / COOLDOWN_MS,
    };
    if (w.reason === 'root' && hub) {
      const english = hub.english?.length ? ` · ≈ ${hub.english.join(', ')}` : '';
      if (data.unlockedRoots.has(hub.id)) {
        return {
          ...base,
          tone: 'info' as const,
          message: `${hub.meaning ? `“${hub.meaning}”` : ''}${english}`,
        };
      }
      // Sealed: it opens by itself once enough of its words are supplied (core/roots.ts).
      const need = rootNeed(hub, ROOTS.open);
      const charge = rootCharges.get(hub.id) ?? 0;
      return {
        ...base,
        tone: 'reach' as const,
        message: `Opens with ${need} of its ${hub.words.length} words inside your supply`,
        progress: charge / need,
      };
    }
    if (w.reason === 'reach') {
      return {
        ...base,
        tone: 'reach' as const,
        message: 'Out of reach: conquer a word next to it',
      };
    }
    if (w.reason === 'locked') {
      return left > 0
        ? locked
        : { ...base, tone: 'waiting' as const, message: '', action: retry('Try again') };
    }
    const claim = data.game.nodes.get(w.nodeId)?.claim;
    const next = claimNext(claim, CLAIM_GAPS);
    if (next && next.opensAt > appMs()) {
      const total = next.step === 2 ? CLAIM_GAPS.step : CLAIM_GAPS.recall;
      return {
        ...base,
        tone: 'waiting' as const,
        message: claimNotice(claim ?? {}, appMs()),
        progress: 1 - (next.opensAt - appMs()) / total,
      };
    }
    return { ...base, tone: 'waiting' as const, message: '', action: retry('Continue') };
  };

  /**
   * The next thing to do when the panel is idle: an open claim step, else the
   * "?" nearest to where you are (an open step a couple of links further still wins).
   */
  const nextTask = (() => {
    const penalty = new Map<string, number>();
    for (const a of attention) {
      if (a.kind === 'ready' || a.kind === 'broken' || a.kind === 'reclaim') penalty.set(a.id, 0);
    }
    for (const [id, st] of data.states) {
      if (st === 'frontier' && !penalty.has(id)) penalty.set(id, 2);
    }
    for (const id of [...penalty.keys()]) {
      if ((cooldowns.get(id) ?? 0) > appMs() || id === waitOn?.nodeId) penalty.delete(id);
    }
    return closest(selectedId ?? data.seed, neighbours, penalty);
  })();
  const goNext = () => nextTask && selectNode(nextTask);

  const openNode = (nodeId: string, wait: (w: NonNullable<typeof waitOn>) => void) => {
    if (inspect) return setInspectId(nodeId);
    setInfo(null);
    setWaitOn(null);
    setPlanting(null);
    // Another word was clicked: leave the conjugation drill (no penalty).
    if (verbDrill && verbDrill.nodeId !== nodeId) setVerbDrill(null);
    setSelectedId(nodeId);
    if (fresh.has(nodeId)) setFresh((f) => new Set([...f].filter((id) => id !== nodeId)));
    // A root isn't asked: it opens by itself (core/roots.ts). The card says how far it is.
    if (data.graph.roots?.some((r) => r.id === nodeId)) return wait({ nodeId, reason: 'root' });
    if (ghosts.has(nodeId)) return wait({ nodeId, reason: 'reach' });
    if (!data.states.has(nodeId) || data.states.get(nodeId) === 'locked') return; // roots, hidden
    const until = cooldowns.get(nodeId);
    if (until && until > appMs()) return wait({ nodeId, reason: 'locked' });
    const st = data.states.get(nodeId);
    if (st === 'frontier' || st === 'claimed') {
      // Conquering goes one step at a time (core/claim.ts): recognise, produce, lock in.
      const claim = data.game.nodes.get(nodeId)?.claim;
      const next = claimNext(claim, CLAIM_GAPS);
      if (!next) return;
      if (next.opensAt > appMs()) return wait({ nodeId, reason: 'claim' });
      // Either way at step 3, but once a prompt is on show it stays (no peeking by reclicking).
      const dirs = next.directions.map((d) => ({ id: cardId(nodeId, d), nodeId }));
      const pick =
        dirs.find((c) => c.id === shown.current.get(nodeId)) ??
        dirs[Math.floor(Math.random() * dirs.length)];
      setSession({ nodeId, cardIds: [pick.id], mode: 'conquer' });
      setTurn((t) => t + 1);
      return;
    }
    const conquered = data.states.get(nodeId) === 'conquered';
    // Due (fading), broken or raided: a word can always be defended.
    const threatened =
      conquered &&
      ((health.get(nodeId) ?? 1) < FULL_NAME || raided.has(nodeId) || !!supply?.broken.has(nodeId));
    const next =
      conquered && !threatened
        ? nextPractice(
            (cardsByNode.get(nodeId) ?? []).map((c) => c.card),
            now,
          )
        : null;
    const node = data.nodes.find((n) => n.id === nodeId);
    if (next && node?.conjugations) {
      // Verbs level up tense by tense once the word itself is solid.
      const drill = nextDrill(
        data.tenseCards.filter((c) => c.nodeId === nodeId),
        now,
      );
      if (drill.kind === 'learn' || drill.kind === 'defend') {
        setSession(null);
        setVerbDrill({ nodeId, tense: drill.tense, kind: drill.kind });
        return;
      }
      if (drill.kind === 'wait') {
        const h = Math.max(1, Math.round((drill.until.getTime() - now.getTime()) / 3_600_000));
        setInfo({
          nodeId,
          status: `The ${drill.tense} opens in ~${h} h (one new tense per day).`,
        });
        return;
      }
      setInfo({ nodeId, status: `Fully conjugated: all ${TENSES.length} tenses!` });
      return;
    }
    if (next) {
      const days = (next.getTime() - now.getTime()) / 86_400_000;
      const when =
        days < 1 ? `${Math.max(1, Math.round(days * 24))} h` : `${Math.round(days)} days`;
      setInfo({
        nodeId,
        status: `Holding. Strength only grows with time: next review in ~${when}.`,
      });
      return;
    }
    // Only what is actually due; a fading word that isn't due yet is defended
    // with its weakest card. Asking the other, not-due direction right after
    // felt like the same question again. The order is fixed (openOrder): a
    // reshuffle on every click let you peek at the answer.
    // A raid is defended into Italian: the raid bar shows the English meaning.
    const own = (cardsByNode.get(nodeId) ?? []).filter(
      (c) => !raided.has(nodeId) || c.direction === 'en-it',
    );
    const due = openOrder(
      own.filter((c) => isDue(c.card, now)),
      shown.current.get(nodeId),
    );
    const weakest = [...own].sort(
      (a, b) => (retrievability(a.card, now) ?? 0) - (retrievability(b.card, now) ?? 0),
    )[0];
    const cards = due.length ? due : weakest ? [weakest] : [];
    if (!cards.length) return;
    setSession({ nodeId, cardIds: cards.map((c) => c.id), mode: 'practice' });
    setTurn((t) => t + 1);
  };

  /** Click / arrow / jump on a word: a tick, or a dull tap when it can't be opened now. */
  const selectNode = (nodeId: string) => {
    if (placing) return void placeHere(nodeId);
    let blocked = false;
    openNode(nodeId, (w) => {
      blocked = true;
      setWaitOn(w);
    });
    if (!inspect) sfx(blocked ? 'blocked' : 'select');
  };

  /** Put the earned supply node on a word you hold (placing mode). */
  const placeHere = async (nodeId: string) => {
    if (!(await placeNode(nodeId))) {
      setNotice('Place it on a word you hold');
      sfx('blocked');
      return;
    }
    setPlacing(false);
    setPreviewId(undefined);
    setNotice(`⚡ ${wordOf(nodeId)} supplies its area`);
    sfx('conquer');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-10 flex items-center gap-2.5 border-b border-white/[0.06] bg-slate-950/80 px-4 py-2 shadow-[0_8px_30px_-20px_rgba(0,0,0,0.9)] backdrop-blur">
        <h1 className="mr-2 flex select-none items-center gap-2">
          <Logo />
          <span className="font-title text-lg font-bold tracking-[0.16em] text-emerald-200 [text-shadow:0_0_18px_rgba(52,211,153,0.5)]">
            Sprawl
          </span>
        </h1>
        {progress && (
          <button onClick={() => setShowVerbGoals((v) => !v)} className="chip py-1">
            <TierBadge
              p={progress}
              names={data.graph.params?.tier_names}
              // Words being conquered (claimed) in the open tiers: shown as progress too.
              claimed={
                data.nodes.filter(
                  (n) =>
                    ((n.tier ?? 1) <= progress.tier || data.home.has(n.id)) &&
                    data.states.get(n.id) === 'claimed',
                ).length
              }
            />
          </button>
        )}
        {inspect && (
          <button
            onClick={() => setInspect(false)}
            className="btn rounded-full bg-gradient-to-b from-pink-500 to-pink-700 px-3 py-0.5 text-sm text-white shadow-[0_6px_20px_-8px_rgba(236,72,153,0.9)] hover:from-pink-400"
          >
            Whole network ✕
          </button>
        )}
        <button
          onClick={async () => {
            if (data.expedition) return;
            if (await startExpedition()) sfx('reveal');
            else setNotice('No open words for an expedition');
          }}
          disabled={!!data.expedition || !data.started}
          title={`Expedition: take ${EXPEDITION.goal} words of one category in ${EXPEDITION.minutes} min for 🪙${EXPEDITION.coins}`}
          className="chip ml-auto text-sky-300 disabled:opacity-40"
        >
          ⚑
        </button>
        <button
          onClick={() => setShowProgress((v) => !v)}
          title={`Streak: ${days.current} ${days.current === 1 ? 'day' : 'days'}${days.playedToday ? '' : ' (play today to keep it)'} · best ${days.best}`}
          className={`chip ${days.playedToday ? 'text-orange-300' : 'text-slate-500'}`}
        >
          🔥 {days.current}
        </button>
        <button
          onClick={() => setShowProgress((v) => !v)}
          title="Score and achievements"
          className={`chip ${
            showProgress ? 'border-amber-400/40 bg-amber-500/20 text-amber-100' : 'text-amber-300'
          }`}
        >
          🏆 {score.toLocaleString()} <span className="ml-1.5 text-slate-300">🪙 {data.coins}</span>
        </button>
        <Menu
          graphName={graphName}
          showRoots={showRoots}
          onRoots={setShowRoots}
          inspect={inspect}
          onInspect={setInspect}
          onGuide={() => setShowGuide(true)}
          offsetDays={data.offsetDays}
          onTravel={timeTravel}
          speechToggle
          runId={runId}
          onNewRun={() => {
            newRun(graphName);
            window.location.reload();
          }}
          onSwitchRun={(id) => {
            switchRun(graphName, id);
            window.location.reload();
          }}
          onDeleteRun={(id) => deleteRun(graphName, id, dbName(graphName, runDbSuffix(id)))}
          onRestart={async () => {
            setSession(null);
            setSelectedId(undefined);
            await reset();
          }}
        />
      </header>
      {showGuide && <Guide onClose={() => setShowGuide(false)} />}
      <main className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1">
          {levelUp && (
            <div className="rise-in absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-xl border border-amber-300/60 bg-gradient-to-b from-amber-500/25 to-amber-950/50 px-6 py-3 text-center shadow-[0_0_40px_rgba(251,191,36,0.35)] backdrop-blur-md">
              <div className="font-title text-xl font-bold tracking-wider text-amber-200">
                {data.graph.params?.tier_names?.[String(levelUp.tier)] ?? `Tier ${levelUp.tier}`}{' '}
                open
              </div>
              <div className="text-sm text-amber-100/80">+{levelUp.revealed} words</div>
            </div>
          )}
          {verbUp && !levelUp && <VerbUpBanner word={wordOf(verbUp.nodeId)} level={verbUp.level} />}
          {earnedNow.length > 0 && !levelUp && !verbUp && <AchievementBanner earned={earnedNow} />}
          {event && <EventBanner key={event.at} event={event} />}
          <Missions
            expedition={expedition}
            raid={data.raid.active}
            nowMs={appMs()}
            wordName={(id) => nameOf(id) || '?'}
            meaning={(id) => data.nodes.find((n) => n.id === id)?.en ?? '?'}
            onRaidWord={(id) => selectNode(id)}
          />
          {notice && (
            <div className="glass rise-in pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full px-4 py-1.5 text-sm text-slate-100">
              {notice}
            </div>
          )}
          {!data.started && (
            <StartPicker
              regions={data.graph.regions ?? []}
              nodes={data.nodes}
              edges={data.graph.edges}
              onPick={async (region, capital) => {
                const seed = capital ?? pickStart(data.nodes, data.graph.edges, region);
                if (!seed) return;
                setSelectedId(undefined);
                await reset(seed);
                // The run is named after where it began.
                updateRun(graphName, runId, {
                  name: region === undefined ? `Anywhere · ${wordOf(seed)}` : regionName(region),
                });
                sfx('reveal');
              }}
            />
          )}
          <GraphView
            key={data.seed}
            data={data}
            health={health}
            activeId={inspect ? inspectId : panelId}
            strength={strength}
            verbLevels={verbLevels}
            nowMs={now.getTime()}
            claims={claims}
            claimWaits={claimWaits}
            supply={supplyView ?? undefined}
            ghosts={ghosts}
            preview={preview && { id: preview.id, value: preview.flow.value }}
            reclaim={reclaimMap}
            hints={
              new Map(
                [...data.hints].flatMap((id) => {
                  const w = data.nodes.find((n) => n.id === id);
                  return w?.cognate && data.states.get(id) !== 'locked'
                    ? [[id, w.cognate] as const]
                    : [];
                }),
              )
            }
            attention={attention}
            answerId={answerId}
            recall={recall}
            unlockedRoots={data.unlockedRoots}
            rootCharge={
              new Map(
                [...rootCharges].map(([id, c]) => {
                  const hub = data.graph.roots!.find((r) => r.id === id)!;
                  return [id, c / rootNeed(hub, ROOTS.open)] as const;
                }),
              )
            }
            cooldowns={cooldowns}
            inspect={inspect}
            showRoots={showRoots}
            onNodeClick={selectNode}
            onNodeHover={placing ? setPreviewId : undefined}
          />
        </section>
        <aside
          className={`flex w-80 flex-col gap-3 overflow-y-auto border-l border-white/[0.06] bg-gradient-to-b from-slate-950 to-[#050a1a] p-4 ${data.started ? '' : 'invisible'}`}
        >
          {showProgress && !inspect && (
            <ProgressPanel
              score={score}
              clusters={clusters}
              regionName={regionName}
              achievements={data.achievements}
              coins={data.coins}
              counts={{
                conquered,
                claimed,
                discovered: states.filter((st) => st !== 'locked').length,
                total: data.nodes.length,
              }}
              activity={data.activity}
              streak={days}
              now={now}
              onClose={() => setShowProgress(false)}
            />
          )}
          {showVerbGoals && progress && progress.pointsNeed > 0 && !inspect && (
            <VerbGoals
              goals={verbGoals}
              have={progress.verbPoints}
              need={progress.pointsNeed}
              nextTier={
                data.graph.params?.tier_names?.[String(progress.tier + 1)] ??
                `tier ${progress.tier + 1}`
              }
              nowMs={now.getTime()}
              onSelect={(id) => selectNode(id)}
              onConjugate={(id) => startConjugate(id)}
              onClose={() => setShowVerbGoals(false)}
            />
          )}
          {inspect ? (
            <InspectPanel
              data={data}
              health={health}
              selectedId={inspectId}
              onSelect={setInspectId}
            />
          ) : (
            <>
              {toPlace > 0 && !placing && (
                <button
                  onClick={() => {
                    setPlacing(true);
                    setPreviewId(undefined);
                    sfx('select');
                  }}
                  className="panel flex w-full shrink-0 items-center justify-between rounded-xl border-amber-300/40 px-3 py-2 text-left text-sm text-amber-100 hover:border-amber-300/80"
                  title="A supply node keeps the words around it supplied: put it where it counts"
                >
                  <span>⚡ Supply node ready{toPlace > 1 ? ` ×${toPlace}` : ''}</span>
                  <span className="text-xs text-amber-300">Place it</span>
                </button>
              )}
              {placing && supply ? (
                <PlacePanel
                  data={data}
                  supply={supply}
                  nameOf={(id) => nameOf(id) || wordOf(id)}
                  regionName={(id) => regionName(regionOf(id))}
                  preview={preview}
                  onPreview={setPreviewId}
                  onPlace={placeHere}
                  onClose={() => {
                    setPlacing(false);
                    setPreviewId(undefined);
                  }}
                />
              ) : planting && data.states.get(planting) === 'conquered' ? (
                <PlantPicker
                  key={planting}
                  anchorName={wordOf(planting)}
                  anchorCategory={regionName(regionOf(planting))}
                  options={plantChoices(planting)}
                  coins={data.coins}
                  onClose={() => setPlanting(null)}
                  onPlant={async (o) => {
                    const anchor = planting;
                    if (!(await plant(anchor, o))) return;
                    setPlanting(null);
                    sfx('plant');
                    const w = data.nodes.find((n) => n.id === o.id);
                    setNotice(`🌱 “${w?.en}”`);
                  }}
                />
              ) : waitOn ? (
                <WaitCard
                  key={`${waitOn.nodeId}:${waitOn.reason}`}
                  {...waitCard(waitOn)}
                  onClose={() => setWaitOn(null)}
                />
              ) : activeDrill ? (
                <VerbDrill
                  key={`${activeDrill.nodeId}:${activeDrill.tense}:${turn}`}
                  word={data.nodes.find((n) => n.id === activeDrill.nodeId)!}
                  tense={activeDrill.tense}
                  kind={activeDrill.kind}
                  onCancel={() => {
                    setVerbDrill(null);
                    if (!verbDrill)
                      setCooldowns((m) =>
                        new Map(m).set(activeDrill.nodeId, appMs() + COOLDOWN_MS),
                      );
                  }}
                  onDone={async (grade) => {
                    const { nodeId, tense, kind } = activeDrill;
                    setVerbDrill(null);
                    setTurn((t) => t + 1);
                    const lv = await reviewTense(nodeId, tense, grade);
                    if (lv) setLevelUp(lv);
                    sfx(
                      grade === Rating.Again
                        ? 'miss'
                        : lv
                          ? 'levelUp'
                          : kind === 'learn'
                            ? 'verbUp'
                            : 'correct',
                    );
                    if (grade === Rating.Again) {
                      setCooldowns((m) => new Map(m).set(nodeId, appMs() + COOLDOWN_MS));
                      setWaitOn({ nodeId, reason: 'locked' });
                    } else if (kind === 'learn') {
                      setVerbUp({ nodeId, level: TENSES.indexOf(tense) + 1 });
                    }
                  }}
                />
              ) : info && data.nodes.some((n) => n.id === info.nodeId) ? (
                <WordInfo
                  key={info.nodeId}
                  word={data.nodes.find((n) => n.id === info.nodeId)!}
                  strength={nodeStrength((cardsByNode.get(info.nodeId) ?? []).map((c) => c.card))}
                  status={info.status}
                  verbLevel={verbLevels.get(info.nodeId)}
                  tenseCards={data.tenseCards.filter((c) => c.nodeId === info.nodeId)}
                  onClose={() => setInfo(null)}
                />
              ) : (
                <ReviewView
                  key={turn}
                  onShow={(row) => shown.current.set(row.nodeId, row.id)}
                  data={data}
                  current={current}
                  mode={mode}
                  dueCount={dueCount}
                  elsewhere={
                    queue.filter((c) => !isNear(c.nodeId)).length +
                    data.tenseCards.filter((c) => c.card.due <= now && !isNear(c.nodeId)).length
                  }
                  onNext={nextTask ? goNext : undefined}
                  reclaim={current ? reclaimMap.get(current.nodeId) : undefined}
                  nowMs={now.getTime()}
                  claimStep={
                    current &&
                    ['frontier', 'claimed'].includes(data.states.get(current.nodeId) ?? '')
                      ? claimNext(data.game.nodes.get(current.nodeId)?.claim, CLAIM_GAPS)
                      : undefined
                  }
                  onRate={onRate}
                  onCancel={() => {
                    setSession(null);
                    setTurn((t) => t + 1);
                  }}
                />
              )}
            </>
          )}
          {!inspect && detailsWord && (
            <NodeDetails
              key={detailsWord.id}
              word={detailsWord}
              state={data.states.get(detailsWord.id) ?? 'locked'}
              name={nameOf(detailsWord.id)}
              health={health.get(detailsWord.id) ?? null}
              memory={
                data.states.get(detailsWord.id) === 'conquered'
                  ? {
                      ...nodeStrength((cardsByNode.get(detailsWord.id) ?? []).map((c) => c.card)),
                      recall: nodeHealth(
                        (cardsByNode.get(detailsWord.id) ?? []).map((c) => c.card),
                        now,
                      ),
                    }
                  : undefined
              }
              supply={detailsSupply}
              due={detailsDue}
              nowMs={appNow(data.offsetDays).getTime()}
              claimStep={claimNext(data.game.nodes.get(detailsWord.id)?.claim, CLAIM_GAPS)}
              links={
                data.states.get(detailsWord.id) === 'conquered'
                  ? {
                      ...wordLinks(detailsWord.id, data.edges, regionOf),
                      category: regionName(regionOf(detailsWord.id)),
                    }
                  : undefined
              }
              onPlant={
                data.states.get(detailsWord.id) === 'conquered' && planting !== detailsWord.id
                  ? () => {
                      setWaitOn(null);
                      setInfo(null);
                      setPlanting(detailsWord.id);
                      sfx('select');
                    }
                  : undefined
              }
              coins={data.coins}
              hint={
                detailsWord.cognate && data.states.get(detailsWord.id) !== 'locked'
                  ? {
                      cognate: detailsWord.cognate,
                      bought: data.hints.has(detailsWord.id),
                      cost: HINT_COST,
                      onBuy: async () => {
                        if (!(await buyHint(detailsWord.id))) return;
                        sfx('plant');
                        setNotice(`≈ ${detailsWord.cognate}`);
                      },
                    }
                  : undefined
              }
              reclaim={reclaimMap.get(detailsWord.id)}
              verb={
                detailsWord.conjugations && data.states.get(detailsWord.id) === 'conquered'
                  ? {
                      level: verbLevels.get(detailsWord.id) ?? 0,
                      drill: nextDrill(
                        data.tenseCards.filter((c) => c.nodeId === detailsWord.id),
                        now,
                      ),
                    }
                  : undefined
              }
              onConjugate={() => startConjugate(detailsWord.id)}
              // Always there for your words, except while one is being asked (a hint).
              showEtymology={
                session?.nodeId !== detailsWord.id && current?.nodeId !== detailsWord.id
              }
            />
          )}
        </aside>
      </main>
    </div>
  );
}

/** When a claim's next step opens, e.g. "step 2/3 in 45 s". */
function claimNotice(claim: Claim, nowMs: number): string {
  const next = claimNext(claim, CLAIM_GAPS);
  if (!next) return '';
  const wait = next.opensAt - nowMs;
  if (wait <= 0) return `step ${next.step}/${CLAIM_STEPS} ready`;
  const when = wait < 90_000 ? `${Math.ceil(wait / 1000)} s` : `${Math.ceil(wait / 60_000)} min`;
  return `step ${next.step}/${CLAIM_STEPS} in ${when}`;
}

/** The mark: a hex territory holding three linked words (also public/favicon.svg). */
function Logo() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="h-6 w-6 drop-shadow-[0_0_6px_rgba(52,211,153,0.6)]"
      aria-hidden
    >
      <defs>
        <radialGradient id="logo-orb" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#d1fae5" />
          <stop offset="0.45" stopColor="#34d399" />
          <stop offset="1" stopColor="#065f46" />
        </radialGradient>
      </defs>
      <path
        d="M16 2 28.1 9v14L16 30 3.9 23V9Z"
        fill="#052e2b"
        stroke="#34d399"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M16 10.5 10 20.5M16 10.5l6 10M10 20.5h12"
        stroke="#6ee7b7"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="16" cy="10.5" r="3.6" fill="url(#logo-orb)" />
      <circle cx="10" cy="20.5" r="2.9" fill="url(#logo-orb)" />
      <circle cx="22" cy="20.5" r="2.9" fill="url(#logo-orb)" />
    </svg>
  );
}

/** A verb mastered a new tense: a moment to be proud of. */
function VerbUpBanner({ word, level }: { word: string; level: number }) {
  return (
    <div className="rise-in pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-xl border border-amber-300/70 bg-gradient-to-b from-amber-500/30 to-amber-950/60 px-6 py-3 text-center shadow-[0_0_50px_rgba(251,191,36,0.45)] backdrop-blur-md">
      <div className="font-title text-xs font-semibold uppercase tracking-[0.25em] text-amber-200/80">
        Verb level up
      </div>
      <div className="text-2xl font-bold text-amber-100">{word}</div>
      <div className="mt-1 text-sm text-amber-100">
        {level > 1 ? TENSES[level - 2] : 'infinitive'} →{' '}
        <b className="text-amber-300">{TENSES[level - 1]}</b>
      </div>
      <div className="mt-2 flex justify-center gap-1">
        {TENSES.map((t, i) => (
          <span
            key={t}
            title={t}
            className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] ${
              i < level
                ? 'bg-amber-400 font-semibold text-slate-900'
                : 'border border-amber-400/30 text-amber-200/40'
            }`}
          >
            ★ {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Newly earned achievements, celebrated over the map. */
function AchievementBanner({ earned }: { earned: Achievement[] }) {
  const coins = earned.reduce((n, a) => n + a.coins, 0);
  return (
    <div className="glass rise-in pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-xl border-amber-300/50 px-5 py-2 text-center shadow-[0_0_40px_rgba(251,191,36,0.3)]">
      <div className="text-lg font-semibold text-amber-200">
        🏆 {earned.map((a) => a.title).join(' · ')}
      </div>
      <div className="text-xs text-amber-100/70">
        {earned.length === 1 && `${earned[0].description} · `}+{coins} 🪙
      </div>
    </div>
  );
}

function TierBadge({
  p,
  names,
  claimed = 0,
}: {
  p: TierProgress;
  /** Display names per tier, e.g. CEFR levels. */
  names?: Record<string, string> | null;
  /** Words in the open tiers being conquered right now (not counted yet, but on the way). */
  claimed?: number;
}) {
  const name = (t: number) => names?.[String(t)] ?? `tier ${t}`;
  const pct = p.needed ? Math.min(1, p.conquered / p.needed) : 1;
  const pending = p.needed ? Math.min(1 - pct, claimed / p.needed) : 0;
  return (
    <span
      className="flex items-center gap-2 text-sm text-slate-300"
      title={
        p.needed
          ? `${name(p.tier + 1)}: ${p.needed} words` +
            (claimed ? ` (${claimed} on the way)` : '') +
            (p.pointsNeed
              ? ` and ${p.pointsNeed} verb points, ${p.verbPoints} so far (each tense learned of a verb is one)`
              : '')
          : 'All levels open'
      }
    >
      <span className="font-semibold text-amber-300">
        {names ? name(p.tier) : `Tier ${p.tier}/${p.maxTier}`}
      </span>
      {p.needed > 0 && (
        <>
          <span className="flex h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.08]">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
              style={{ width: `${pct * 100}%` }}
            />
            {/* Claimed words: striped, on their way to being counted. */}
            <span
              className="block h-full"
              style={{
                width: `${pending * 100}%`,
                background:
                  'repeating-linear-gradient(135deg, rgba(251,191,36,0.75) 0 3px, transparent 3px 6px)',
              }}
            />
          </span>
          <span className="text-xs text-slate-500">
            {p.conquered}/{p.needed}
            {p.pointsNeed > 0 && ` · ▲${p.verbPoints}/${p.pointsNeed}`}
          </span>
        </>
      )}
    </span>
  );
}

/** Top-left over the map: the expedition and the raid under way, with their clocks. */
function Missions(props: {
  expedition: { name: string; goal: number; taken: number; until: number } | null;
  raid?: { targets: string[]; defended: string[]; until: number };
  nowMs: number;
  wordName: (id: string) => string;
  /** Raided words are asked into Italian, so the bar names them in English. */
  meaning: (id: string) => string;
  onRaidWord: (id: string) => void;
}) {
  const { expedition, raid, nowMs } = props;
  const clock = (until: number) => {
    const s = Math.max(0, Math.ceil((until - nowMs) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  if (!expedition && !raid) return null;
  return (
    <div className="absolute left-3 top-3 z-10 space-y-1.5 text-xs">
      {expedition && (
        <div
          className="glass rounded-lg px-2.5 py-1.5 text-sky-200"
          title="Expedition: claim or conquer words of this category before time runs out"
        >
          ⚑ {expedition.name}{' '}
          <b>
            {expedition.taken}/{expedition.goal}
          </b>{' '}
          <span className="font-mono text-slate-400">{clock(expedition.until)}</span>
        </div>
      )}
      {raid && (
        <div
          className="rounded-lg border border-orange-500/50 bg-orange-950/80 px-2.5 py-1.5 text-orange-200 shadow-[0_0_30px_-8px_rgba(249,115,22,0.6)] backdrop-blur-md"
          title="Raid: answer each raided word right before time runs out, or it breaks and cuts off what hangs on it"
        >
          ⚔ Raid <span className="font-mono text-orange-300">{clock(raid.until)}</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {raid.targets.map((id) =>
              raid.defended.includes(id) ? (
                <span key={id} className="rounded bg-emerald-900/60 px-1.5 text-emerald-200">
                  ✓ {props.wordName(id)}
                </span>
              ) : (
                <button
                  key={id}
                  onClick={() => props.onRaidWord(id)}
                  className="rounded bg-orange-800/70 px-1.5 hover:bg-orange-700"
                >
                  {props.meaning(id)}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A moment the game made on its own: raid, expedition end, supply node. Fades by itself. */
function EventBanner({ event }: { event: GameEvent }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    sfx(
      event.kind === 'raid' || event.kind === 'raid-lost' || event.kind === 'expedition-lost'
        ? 'lost'
        : 'achievement',
    );
    const t = setTimeout(() => setShown(false), 4500);
    return () => clearTimeout(t);
  }, [event]);
  if (!shown) return null;
  const [title, sub, tone] = eventText(event);
  const cls = {
    orange: 'border-orange-400/70 text-orange-200',
    emerald: 'border-emerald-400/70 text-emerald-200',
    slate: 'border-slate-500 text-slate-300',
    amber: 'border-amber-300/70 text-amber-200',
  }[tone as 'orange' | 'emerald' | 'slate' | 'amber'];
  return (
    <div
      className={`glass rise-in pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-xl px-5 py-2 text-center ${cls}`}
    >
      <div className="text-lg font-semibold">{title}</div>
      <div className="text-xs opacity-80">{sub}</div>
    </div>
  );
}

function eventText(e: GameEvent): [string, string, string] {
  const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;
  switch (e.kind) {
    case 'raid':
      return ['⚔ Raid!', `Defend ${words(e.count)} in ${RAID.durationMs / 60_000} min`, 'orange'];
    case 'raid-won':
      return ['⚔ Raid repelled', `+${e.coins} 🪙`, 'emerald'];
    case 'raid-lost':
      return ['⚔ The raid hit', `${words(e.count)} broken: mend them`, 'orange'];
    case 'expedition-won':
      return ['⚑ Expedition done', `+${e.coins} 🪙`, 'emerald'];
    case 'expedition-lost':
      return ['⚑ Expedition over', 'Out of time', 'slate'];
    case 'supply':
      return [
        `⚡ Supply node${e.count > 1 ? ` ×${e.count}` : ''} earned`,
        'Place it on a word you hold',
        'amber',
      ];
  }
}

/** A raid target not defended yet (core/raid.ts). */
function isRaided(data: AppData, id: string) {
  const raid = data.raid.active;
  return !!raid && raid.targets.includes(id) && !raid.defended.includes(id);
}
