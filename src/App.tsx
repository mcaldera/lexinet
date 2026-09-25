import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  CLAIM_GAPS,
  COOLDOWN_MS,
  DANGER_MS,
  INFLUENCE,
  HINT_COST,
  PLANT_COST,
  PLANT_COST_PER_TIER,
  REACH,
  RECLAIM_MS,
} from './config';
import { dangers } from './core/danger';
import { reclaimable } from './core/fallen';
import { attentionList, newlyRevealed } from './core/attention';
import {
  claimNext,
  CLAIM_STEP_NAMES,
  CLAIM_STEPS,
  claimSteps,
  unseen,
  type Claim,
} from './core/claim';
import { FULL_NAME, fadedName } from './core/fade';
import { cohesion, isHostile, neighbourWeights, pressureBreakdown } from './core/influence';
import { appNow, startOfDay } from './core/clock';
import { nodeHealth } from './core/health';
import { buildQueue, nearby } from './core/queue';
import { tierAllows, tierMap, type TierProgress } from './core/tiers';
import { pushOf, reachMap, reachSources, sightedWords } from './core/reach';
import { neighbourMap } from './core/unlock';
import { nextDrill, TENSES, type Tense } from './core/verbs';
import { computeProgress, reachInput, verbLevels as computeVerbLevels } from './progress';
import { cardId, DIRECTIONS, Rating, type Grade } from './core/scheduler';
import type { NodeState } from './core/unlock';
import { nextPractice, nodeStrength } from './core/strength';
import type { CardRow } from './db/repo';
import { GRAPH_NAMES, graphLabel } from './graphs';
import { useSprawl, type LevelUp } from './useSprawl';
import DebugPanel from './views/DebugPanel';
import GraphView from './views/GraphView';
import InspectPanel from './views/InspectPanel';
import ReviewView from './views/ReviewView';
import RootQuiz from './views/RootQuiz';
import VerbDrill from './views/VerbDrill';
import WordInfo from './views/WordInfo';
import WaitCard from './views/WaitCard';
import ProgressPanel from './views/ProgressPanel';
import PlantPicker from './views/PlantPicker';
import { clusterScores, totalScore, wordLinks } from './core/score';
import { newlyEarned, type Achievement, type Stats } from './core/achievements';
import { plantOptions } from './core/plant';
import { audioSettings, onAudioSettings, resumeOnGesture, setMusic, setSfx, sfx } from './audio';
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
    unlockRoot,
    earnAchievements,
    plant,
    buyHint,
    timeTravel,
    reset,
    graphName,
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
  const [rootQuiz, setRootQuiz] = useState<string | null>(null);
  /** Last word clicked or reached with the arrow keys: shown in the details panel. */
  const [selectedId, setSelectedId] = useState<string>();
  const [showVerbGoals, setShowVerbGoals] = useState(false);
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
      `Slipped away: ${names.join(', ')}. One right answer within ${RECLAIM_MS / 86_400_000} days wins ${lost.ids.length === 1 ? 'it' : 'them'} back as ${lost.ids.length === 1 ? 'it was' : 'they were'}.`,
    );
    sfx('lost');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lost]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
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
          ? // Displayed health: memory, but no more than the word's control.
            Math.min(
              nodeHealth(
                cards.map((c) => c.card),
                now,
              ) ?? 1,
              data.game.nodes.get(id)?.control ?? 1,
            )
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
    () => (data ? computeProgress(data.nodes, data.states, data.tenseCards, now) : null),
    [data, now],
  );
  const weights = useMemo(() => neighbourWeights(data?.edges ?? []), [data?.edges]);
  const neighbours = useMemo(() => neighbourMap(data?.edges ?? []), [data?.edges]);
  const hostileSet = useMemo(
    () =>
      new Set(
        data
          ? [...data.states]
              .filter(
                ([id, st]) =>
                  isHostile(data.game.nodes.get(id), st, now.getTime(), INFLUENCE) ||
                  (st === 'conquered' &&
                    (data.game.nodes.get(id)?.control ?? 1) < INFLUENCE.rebelBelow),
              )
              .map(([id]) => id)
          : [],
      ),
    [data, now],
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
  const clusters = useMemo(
    () => (data ? clusterScores(data.states, data.edges, regionOf) : []),
    [data, regionOf],
  );
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
  // How far the territory pushes: all reach, and the hidden words it lets you see.
  const reachIn = useMemo(
    () =>
      data
        ? reachInput(
            data.nodes,
            neighbours,
            data.states,
            new Map([...data.game.nodes].map(([id, g]) => [id, g.claim])),
            data.graph.seed,
            verbLevels,
          )
        : null,
    [data, neighbours, verbLevels],
  );
  const reach = useMemo(() => (reachIn ? reachMap(reachIn) : new Map<string, number>()), [reachIn]);
  const sighted = useMemo(
    () =>
      data && progress
        ? sightedWords(data.states, reach, REACH, tierAllows(tierMap(data.nodes), progress.tier))
        : new Map<string, number>(),
    [data, reach, progress],
  );

  const queue = useMemo(() => {
    if (!data) return [];
    // Words being conquered only offer the card of their open claim step.
    const stepOpen = (c: CardRow) => {
      const st = data.states.get(c.nodeId);
      if (st !== 'frontier' && st !== 'claimed') return true;
      const next = claimNext(data.game.nodes.get(c.nodeId)?.claim, CLAIM_GAPS);
      return !!next && next.directions.includes(c.direction) && next.opensAt <= now.getTime();
    };
    return buildQueue({ cards: data.cards, states: data.states, now, lastCardId }).filter(
      (c) => !cooldowns.has(c.nodeId) && stepOpen(c),
    );
  }, [data, now, lastCardId, cooldowns]);

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
          (c) => c.card.due <= now && !cooldowns.has(c.nodeId) && isNear(c.nodeId),
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
    (activeDrill && !rootQuiz ? activeDrill.nodeId : undefined) ??
    (info && !rootQuiz ? info.nodeId : undefined) ??
    rootQuiz ??
    current?.nodeId ??
    selectedId;
  // The word whose Italian name is the answer being asked: hidden everywhere meanwhile.
  const answerId =
    !waitOn && !activeDrill && !info && !rootQuiz && current?.direction === 'en-it'
      ? current.nodeId
      : undefined;
  const nameOf = (id: string) => {
    if (data.states.get(id) !== 'conquered' || id === answerId) return '';
    const w = data.nodes.find((n) => n.id === id);
    return w ? fadedName(w.it, health.get(id) ?? null) : '';
  };
  const detailsInfluences = !detailsWord
    ? []
    : data.states.get(detailsWord.id) === 'conquered'
      ? pressureBreakdown(
          detailsWord.id,
          data.game.nodes,
          data.states,
          weights,
          verbLevels,
          now.getTime(),
          INFLUENCE,
          data.hints,
        )
      : (weights.get(detailsWord.id) ?? [])
          .filter((n) => data.states.get(n.id) === 'conquered')
          .map((n) => ({
            id: n.id,
            kind: 'attack' as const,
            perDay: -INFLUENCE.hostilePressure * n.weight,
          }));

  const claims = new Map([...data.game.nodes].map(([id, g]) => [id, g.claim]));
  /** Claimed words endangered by a miss: deadline and the word to win back. */
  const dangerMap = dangers(data.game, data.states);
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
    states: data.states,
    claims,
    health,
    hostile: hostileSet,
    fresh,
    nowMs: now.getTime(),
    gaps: CLAIM_GAPS,
    blocked: (id) => (cooldowns.get(id) ?? 0) > appMs(),
    danger: dangerMap,
    reclaim: new Set(reclaimMap.keys()),
    due: new Set([
      ...queue.map((c) => c.nodeId),
      ...data.tenseCards
        .filter((c) => c.card.due <= now && !cooldowns.has(c.nodeId))
        .map((c) => c.nodeId),
    ]),
  });

  const today = startOfDay(now).getTime();
  const newToday = [...data.firstReview.values()].filter(
    (iso) => new Date(iso).getTime() >= today,
  ).length;

  const states = [...data.states.values()];
  const conquered = states.filter((s) => s === 'conquered').length;
  const frontier = states.filter((s) => s === 'frontier').length;
  const claimed = states.filter((s) => s === 'claimed').length;
  const hs = [...health.values()].filter((h): h is number => h !== null);
  const avg = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;

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
      return { ...o, word, category: regionName(word.region), level: tierName(word.tier) };
    });

  // Push (core/reach.ts): how hard each won word pushes, and who pushes the selected word.
  const pushes = new Map(
    [...data.states]
      .filter(([, st]) => st !== 'locked')
      .map(([id]) => [id, reachIn ? pushOf(reachIn, id) : 0] as const)
      .filter(([, v]) => v > 0),
  );
  const pushWhy = (id: string) => {
    const w = data.nodes.find((n) => n.id === id);
    const parts: string[] = [];
    if (data.states.get(id) === 'claimed') {
      parts.push(`claimed, ${claimSteps(claims.get(id))}/${CLAIM_STEPS} steps`);
    }
    const factor = REACH.pos[w?.pos?.toLowerCase() ?? ''];
    if (factor && factor !== 1) parts.push(`${w?.pos} ×${factor}`);
    const vl = verbLevels.get(id) ?? 0;
    if (vl)
      parts.push(
        `${vl} ${vl === 1 ? 'tense' : 'tenses'} +${Math.round(vl * REACH.verbLevelBonus * 100)}%`,
      );
    if (id === data.graph.seed) parts.push('your home');
    return parts.join(', ') || 'conquered';
  };
  const detailsState = detailsWord ? data.states.get(detailsWord.id) : undefined;
  const detailsReach =
    detailsWord && reachIn && (sighted.has(detailsWord.id) || detailsState === 'frontier')
      ? reachSources(reachIn, detailsWord.id).slice(0, 6)
      : null;

  const onRate = async (row: CardRow, grade: Grade) => {
    const firstSight = unseen(cardsByNode.get(row.nodeId) ?? []);
    const outcome = await review(row, grade);
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
      const n = outcome.endangered.length;
      setNotice(
        firstSight
          ? `New word: ${wordOf(row.nodeId)}. Come back in ${COOLDOWN_MS / 1000} s to claim it from memory.`
          : `Missed! ${wordOf(row.nodeId)} fell and turns against you (locked ${COOLDOWN_MS / 1000} s).` +
              (n
                ? ` ${n} fragile ${n === 1 ? 'claim next to it is' : 'claims next to it are'} in danger: win it back within ${DANGER_MS / 60_000} min or ${n === 1 ? 'it falls' : 'they fall'} too.`
                : ''),
      );
      setSession((s) => (s?.nodeId === row.nodeId ? null : s));
      // Stay on the missed word (locked) instead of jumping to the next card.
      setWaitOn({
        nodeId: row.nodeId,
        reason: 'locked',
        note: firstSight
          ? 'New word: recognise it from memory when the lock ends.'
          : 'It turned against you; win it back when the lock ends.',
      });
      return;
    }
    if (outcome.reclaimed)
      setNotice(
        outcome.reclaimed.was === 'conquered'
          ? `Won back! ${wordOf(row.nodeId)} is conquered again.`
          : `Won back! Your claim resumes at step ${outcome.reclaimed.steps + 1}/${CLAIM_STEPS} (${claimNotice(outcome.claim ?? {}, appNow(data.offsetDays).getTime())})`,
      );
    else if (outcome.conquered)
      setNotice(`${wordOf(row.nodeId)} is conquered: it holds its ground now.`);
    else if (outcome.claim)
      setNotice(claimNotice(outcome.claim, appNow(data.offsetDays).getTime()));
    if (outcome.opened && !outcome.levelUp) {
      const opened = `Your push opened ${outcome.opened} new ${outcome.opened === 1 ? 'word' : 'words'}.`;
      setNotice((n) => (n ? `${n} ${opened}` : opened));
    }
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
    .filter((n) => n.conjugations && (n.tier ?? 1) <= (progress?.tier ?? 1))
    .map((n) => {
      const st = data.states.get(n.id) ?? 'locked';
      return {
        id: n.id,
        name:
          st === 'conquered'
            ? fadedName(n.it, health.get(n.id) ?? null)
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
    .sort(
      (a, b) =>
        b.level - a.level || Number(b.state === 'conquered') - Number(a.state === 'conquered'),
    );

  /** What the wait card says about a word that can't be worked on right now. */
  const waitCard = (w: NonNullable<typeof waitOn>) => {
    const hub = data.graph.roots?.find((r) => r.id === w.nodeId);
    const word = data.nodes.find((n) => n.id === w.nodeId);
    const st = data.states.get(w.nodeId);
    const title = hub ? hub.root : nameOf(w.nodeId) || '?';
    const subtitle = hub
      ? `${hub.lang ?? ''} root`
      : [word?.pos, st === 'claimed' ? 'claimed' : st === 'frontier' ? 'unknown word' : null]
          .filter(Boolean)
          .join(' · ');
    const retry = (label: string) => ({ label, onClick: () => selectNode(w.nodeId) });
    const left = Math.ceil(((cooldowns.get(w.nodeId) ?? 0) - appMs()) / 1000);
    const lockText = `Locked after a wrong answer: ${left} s left.${w.note ? ` ${w.note}` : ''}`;
    if (w.reason === 'root') {
      if (hub && data.unlockedRoots.has(hub.id)) {
        return {
          title,
          subtitle,
          tone: 'info' as const,
          message: `${hub.root} = “${hub.meaning}”${hub.english?.length ? ` → ${hub.english.join(', ')}` : ''}`,
        };
      }
      return left > 0
        ? { title, subtitle, tone: 'locked' as const, message: lockText }
        : {
            title,
            subtitle,
            tone: 'waiting' as const,
            message: 'Ready.',
            action: retry('Name its meaning'),
          };
    }
    if (w.reason === 'reach') {
      const r = sighted.get(w.nodeId);
      return r !== undefined
        ? {
            title,
            subtitle,
            tone: 'reach' as const,
            message: `Reach ${Math.round((r / REACH.open) * 100)}%. Win words around it: their push adds up and opens it at 100%.`,
          }
        : {
            title,
            subtitle,
            tone: 'waiting' as const,
            message: 'It is in reach now!',
            action: retry('Conquer it'),
          };
    }
    if (w.reason === 'locked') {
      return left > 0
        ? { title, subtitle, tone: 'locked' as const, message: lockText }
        : {
            title,
            subtitle,
            tone: 'waiting' as const,
            message: 'The lock is over.',
            action: retry('Try again'),
          };
    }
    const claim = data.game.nodes.get(w.nodeId)?.claim;
    const next = claimNext(claim, CLAIM_GAPS);
    return next && next.opensAt > appMs()
      ? { title, subtitle, tone: 'waiting' as const, message: claimNotice(claim ?? {}, appMs()) }
      : {
          title,
          subtitle,
          tone: 'waiting' as const,
          message: 'The next step is open.',
          action: retry(next ? `Continue: ${CLAIM_STEP_NAMES[next.step - 1]}` : 'Open'),
        };
  };

  const openNode = (nodeId: string, wait: (w: NonNullable<typeof waitOn>) => void) => {
    if (inspect) return setInspectId(nodeId);
    setInfo(null);
    setWaitOn(null);
    setPlanting(null);
    setSelectedId(nodeId);
    if (fresh.has(nodeId)) setFresh((f) => new Set([...f].filter((id) => id !== nodeId)));
    const hub = data.graph.roots?.find((r) => r.id === nodeId);
    if (hub) {
      const until = cooldowns.get(nodeId);
      if (data.unlockedRoots.has(nodeId) || (until && until > appMs())) {
        wait({ nodeId, reason: 'root' });
      } else {
        setSession(null);
        setRootQuiz(nodeId);
      }
      return;
    }
    if (sighted.has(nodeId)) return wait({ nodeId, reason: 'reach' });
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
      const dir = next.directions[Math.floor(Math.random() * next.directions.length)];
      setSession({ nodeId, cardIds: [cardId(nodeId, dir)], mode: 'conquer' });
      setTurn((t) => t + 1);
      return;
    }
    const conquered = data.states.get(nodeId) === 'conquered';
    // Under pressure (health below 90%), a word can always be defended.
    const threatened = conquered && (health.get(nodeId) ?? 1) < FULL_NAME;
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
    // Random first direction, so English -> Italian comes first half the time.
    const dirs = Math.random() < 0.5 ? DIRECTIONS : [...DIRECTIONS].reverse();
    setSession({ nodeId, cardIds: dirs.map((d) => cardId(nodeId, d)), mode: 'practice' });
    setTurn((t) => t + 1);
  };

  /** Click / arrow / jump on a word: a tick, or a dull tap when it can't be opened now. */
  const selectNode = (nodeId: string) => {
    let blocked = false;
    openNode(nodeId, (w) => {
      blocked = true;
      setWaitOn(w);
    });
    if (!inspect) sfx(blocked ? 'blocked' : 'select');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-slate-800 px-4 py-2">
        <h1 className="text-lg font-semibold tracking-wide text-emerald-400">Sprawl</h1>
        <span className="text-sm text-slate-400">
          {conquered}/{data.nodes.length} conquered · {claimed > 0 && `${claimed} claimed · `}
          {frontier} frontier{sighted.size > 0 && ` · ${sighted.size} in sight`}
          {avg !== null && ` · territory health ${Math.round(avg * 100)}%`}
        </span>
        {progress && (
          <button
            onClick={() => setShowVerbGoals((v) => !v)}
            title="Show which verbs count for the next level"
            className="rounded px-1 hover:bg-slate-800"
          >
            <TierBadge p={progress} names={data.graph.params?.tier_names} />
          </button>
        )}
        {GRAPH_NAMES.length > 1 && (
          <select
            value={graphName}
            onChange={(e) => {
              const url = new URL(window.location.href);
              if (e.target.value === 'default') url.searchParams.delete('graph');
              else url.searchParams.set('graph', e.target.value);
              window.location.href = url.toString();
            }}
            title="Word graph (each keeps its own progress)"
            className="ml-auto rounded bg-slate-800 px-2 py-1 text-sm text-slate-300"
          >
            {GRAPH_NAMES.map((n) => (
              <option key={n} value={n}>
                {graphLabel(n)}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => setShowRoots((v) => !v)}
          title="Show shared roots (e.g. Latin coquere) as hub nodes linked to their words"
          className={`${GRAPH_NAMES.length > 1 ? '' : 'ml-auto'} rounded px-3 py-1 text-sm ${
            showRoots
              ? 'bg-pink-900/60 text-pink-200'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          ⬢ Roots {showRoots ? 'on' : 'off'}
        </button>
        <button
          onClick={() => setShowProgress((v) => !v)}
          title="Score, achievements and coins"
          className={`rounded px-2 py-1 text-sm ${
            showProgress
              ? 'bg-amber-700/60 text-amber-100'
              : 'bg-slate-800 text-amber-300 hover:bg-slate-700'
          }`}
        >
          🏆 {score.toLocaleString()} · 🪙 {data.coins}
        </button>
        <AudioToggles />
        <button
          onClick={() => setInspect((v) => !v)}
          title="Show every word and link, including ones you haven't unlocked (spoilers)"
          className={`rounded px-3 py-1 text-sm ${
            inspect ? 'bg-pink-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {inspect ? 'Exit inspect' : 'Inspect network'}
        </button>
      </header>
      <main className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1">
          {levelUp && (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg border border-amber-400/60 bg-amber-500/15 px-5 py-3 text-center shadow-lg backdrop-blur">
              <div className="text-lg font-semibold text-amber-300">
                {data.graph.params?.tier_names?.[String(levelUp.tier)] ?? `Tier ${levelUp.tier}`}{' '}
                unlocked!
              </div>
              <div className="text-sm text-amber-100/80">
                {levelUp.revealed} new {levelUp.revealed === 1 ? 'word appeared' : 'words appeared'}{' '}
                at the edge of your territory
              </div>
            </div>
          )}
          {verbUp && !levelUp && <VerbUpBanner word={wordOf(verbUp.nodeId)} level={verbUp.level} />}
          {earnedNow.length > 0 && !levelUp && !verbUp && <AchievementBanner earned={earnedNow} />}
          <GraphView
            data={data}
            health={health}
            activeId={inspect ? inspectId : panelId}
            strength={strength}
            verbLevels={verbLevels}
            control={new Map([...data.game.nodes].map(([id, g]) => [id, g.control]))}
            hostile={hostileSet}
            nowMs={now.getTime()}
            claims={claims}
            claimWaits={claimWaits}
            sighted={sighted}
            pushes={pushes}
            danger={dangerMap}
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
            pushSources={
              detailsReach ? new Map(detailsReach.map((r) => [r.id, r.push])) : undefined
            }
            attention={attention}
            answerId={answerId}
            graceUntil={
              new Map(
                [...data.game.nodes]
                  .filter(([id, g]) => data.states.get(id) === 'frontier' && g.since !== undefined)
                  .map(([id, g]) => [id, g.since! + INFLUENCE.hostileAfterHours * 3_600_000]),
              )
            }
            unlockedRoots={data.unlockedRoots}
            cooldowns={cooldowns}
            inspect={inspect}
            showRoots={showRoots}
            onNodeClick={selectNode}
          />
        </section>
        <aside className="flex w-96 flex-col gap-4 overflow-y-auto border-l border-slate-800 p-4">
          {showProgress && !inspect && (
            <ProgressPanel
              score={score}
              clusters={clusters}
              regionName={regionName}
              achievements={data.achievements}
              coins={data.coins}
              onClose={() => setShowProgress(false)}
            />
          )}
          {showVerbGoals && progress && progress.verbsNeed > 0 && !inspect && (
            <VerbGoals
              goals={verbGoals}
              need={progress.verbsNeed}
              level={progress.verbLevel}
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
              {notice && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  {notice}
                </div>
              )}
              {planting && data.states.get(planting) === 'conquered' ? (
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
                    setNotice(
                      `Planted “${w?.en}” next to ${wordOf(anchor)}. Conquer it to ${
                        o.sameCategory ? `tighten ${regionName(regionOf(anchor))}` : 'claim it'
                      }.`,
                    );
                  }}
                />
              ) : waitOn ? (
                <WaitCard
                  key={`${waitOn.nodeId}:${waitOn.reason}`}
                  {...waitCard(waitOn)}
                  onClose={() => setWaitOn(null)}
                />
              ) : activeDrill && !rootQuiz ? (
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
                      setWaitOn({ nodeId, reason: 'locked', note: 'Missed a form of this verb.' });
                      setNotice(
                        `Missed a form: ${wordOf(nodeId)} is locked for ${COOLDOWN_MS / 1000} s.`,
                      );
                    } else if (kind === 'learn') {
                      setVerbUp({ nodeId, level: TENSES.indexOf(tense) + 1 });
                    }
                  }}
                />
              ) : info && !rootQuiz && data.nodes.some((n) => n.id === info.nodeId) ? (
                <WordInfo
                  key={info.nodeId}
                  word={data.nodes.find((n) => n.id === info.nodeId)!}
                  health={health.get(info.nodeId) ?? null}
                  control={data.game.nodes.get(info.nodeId)?.control ?? 1}
                  strength={strength.get(info.nodeId) ?? 0}
                  status={info.status}
                  verbLevel={verbLevels.get(info.nodeId)}
                  tenseCards={data.tenseCards.filter((c) => c.nodeId === info.nodeId)}
                  onClose={() => setInfo(null)}
                />
              ) : rootQuiz && data.graph.roots?.some((r) => r.id === rootQuiz) ? (
                <RootQuiz
                  key={rootQuiz}
                  data={data}
                  hub={data.graph.roots.find((r) => r.id === rootQuiz)!}
                  onCancel={() => setRootQuiz(null)}
                  onDone={async (correct) => {
                    const id = rootQuiz;
                    setRootQuiz(null);
                    if (correct) {
                      const n = await unlockRoot(id);
                      sfx('conquer');
                      setNotice(
                        `Root unlocked${n ? `: ${n} new ${n === 1 ? 'word' : 'words'} to conquer` : ''}.`,
                      );
                    } else {
                      setCooldowns((m) => new Map(m).set(id, appMs() + COOLDOWN_MS));
                      setWaitOn({ nodeId: id, reason: 'root' });
                      sfx('miss');
                    }
                  }}
                />
              ) : (
                <ReviewView
                  key={turn}
                  data={data}
                  current={current}
                  mode={mode}
                  dueCount={dueCount}
                  elsewhere={
                    queue.filter((c) => !isNear(c.nodeId)).length +
                    data.tenseCards.filter((c) => c.card.due <= now && !isNear(c.nodeId)).length
                  }
                  newToday={newToday}
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
              control={data.game.nodes.get(detailsWord.id)?.control ?? 1}
              influences={detailsInfluences}
              nameOf={nameOf}
              cohesion={cohesion(detailsWord.id, data.states, weights)}
              hostile={hostileSet.has(detailsWord.id)}
              graceHours={
                ((data.game.nodes.get(detailsWord.id)?.since ?? now.getTime()) +
                  INFLUENCE.hostileAfterHours * 3_600_000 -
                  now.getTime()) /
                3_600_000
              }
              nowMs={appNow(data.offsetDays).getTime()}
              claimStep={claimNext(data.game.nodes.get(detailsWord.id)?.claim, CLAIM_GAPS)}
              danger={dangerMap.get(detailsWord.id)}
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
                        setNotice(
                          `Hint: “${detailsWord.cognate}”. It stays next to the word and halves the pressure on it.`,
                        );
                      },
                    }
                  : undefined
              }
              reclaim={reclaimMap.get(detailsWord.id)}
              endangers={(() => {
                const ds = [...dangerMap.values()].filter((d) => d.from === detailsWord.id);
                return ds.length
                  ? { count: ds.length, until: Math.min(...ds.map((d) => d.until)) }
                  : undefined;
              })()}
              appNowMs={appMs()}
              dangerFrom={(id) => wordOf(id)}
              reach={
                detailsReach
                  ? {
                      value: reach.get(detailsWord.id) ?? 0,
                      sources: detailsReach.map((r) => ({ name: nameOf(r.id), push: r.push })),
                    }
                  : undefined
              }
              push={
                pushes.has(detailsWord.id)
                  ? { value: pushes.get(detailsWord.id)!, why: pushWhy(detailsWord.id) }
                  : undefined
              }
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
                session?.nodeId !== detailsWord.id &&
                current?.nodeId !== detailsWord.id &&
                info?.nodeId !== detailsWord.id
              }
            />
          )}
          <DebugPanel
            offsetDays={data.offsetDays}
            now={now}
            onTravel={timeTravel}
            onReset={async () => {
              setSession(null);
              await reset();
            }}
          />
        </aside>
      </main>
    </div>
  );
}

