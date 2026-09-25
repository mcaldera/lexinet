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
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl">
        <h2 className="mb-1 text-center text-2xl font-semibold text-slate-100">Where to begin?</h2>
        <p className="mb-5 text-center text-sm text-slate-500">Your territory grows from there.</p>
        <button
          autoFocus
          onClick={() => onPick()}
          className="mx-auto mb-5 block rounded-lg bg-emerald-700 px-5 py-2 font-medium text-white hover:bg-emerald-600"
        >
          🎲 Anywhere
        </button>
        {sorted.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {sorted.map((r) => (
              <button
                key={r.id}
                onClick={() => onPick(r.id)}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:border-emerald-500 hover:text-emerald-200"
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
