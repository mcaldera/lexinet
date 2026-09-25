import { useEffect, useMemo, useRef, useState } from 'react';
import { CLAIM_GAPS, COOLDOWN_MS, INFLUENCE, REACH } from './config';
import { attentionList, newlyRevealed } from './core/attention';
import { claimNext, CLAIM_STEP_NAMES, CLAIM_STEPS, unseen, type Claim } from './core/claim';
import { FULL_NAME, fadedName } from './core/fade';
import { cohesion, isHostile, neighbourWeights, pressureBreakdown } from './core/influence';
import { appNow, startOfDay } from './core/clock';
import { nodeHealth } from './core/health';
import { buildQueue } from './core/queue';
import { tierAllows, tierMap, type TierProgress } from './core/tiers';
import { sightedWords } from './core/reach';
import { neighbourMap } from './core/unlock';
import { nextDrill, TENSES, type Tense } from './core/verbs';
import { computeProgress, computeReach, verbLevels as computeVerbLevels } from './progress';
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
import NodeDetails from './views/NodeDetails';
import VerbGoals, { type VerbGoal } from './views/VerbGoals';

/** A node the user clicked: its cards are reviewed before the automatic queue. */
type Session = { nodeId: string; cardIds: string[]; mode: 'conquer' | 'practice' };

