import { useMemo, useState } from 'react';
import { nodeHealth } from './core/health';
import { useSprawl } from './useSprawl';
import DebugPanel from './views/DebugPanel';
import GraphView from './views/GraphView';
import ReviewView from './views/ReviewView';

export default function App() {
  const { data, now, error, review, timeTravel, reset } = useSprawl();
  const [lastCardId, setLastCardId] = useState<string>();

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

  if (error) return <div className="p-6 text-red-400">Failed to open database: {error}</div>;
  if (!data) return <div className="p-6 text-slate-400">Loading…</div>;

  const states = [...data.states.values()];
  const conquered = states.filter((s) => s === 'conquered').length;
  const frontier = states.filter((s) => s === 'frontier').length;
  const hs = [...health.values()].filter((h): h is number => h !== null);
  const avg = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;

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
          <GraphView data={data} health={health} />
        </section>
        <aside className="flex w-96 flex-col gap-4 overflow-y-auto border-l border-slate-800 p-4">
          <ReviewView
            data={data}
            now={now}
            lastCardId={lastCardId}
            onRate={async (row, grade) => {
              await review(row, grade);
              setLastCardId(row.id);
            }}
          />
          <DebugPanel
            offsetDays={data.offsetDays}
            now={now}
            onTravel={timeTravel}
            onReset={reset}
          />
        </aside>
      </main>
    </div>
  );
}
