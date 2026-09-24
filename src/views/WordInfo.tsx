import { MAX_STRENGTH } from '../core/strength';
import { PRONOUNS, TENSES, type TenseCard } from '../core/verbs';
import type { WordNode } from '../db/repo';
import Etymology from './Etymology';

type Props = {
  word: WordNode;
  health: number | null;
  control: number;
  strength: number;
  /** Why the word can't be practised right now, e.g. "come back in ~2 days". */
  status: string;
  verbLevel?: number;
  tenseCards: TenseCard[];
  onClose: () => void;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A conquered word you can look at any time: meaning, etymology, strength, tenses. */
export default function WordInfo(props: Props) {
  const { word, health, control, strength, status, verbLevel, tenseCards, onClose } = props;
  const learned = TENSES.filter((t) => tenseCards.some((c) => c.tense === t));
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-slate-900 p-4 text-sm">
      <div className="mb-2 flex justify-between text-xs uppercase tracking-wider text-emerald-300/80">
        <span>Your word</span>
        <button className="normal-case text-slate-400 hover:text-slate-200" onClick={onClose}>
          Close ✕
        </button>
      </div>
      <div className="text-2xl font-medium">{word.it}</div>
      <div className="text-slate-300">{word.en}</div>
      <div className="mt-1 text-xs text-slate-500">
        {[word.pos, word.theme && `theme ${word.theme}`].filter(Boolean).join(' · ')}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded bg-slate-800 py-1.5">
          <div className="text-amber-300">
            {'★'.repeat(strength)}
            {'☆'.repeat(MAX_STRENGTH - strength)}
          </div>
          <div className="text-slate-500">strength</div>
        </div>
        <div className="rounded bg-slate-800 py-1.5">
          <div className="text-slate-200">{health === null ? '—' : pct(health)}</div>
          <div className="text-slate-500">health</div>
        </div>
        <div className="rounded bg-slate-800 py-1.5">
          <div className="text-slate-200">{pct(control)}</div>
          <div className="text-slate-500">control</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">{status}</p>
      <Etymology word={word} />
      {verbLevel !== undefined && word.conjugations && (
        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wider text-amber-300/80">
            Verb level {verbLevel}/{TENSES.length}
          </div>
          {learned.length === 0 ? (
            <p className="text-xs text-slate-500">
              No tenses yet: the presente is your next level.
            </p>
          ) : (
            learned.map((t) => (
              <div key={t} className="mb-1.5">
                <div className="text-xs text-slate-400">{t}</div>
                <div className="grid grid-cols-2 gap-x-3 text-xs">
                  {word.conjugations![t]?.map((f, i) => (
                    <span key={i}>
                      <span className="text-slate-500">{PRONOUNS[i]}</span> {f}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
