import { useMemo, useState } from 'react';
import { startOfDay } from './core/clock';
import { nodeHealth } from './core/health';
import { buildQueue } from './core/queue';
import { cardId, DIRECTIONS, type Grade } from './core/scheduler';
import type { CardRow } from './db/repo';
import { useSprawl } from './useSprawl';
import DebugPanel from './views/DebugPanel';
import GraphView from './views/GraphView';
import ReviewView from './views/ReviewView';

/** A node the user clicked: its cards are reviewed before the automatic queue. */
type Session = { nodeId: string; cardIds: string[]; mode: 'conquer' | 'practice' };

export default function App() {
  const { data, now, error, review, timeTravel, reset } = useSprawl();
  const [lastCardId, setLastCardId] = useState<string>();
  const [session, setSession] = useState<Session | null>(null);
  const [turn, setTurn] = useState(0);

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

  const queue = useMemo(
    () => (data ? buildQueue({ cards: data.cards, states: data.states, now, lastCardId }) : []),
    [data, now, lastCardId],
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

  const onRate = async (row: CardRow, grade: Grade) => {
    await review(row, grade);
    setLastCardId(row.id);
    setTurn((t) => t + 1);
    setSession((s) => {
      if (!s) return s;
      const rest = s.cardIds.filter((id) => id !== row.id);
      return rest.length ? { ...s, cardIds: rest } : null;
    });
  };

  const selectNode = (nodeId: string) => {
    if (data.states.get(nodeId) === 'locked') return;
    setSession({
      nodeId,
      cardIds: DIRECTIONS.map((d) => cardId(nodeId, d)),
      mode: data.states.get(nodeId) === 'conquered' ? 'practice' : 'conquer',
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
      </header>
      <main className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1">
          <GraphView
            data={data}
            health={health}
            activeId={current?.nodeId}
            onNodeClick={selectNode}
          />
        </section>
        <aside className="flex w-96 flex-col gap-4 overflow-y-auto border-l border-slate-800 p-4">
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