export default function App() {
  const { data, now, error, lost, review, reviewTense, unlockRoot, timeTravel, reset, graphName } =
    useSprawl();
  const [lastCardId, setLastCardId] = useState<string>();
  const [session, setSession] = useState<Session | null>(null);
  const [turn, setTurn] = useState(0);
  const [inspect, setInspect] = useState(false);
  const [showRoots, setShowRoots] = useState(true);
  const [inspectId, setInspectId] = useState<string>();
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  /** Node id -> real time (ms) until which it is locked after a wrong answer. */
  const [cooldowns, setCooldowns] = useState<Map<string, number>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [rootQuiz, setRootQuiz] = useState<string | null>(null);
  /** Last word clicked or reached with the arrow keys: shown in the details panel. */
  const [selectedId, setSelectedId] = useState<string>();
  const [showVerbGoals, setShowVerbGoals] = useState(false);
  /** A conquered word opened for viewing (it isn't due): meaning, etymology, tenses. */
  const [info, setInfo] = useState<{ nodeId: string; status: string } | null>(null);
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

  // Tick every second while something is cooling down (countdown rings), then expire.
  useEffect(() => {
    if (!cooldowns.size) return;
    const t = setInterval(() => {
      setSecond((s) => s + 1);
      const live = [...cooldowns].filter(([, until]) => until > Date.now());
      if (live.length < cooldowns.size) setCooldowns(new Map(live));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldowns]);

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
    setNotice(`Slipped away: ${names.join(', ')}. Win them back!`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lost]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

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
  // How far the territory pushes: all reach, and the hidden words it lets you see.
  const reach = useMemo(
    () =>
      data
        ? computeReach(
            data.nodes,
            neighbours,
            data.states,
            new Map([...data.game.nodes].map(([id, g]) => [id, g.claim])),
            data.graph.seed,
          )
        : new Map<string, number>(),
    [data, neighbours],
  );
  const sighted = useMemo(
    () =>
      data && progress
        ? sightedWords(data.states, reach, REACH, tierAllows(tierMap(data.nodes), progress.tier))
        : new Map<string, number>(),
    [data, reach, progress],
  );
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

  const current: CardRow | undefined = session
    ? data.cards.find((c) => c.id === session.cardIds[0])
    : queue[0];
  const mode = session?.mode ?? 'due';
  // Due tense drills defend automatically once no word card is waiting.
  const dueTense =
    !session && !current
      ? data.tenseCards.find((c) => c.card.due <= now && !cooldowns.has(c.nodeId))
      : undefined;
  const activeDrill =
    verbDrill ??
    (dueTense && !info
      ? { nodeId: dueTense.nodeId, tense: dueTense.tense, kind: 'defend' as const }
      : null);
  const dueCount = queue.filter((c) => !session?.cardIds.includes(c.id)).length;

  // Details panel: the word being worked on, else the last one selected.
  const detailsId =
    activeDrill?.nodeId ?? session?.nodeId ?? info?.nodeId ?? selectedId ?? current?.nodeId;
  const detailsWord = data.nodes.find((n) => n.id === detailsId);
  // The word whose Italian name is the answer being asked: hidden everywhere meanwhile.
  const answerId =
    !activeDrill && !info && !rootQuiz && current?.direction === 'en-it'
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
        )
      : (weights.get(detailsWord.id) ?? [])
          .filter((n) => data.states.get(n.id) === 'conquered')
          .map((n) => ({
            id: n.id,
            kind: 'attack' as const,
            perDay: -INFLUENCE.hostilePressure * n.weight,
          }));

  const claims = new Map([...data.game.nodes].map(([id, g]) => [id, g.claim]));
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
    blocked: (id) => (cooldowns.get(id) ?? 0) > Date.now(),
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

  const onRate = async (row: CardRow, grade: Grade) => {
    const firstSight = unseen(cardsByNode.get(row.nodeId) ?? []);
    const outcome = await review(row, grade);
    if (outcome.levelUp) setLevelUp(outcome.levelUp);
    setLastCardId(row.id);
    setTurn((t) => t + 1);
    if (grade === Rating.Again) {
      // Locked for a minute either way, so recalling it needs real memory.
      setCooldowns((m) => new Map(m).set(row.nodeId, Date.now() + COOLDOWN_MS));
      const slipped = outcome.slipped.filter((id) => id !== row.nodeId).map(wordOf);
      setNotice(
        firstSight
          ? `New word: ${wordOf(row.nodeId)}. Come back in ${COOLDOWN_MS / 1000} s to claim it from memory.`
          : `Missed! ${wordOf(row.nodeId)} is locked for ${COOLDOWN_MS / 1000} s and turns against you.` +
              (slipped.length ? ` Your fresh claim on ${slipped.join(', ')} slipped away.` : ''),
      );
      setSession((s) => (s?.nodeId === row.nodeId ? null : s));
      return;
    }
    if (outcome.conquered)
      setNotice(`${wordOf(row.nodeId)} is conquered: it holds its ground now.`);
    else if (outcome.claim)
      setNotice(claimNotice(outcome.claim, appNow(data.offsetDays).getTime()));
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

  const selectNode = (nodeId: string) => {
    if (inspect) return setInspectId(nodeId);
    setInfo(null);
    setSelectedId(nodeId);
    if (fresh.has(nodeId)) setFresh((f) => new Set([...f].filter((id) => id !== nodeId)));
    const hub = data.graph.roots?.find((r) => r.id === nodeId);
    if (hub) {
      const until = cooldowns.get(nodeId);
      if (data.unlockedRoots.has(nodeId)) {
        setNotice(
          `${hub.root} = “${hub.meaning}”${hub.english?.length ? ` → ${hub.english.join(', ')}` : ''}`,
        );
      } else if (until && until > Date.now()) {
        setNotice(`${hub.root} is still locked (${Math.ceil((until - Date.now()) / 1000)} s).`);
      } else {
        setSession(null);
        setRootQuiz(nodeId);
      }
      return;
    }
    const inSight = sighted.get(nodeId);
    if (inSight !== undefined) {
      setNotice(
        `Beyond your reach (${Math.round((inSight / REACH.open) * 100)}%). Conquer words around it to push your horizon here.`,
      );
      return;
    }
    if (!data.states.has(nodeId) || data.states.get(nodeId) === 'locked') return; // roots, hidden
    const until = cooldowns.get(nodeId);
    if (until && until > Date.now()) {
      setNotice(`${wordOf(nodeId)} is still locked (${Math.ceil((until - Date.now()) / 1000)} s).`);
      return;
    }
    const st = data.states.get(nodeId);
    if (st === 'frontier' || st === 'claimed') {
      // Conquering goes one step at a time (core/claim.ts): recognise, produce, lock in.
      const claim = data.game.nodes.get(nodeId)?.claim;
      const next = claimNext(claim, CLAIM_GAPS);
      if (!next) return;
      if (next.opensAt > now.getTime()) {
        setNotice(claimNotice(claim ?? {}, now.getTime()));
        return;
      }
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-6 whitespace-nowrap border-b border-slate-800 px-4 py-2">
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
          <GraphView
            data={data}
            health={health}
            activeId={inspect ? inspectId : (activeDrill?.nodeId ?? current?.nodeId)}
            strength={strength}
            verbLevels={verbLevels}
            control={new Map([...data.game.nodes].map(([id, g]) => [id, g.control]))}
            hostile={hostileSet}
            nowMs={now.getTime()}
            claims={claims}
            claimWaits={claimWaits}
            sighted={sighted}
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
              {activeDrill && !rootQuiz ? (
                <VerbDrill
                  key={`${activeDrill.nodeId}:${activeDrill.tense}:${turn}`}
                  word={data.nodes.find((n) => n.id === activeDrill.nodeId)!}
                  tense={activeDrill.tense}
                  kind={activeDrill.kind}
                  onCancel={() => {
                    setVerbDrill(null);
                    if (!verbDrill)
                      setCooldowns((m) =>
                        new Map(m).set(activeDrill.nodeId, Date.now() + COOLDOWN_MS),
                      );
                  }}
                  onDone={async (grade) => {
                    const { nodeId, tense, kind } = activeDrill;
                    setVerbDrill(null);
                    setTurn((t) => t + 1);
                    const lv = await reviewTense(nodeId, tense, grade);
                    if (lv) setLevelUp(lv);
                    if (grade === Rating.Again) {
                      setCooldowns((m) => new Map(m).set(nodeId, Date.now() + COOLDOWN_MS));
                      setNotice(
                        `Missed a form: ${wordOf(nodeId)} is locked for ${COOLDOWN_MS / 1000} s.`,
                      );
                    } else if (kind === 'learn') {
                      setNotice(
                        `${wordOf(nodeId)} reached verb level ${TENSES.indexOf(tense) + 1}: ${tense}!`,
                      );
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
                      setNotice(
                        `Root unlocked${n ? `: ${n} new ${n === 1 ? 'word' : 'words'} to conquer` : ''}.`,
                      );
                    } else {
                      setCooldowns((m) => new Map(m).set(id, Date.now() + COOLDOWN_MS));
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
                  newToday={newToday}
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
              showEtymology={
                (health.get(detailsWord.id) ?? 1) >= FULL_NAME &&
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
