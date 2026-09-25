type Props = {
  offsetDays: number;
  now: Date;
  onTravel: (days: number) => void;
  onReset: () => void;
};

export default function DebugPanel({ offsetDays, now, onTravel, onReset }: Props) {
  const btn = 'rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700';
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-4 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">Debug</div>
      <p className="mb-3 text-slate-400">
        App date: {now.toLocaleDateString()} ({offsetDays >= 0 ? '+' : ''}
        {Math.round(offsetDays * 100) / 100} days)
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={() => onTravel(15 / 1440)}>
          ⏩ +15 min
        </button>
        <button className={btn} onClick={() => onTravel(1)}>
          ⏩ +1 day
        </button>
        <button className={btn} onClick={() => onTravel(7)}>
          ⏩ +7 days
        </button>
        <button className={btn} onClick={() => onTravel(0)} disabled={offsetDays === 0}>
          Back to today
        </button>
        <button
          className="rounded bg-red-900/60 px-3 py-1.5 text-sm text-red-200 hover:bg-red-800"
          onClick={() => {
            if (confirm('Reset all progress? This cannot be undone.')) onReset();
          }}
        >
          Reset progress
        </button>
      </div>
    </div>
  );
}
