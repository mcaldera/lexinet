import type { WordNode } from '../db/repo';

/** Root and English cousin of a word, e.g. Latin panis "bread" -> companion. */
export default function Etymology({ word }: { word: WordNode }) {
  if (!word.root && !word.cognate) return null;
  return (
    <div className="mt-3 rounded border border-pink-500/30 bg-pink-500/5 px-3 py-2 text-sm">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-pink-300/80">Etymology</div>
      {word.root && (
        <div className="text-slate-200">
          From {word.root_lang ?? ''} <i className="text-pink-200">{word.root}</i>
          {word.root_meaning && <span className="text-slate-400"> “{word.root_meaning}”</span>}
        </div>
      )}
      {word.cognate && (
        <div className="mt-1 text-slate-200">
          English cousin: <b className="text-pink-200">{word.cognate}</b>
          {word.cognate_note && <div className="text-xs text-slate-400">{word.cognate_note}</div>}
        </div>
      )}
    </div>
  );
}
