import { useEffect, useMemo, useState } from 'react';
import { startOfDay } from '../core/clock';
import { buildQueue } from '../core/queue';
import { Rating, State, type Grade } from '../core/scheduler';
import { NEW_NODES_PER_DAY } from '../config';
import type { AppData, CardRow } from '../db/repo';

const BUTTONS: { grade: Grade; label: string; key: string; cls: string }[] = [
  { grade: Rating.Again, label: 'Again', key: '1', cls: 'bg-red-600 hover:bg-red-500' },
  { grade: Rating.Hard, label: 'Hard', key: '2', cls: 'bg-amber-600 hover:bg-amber-500' },
  { grade: Rating.Good, label: 'Good', key: '3', cls: 'bg-emerald-600 hover:bg-emerald-500' },
  { grade: Rating.Easy, label: 'Easy', key: '4', cls: 'bg-sky-600 hover:bg-sky-500' },
];

type Props = {
  data: AppData;
  now: Date;
  lastCardId?: string;
  onRate: (row: CardRow, grade: Grade) => Promise<void>;
};

export default function ReviewView({ data, now, lastCardId, onRate }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const queue = useMemo(() => {
    const today = startOfDay(now).getTime();
    const newNodesToday = [...data.firstReview.values()].filter(
      (iso) => new Date(iso).getTime() >= today,
    ).length;
    return buildQueue({
      cards: data.cards,
      states: data.states,
      now,
      newNodesToday,
      newPerDay: NEW_NODES_PER_DAY,
      lastCardId,
    });
  }, [data, now, lastCardId]);

  const current = queue[0] as CardRow | undefined;
  const word = current && data.nodes.find((n) => n.id === current.nodeId);

  useEffect(() => setRevealed(false), [current?.id, lastCardId]);

  const rateCurrent = async (grade: Grade) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await onRate(current, grade);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const b = BUTTONS.find((b) => b.key === e.key);
        if (b) rateCurrent(b.grade);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const counts = {
    due: queue.filter((c) => c.card.state !== State.New).length,
    fresh: queue.filter((c) => c.card.state === State.New).length,
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex justify-between text-xs uppercase tracking-wider text-slate-400">
        <span>Review</span>
        <span>
          {counts.due} due · {counts.fresh} new
        </span>
      </div>
      {!current || !word ? (
        <p className="py-8 text-center text-slate-400">
          All done for now. Use time travel to see your territory decay.
        </p>
      ) : (
        <>
          <div className="mb-1 flex gap-2 text-xs text-slate-500">
            <span>{current.direction === 'it-en' ? 'Italian → English' : 'English → Italian'}</span>
            {data.states.get(current.nodeId) === 'frontier' && (
              <span className="text-amber-400">new territory</span>
            )}
            {word.pos && <span>{word.pos}</span>}
          </div>
          <div className="py-4 text-center text-2xl font-medium">
            {current.direction === 'it-en' ? word.it : word.en}
          </div>
          {revealed ? (
            <>
              <div className="border-t border-slate-800 py-4 text-center text-2xl text-emerald-300">
                {current.direction === 'it-en' ? word.en : word.it}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {BUTTONS.map((b) => (
                  <button
                    key={b.label}
                    disabled={busy}
                    onClick={() => rateCurrent(b.grade)}
                    className={`rounded px-2 py-2 text-sm font-medium text-white disabled:opacity-50 ${b.cls}`}
                  >
                    {b.label}
                    <span className="block text-[10px] opacity-70">{b.key}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button
              onClick={() => setRevealed(true)}
              className="w-full rounded bg-slate-700 py-2 text-sm hover:bg-slate-600"
            >
              Show answer <span className="text-xs opacity-60">(space)</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
