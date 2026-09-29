import type { PlantOption } from '../core/plant';
import type { WordNode } from '../db/repo';
import { PLANT_COST } from '../config';
import Icon, { Sparks } from './Icon';

type Props = {
  anchorName: string;
  anchorCategory: string;
  options: (PlantOption & { word: WordNode; category: string; level: string })[];
  coins: number;
  onPlant: (option: PlantOption) => void;
  onClose: () => void;
};

/** Choose a hidden word (by its English meaning) to connect to a learned one ("plant" in the code). */
export default function PlantPicker(props: Props) {
  const { anchorName, anchorCategory, options, coins, onPlant, onClose } = props;
  const cheapest = Math.min(PLANT_COST, ...options.map((o) => o.cost));
  return (
    <div className="panel p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="eyebrow flex items-center gap-1.5">
            <Icon name="link" className="text-emerald-300" />
            Connect a new word to
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="headword text-2xl">{anchorName}</span>
            <span className="text-xs text-slate-500">{anchorCategory}</span>
          </div>
        </div>
        <button className="icon-btn -mr-1.5 -mt-1" onClick={onClose} title="Close">
          <Icon name="x" />
        </button>
      </div>
      <p className={`mt-2 text-xs ${coins >= cheapest ? 'text-slate-500' : 'text-amber-300'}`}>
        You have <Sparks n={coins} />
      </p>
      {options.length === 0 ? (
        <p className="mt-3 text-slate-400">Nothing to connect here.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {options.map((o) => (
            <li key={o.id}>
              <button
                disabled={coins < o.cost}
                onClick={() => onPlant(o)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-left transition hover:border-emerald-400/60 hover:bg-emerald-400/[0.07] disabled:opacity-50 disabled:hover:border-white/10 disabled:hover:bg-transparent"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-100">{o.word.en}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                    {o.level} · <Sparks n={o.cost} className="text-slate-300" />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={o.sameCategory ? 'text-emerald-300' : 'text-slate-400'}>
                    {o.word.pos ?? 'word'} · {o.category}
                    {o.sameCategory && <Icon name="check" className="ml-1 align-[-2px]" />}
                  </span>
                  <span
                    className="inline-block h-1 w-12 overflow-hidden rounded bg-white/[0.08]"
                    title="How strongly it links to this word"
                  >
                    <span
                      className="block h-full rounded bg-sky-400/80"
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
