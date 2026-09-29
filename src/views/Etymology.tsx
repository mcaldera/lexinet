import type { WordNode } from '../db/repo';

/** Root and English cousin of a word, e.g. Latin panis "bread" ≈ companion. */
export default function Etymology({ word }: { word: WordNode }) {
  if (!word.root && !word.cognate) return null;
  return (
    <div className="mt-3 flex gap-2.5 text-xs text-slate-400">
      <span className="eyebrow pt-[3px]">Origin</span>
      <div className="min-w-0 space-y-0.5">
        {word.root && (
          <div>
            {word.root_lang ?? ''}{' '}
            <i className="font-latin text-[1.25em] font-semibold text-pink-200">{word.root}</i>
            {word.root_meaning && <span> “{word.root_meaning}”</span>}
          </div>
        )}
        {word.cognate && (
          <div title={word.cognate_note ?? undefined}>
            <span className="text-slate-500">≈</span>{' '}
            <span className="text-slate-200">{word.cognate}</span>
            {word.cognate_note && <span className="text-slate-500"> · {word.cognate_note}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
