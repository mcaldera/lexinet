import { useEffect, useMemo, useState } from 'react';
import { COOLDOWN_MS, TIER_UNLOCK_FRACTION } from './config';
import { startOfDay } from './core/clock';
import { nodeHealth } from './core/health';
import { buildQueue } from './core/queue';
import { tierMap, tierProgress } from './core/tiers';
import { cardId, DIRECTIONS, Rating, type Grade } from './core/scheduler';
import { nextPractice, nodeStrength } from './core/strength';
import type { CardRow } from './db/repo';
import { GRAPH_NAMES } from './graphs';
import { useSprawl, type LevelUp } from './useSprawl';
import DebugPanel from './views/DebugPanel';
import GraphView from './views/GraphView';
import InspectPanel from './views/InspectPanel';
import ReviewView from './views/ReviewView';
import RootQuiz from './views/RootQuiz';

/** A node the user clicked: its cards are reviewed before the automatic queue. */
type Session = { nodeId: string; cardIds: string[]; mode: 'conquer' | 'practice' };

export default function App() {
  const { data, now, error, review, unlockRoot, timeTravel, reset, graphName } = useSprawl();
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
  const [, setSecond] = useState(0);

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
          ? nodeHealth(
              cards.map((c) => c.card),
              now,
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

  const tiers = useMemo(() => tierMap(data?.nodes ?? []), [data?.nodes]);
  const progress = useMemo(
    () => (data ? tierProgress(tiers, data.states, TIER_UNLOCK_FRACTION) : null),
    [tiers, data],
  );

  const queue = useMemo(
    () =>
      data
        ? buildQueue({ cards: data.cards, states: data.states, now, lastCardId }).filter(
            (c) => !cooldowns.has(c.nodeId),
          )
        : [],
    [data, now, lastCardId, cooldowns],
  );

  if (error) return <div className="p-6 text-red-400">Failed to open database: {error}</div>;
  if (!data) return <div className="p-6 text-slate-400">Loading…</div>;

  const current: CardRow | undefined = session
    ? data.cards.find((c) => c.id === session.cardIds[0])
    : queue[0];
  const mode = session?.mode ?? 'due';
  const dueCount = queue.filter((c) => !session?.cardIds.includes(c.id)).length;

  const today = startOfDay(now).getTime();
  const newToday = [...data.firstReview.values()].filter(
    (iso) => new Date(iso).getTime() >= today,
  ).length;

  const states = [...data.states.values()];
  const conquered = states.filter((s) => s === 'conquered').length;
  const frontier = states.filter((s) => s === 'frontier').length;
  const hs = [...health.values()].filter((h): h is number => h !== null);
  const avg = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;

  const wordOf = (id: string) => data.nodes.find((n) => n.id === id)?.it ?? id;

  const onRate = async (row: CardRow, grade: Grade) => {
    const lv = await review(row, grade);
    if (lv) setLevelUp(lv);
    setLastCardId(row.id);
    setTurn((t) => t + 1);
    if (grade === Rating.Again) {
      // Penalty: the word is locked for a minute, so you have to go elsewhere first.
      setCooldowns((m) => new Map(m).set(row.nodeId, Date.now() + COOLDOWN_MS));
      setNotice(
        `Missed! ${wordOf(row.nodeId)} is locked for ${COOLDOWN_MS / 1000} s. Try another word.`,
      );
      setSession((s) => (s?.nodeId === row.nodeId ? null : s));
      return;
    }
    setSession((s) => {
      if (!s) return s;
      const rest = s.cardIds.filter((id) => id !== row.id);
      return rest.length ? { ...s, cardIds: rest } : null;
    });
  };

  const selectNode = (nodeId: string) => {
    if (inspect) return setInspectId(nodeId);
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
    if (!data.states.has(nodeId) || data.states.get(nodeId) === 'locked') return; // roots, hidden
    const until = cooldowns.get(nodeId);
    if (until && until > Date.now()) {
      setNotice(`${wordOf(nodeId)} is still locked (${Math.ceil((until - Date.now()) / 1000)} s).`);
      return;
    }
    const conquered = data.states.get(nodeId) === 'conquered';
    const next = conquered
      ? nextPractice(
          (cardsByNode.get(nodeId) ?? []).map((c) => c.card),
          now,
        )
      : null;
    if (next) {
      const days = (next.getTime() - now.getTime()) / 86_400_000;
      const when =
        days < 1 ? `${Math.max(1, Math.round(days * 24))} h` : `${Math.round(days)} days`;
      setNotice(
        `${wordOf(nodeId)} is holding (strength ${strength.get(nodeId) ?? 0}/5). ` +
          `Strength only grows with time: come back in ~${when}.`,
      );
      return;
    }
    // Random first direction, so English -> Italian comes first half the time.
    const dirs = Math.random() < 0.5 ? DIRECTIONS : [...DIRECTIONS].reverse();
    setSession({
      nodeId,
      cardIds: dirs.map((d) => cardId(nodeId, d)),
      mode: conquered ? 'practice' : 'conquer',
    });
    setTurn((t) => t + 1);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-6 border-b border-slate-800 px-4 py-2">
        <h1 className="text-lg font-semibold tracking-wide text-emerald-400">Sprawl</h1>
        <span className="text-sm text-slate-400">
          {conquered}/{data.nodes.length} conquered · {frontier} frontier
          {avg !== null && ` · territory health ${Math.round(avg * 100)}%`}
        </span>
        {progress && <TierBadge p={progress} />}
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
                {n === 'default' ? 'My words' : `${n} words`}
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
                Tier {levelUp.tier} unlocked!
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
            activeId={inspect ? inspectId : current?.nodeId}
            strength={strength}
            unlockedRoots={data.unlockedRoots}
            cooldowns={cooldowns}
            inspect={inspect}
            showRoots={showRoots}
            onNodeClick={selectNode}
          />
        </section>
        <aside className="flex w-96 flex-col gap-4 overflow-y-auto border-l border-slate-800 p-4">
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
              {rootQuiz && data.graph.roots?.some((r) => r.id === rootQuiz) ? (
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
                  onRate={onRate}
                  onCancel={() => {
                    setSession(null);
                    setTurn((t) => t + 1);
                  }}
                />
              )}
            </>
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

function TierBadge({ p }: { p: ReturnType<typeof tierProgress> }) {
  const pct = p.needed ? Math.min(1, p.conquered / p.needed) : 1;
  return (
    <span
      className="flex items-center gap-2 text-sm text-slate-300"
      title={
        p.needed
          ? `Conquer ${p.needed} words of tiers 1–${p.tier} to open tier ${p.tier + 1}`
          : 'All tiers open'
      }
    >
      <span className="font-semibold text-amber-300">
        Tier {p.tier}/{p.maxTier}
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
            {p.conquered}/{p.needed} to tier {p.tier + 1}
          </span>
        </>
      )}
    </span>
  );
}