/** What a claim needs next, e.g. "Step 2/3 (Produce) opens in ~1 min". */
function claimNotice(claim: Claim, nowMs: number): string {
  const next = claimNext(claim, CLAIM_GAPS);
  if (!next) return '';
  const done = next.step > 1 ? `Step ${next.step - 1}/${CLAIM_STEPS} done. ` : '';
  const what = next.step === 2 ? 'type it in Italian' : 'recall it once more to conquer it';
  const wait = next.opensAt - nowMs;
  if (wait <= 0) return `${done}Next: ${what}.`;
  const when = wait < 90_000 ? `${Math.ceil(wait / 1000)} s` : `${Math.ceil(wait / 60_000)} min`;
  return `${done}${CLAIM_STEP_NAMES[next.step - 1]} opens in ~${when}: ${what} then. Explore meanwhile; it pulses when ready.`;
}

/** A verb mastered a new tense: a moment to be proud of. */
function VerbUpBanner({ word, level }: { word: string; level: number }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-xl border-2 border-amber-300/80 bg-gradient-to-b from-amber-500/30 to-amber-900/40 px-6 py-3 text-center shadow-[0_0_40px_rgba(251,191,36,0.45)] backdrop-blur">
      <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80">Verb level up</div>
      <div className="text-2xl font-bold text-amber-200">{word}</div>
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
      <div className="mt-1.5 text-xs text-amber-100/70">
        Its push and its hold on the territory grow with every tense.
      </div>
    </div>
  );
}

