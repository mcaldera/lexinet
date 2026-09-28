import type { Region } from '../db/repo';

type Props = {
  regions: Region[];
  /** A category's id, or undefined for anywhere. */
  onPick: (region?: number) => void;
};

/** A new game: pick a category to start in, or let chance decide. */
export default function StartPicker({ regions, onPick }: Props) {
  const sorted = [...regions].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(2,6,23,0.7),rgba(2,6,23,0.95))] p-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl">
        <h2 className="mb-2 text-center font-title text-3xl font-bold tracking-[0.08em] text-emerald-100 [text-shadow:0_0_24px_rgba(52,211,153,0.45)]">
          Where to begin?
        </h2>
        <p className="mb-5 text-center text-sm text-slate-500">Your territory grows from there.</p>
        <button
          autoFocus
          onClick={() => onPick()}
          className="btn-primary mx-auto mb-6 block rounded-full px-6 py-2"
        >
          🎲 Anywhere
        </button>
        {sorted.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {sorted.map((r) => (
              <button
                key={r.id}
                onClick={() => onPick(r.id)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm text-slate-300 transition hover:-translate-y-px hover:border-emerald-400/60 hover:bg-emerald-400/10 hover:text-emerald-100 hover:shadow-[0_0_16px_-4px_rgba(52,211,153,0.6)]"
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
