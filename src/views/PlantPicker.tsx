import type { PlantOption } from '../core/plant';
import type { WordNode } from '../db/repo';
import { PLANT_COST } from '../config';

type Props = {
  anchorName: string;
  anchorCategory: string;
  options: (PlantOption & { word: WordNode; category: string; level: string })[];
  coins: number;
  onPlant: (option: PlantOption) => void;
  onClose: () => void;
};

/** Choose a hidden word (by its English meaning) to plant next to a conquered one. */
export default function PlantPicker(props: Props) {
  const { anchorName, anchorCategory, options, coins, onPlant, onClose } = props;
  const cheapest = Math.min(PLANT_COST, ...options.map((o) => o.cost));
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-slate-900 p-4 text-sm">
      <div className="flex justify-between text-xs text-emerald-300/90">
        <span>
          🌱 Plant next to <b>{anchorName}</b>{' '}
          <span className="text-slate-500">· {anchorCategory}</span>
        </span>
        <button className="text-slate-500 hover:text-slate-200" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className={`mt-1 text-xs ${coins >= cheapest ? 'text-slate-500' : 'text-amber-300'}`}>
        🪙 {coins}
      </p>
      {options.length === 0 ? (
        <p className="mt-3 text-slate-400">Nothing to plant here.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {options.map((o) => (
            <li key={o.id}>
              <button
                disabled={coins < o.cost}
                onClick={() => onPlant(o)}
                className="w-full rounded border border-slate-700 px-3 py-2 text-left hover:border-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50 disabled:hover:border-slate-700 disabled:hover:bg-transparent"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-100">{o.word.en}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {o.level} · 🪙{o.cost}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={o.sameCategory ? 'text-emerald-300' : 'text-slate-400'}>
                    {o.word.pos ?? 'word'} · {o.category}
                    {o.sameCategory && ' ✓'}
                  </span>
                  <span className="inline-block h-1 w-12 overflow-hidden rounded bg-slate-800">
                    <span
                      className="block h-full bg-sky-400"
                      style={{ width: `${Math.round(Math.min(1, o.weight / 0.7) * 100)}%` }}
                    />
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