/** Header switches for music (off by default) and sound effects (on). */
function AudioToggles() {
  const a = useSyncExternalStore(onAudioSettings, audioSettings);
  const cls = (on: boolean) =>
    `rounded px-2 py-1 text-sm ${on ? 'bg-emerald-900/60 text-emerald-200' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`;
  return (
    <span className="flex gap-1">
      <button
        className={cls(a.music)}
        onClick={() => setMusic(!a.music)}
        title="Calm background music (synthesised)"
      >
        ♪ {a.music ? 'on' : 'off'}
      </button>
      <button
        className={cls(a.sfx)}
        onClick={() => setSfx(!a.sfx)}
        title="Sounds for clicks, answers and conquests"
      >
        {a.sfx ? '🔊' : '🔈'} sfx
      </button>
    </span>
  );
}

/** Newly earned achievements, celebrated over the map. */
function AchievementBanner({ earned }: { earned: Achievement[] }) {
  const coins = earned.reduce((n, a) => n + a.coins, 0);
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-xl border-2 border-amber-300/70 bg-slate-900/90 px-6 py-3 text-center shadow-[0_0_30px_rgba(251,191,36,0.35)] backdrop-blur">
      <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80">
        🏆 Achievement{earned.length > 1 ? `s (${earned.length})` : ''} unlocked
      </div>
      {earned.slice(0, 4).map((a) => (
        <div key={a.id} className="mt-1">
          <span className="text-lg font-bold text-amber-200">{a.title}</span>{' '}
          <span className="text-sm text-amber-100/70">· {a.description}</span>
        </div>
      ))}
      {earned.length > 4 && (
        <div className="text-xs text-amber-100/60">and {earned.length - 4} more</div>
      )}
      <div className="mt-1 text-sm text-emerald-300">+{coins} 🪙 coins</div>
    </div>
  );
}

