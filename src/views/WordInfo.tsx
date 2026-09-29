import type { ReactNode } from 'react';
import { PRONOUNS, TENSES, type TenseCard } from '../core/verbs';
import type { WordNode } from '../db/repo';
import { ExampleLine, SpeakButton } from './ReviewView';

type Props = {
  word: WordNode;
  /** Its status (NodeDetails, bare): supply, memory timeline, verb, plant, etymology. */
  children?: ReactNode;
  verbLevel?: number;
  tenseCards: TenseCard[];
  onClose: () => void;
};

/** A conquered word you can look at any time: meaning, its status (supply, memory), example, tenses. */
export default function WordInfo(props: Props) {
  const { word, verbLevel, tenseCards, onClose, children } = props;
  const learned = TENSES.filter((t) => tenseCards.some((c) => c.tense === t));
  return (
    <div className="panel border-emerald-500/30 p-4 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-2xl font-medium">
            {word.it} <SpeakButton text={word.it} />
          </div>
          {word.pl && <div className="text-xs text-slate-500">pl. {word.pl}</div>}
          <div className="text-slate-300">{word.en}</div>
        </div>
        <button className="text-xs text-slate-500 hover:text-slate-200" onClick={onClose}>
          ✕
        </button>
      </div>
      {word.pos && <div className="mt-1 text-xs text-slate-500">{word.pos}</div>}
      {children && <div className="-mx-1 mt-2">{children}</div>}
      {word.example && <ExampleLine example={word.example} />}
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
