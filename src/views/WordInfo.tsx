import { MAX_STRENGTH } from '../core/strength';
import { PRONOUNS, TENSES, type TenseCard } from '../core/verbs';
import type { WordNode } from '../db/repo';

type Props = {
  word: WordNode;
  strength: number;
  /** Why the word can't be practised right now, e.g. "come back in ~2 days". */
  status: string;
  verbLevel?: number;
  tenseCards: TenseCard[];
  onClose: () => void;
};

/** A conquered word you can look at any time: meaning, etymology, strength, tenses. */
export default function WordInfo(props: Props) {
  const { word, strength, status, verbLevel, tenseCards, onClose } = props;
  const learned = TENSES.filter((t) => tenseCards.some((c) => c.tense === t));
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-slate-900 p-4 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl font-medium">{word.it}</div>
          <div className="text-slate-300">{word.en}</div>
        </div>
        <button className="text-xs text-slate-500 hover:text-slate-200" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        <span className="text-amber-300" title="Strength">
          {'★'.repeat(strength)}
          <span className="text-slate-700">{'★'.repeat(MAX_STRENGTH - strength)}</span>
        </span>
        {word.pos && <span>{word.pos}</span>}
      </div>
      <p className="mt-2 text-xs text-slate-500">{status}</p>
      {verbLevel !== undefined && word.conjugations && learned.length > 0 && (
        <div className="mt-3 space-y-2">
          {learned.map((t) => (
            <div key={t}>
              <div className="text-xs text-amber-300/80">{t}</div>
              <div className="grid grid-cols-2 gap-x-3 text-xs">
                {word.conjugations![t]?.map((f, i) => (
                  <span key={i}>
                    <span className="text-slate-500">{PRONOUNS[i]}</span> {f}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