function TierBadge({
  p,
  names,
}: {
  p: TierProgress;
  /** Display names per tier, e.g. CEFR levels. */
  names?: Record<string, string> | null;
}) {
  const name = (t: number) => names?.[String(t)] ?? `tier ${t}`;
  const pct = p.needed ? Math.min(1, p.conquered / p.needed) : 1;
  return (
    <span
      className="flex items-center gap-2 text-sm text-slate-300"
      title={
        p.needed
          ? `Conquer ${p.needed} words up to ${name(p.tier)}` +
            (p.verbsNeed ? ` and level ${p.verbsNeed} verbs to ${TENSES[p.verbLevel - 1]}` : '') +
            ` to open ${name(p.tier + 1)}`
          : 'All tiers open'
      }
    >
      <span className="font-semibold text-amber-300">
        {names ? `Level ${name(p.tier)}` : `Tier ${p.tier}/${p.maxTier}`}
      </span>
      {p.needed > 0 && (
        <>
          <span className="inline-block h-1.5 w-24 overflow-hidden rounded bg-slate-800">
            <span
              className="block h-full bg-amber-400"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </span>
          <span className="text-xs text-slate-400">
            {p.conquered}/{p.needed} words
            {p.verbsNeed > 0 &&
              ` · verbs ${p.verbsHave}/${p.verbsNeed} at ${TENSES[p.verbLevel - 1]}`}{' '}
            to {name(p.tier + 1)}
          </span>
        </>
      )}
    </span>
  );
}
