import type { ReactNode } from 'react';
import { persons, tenses, type TenseCard } from '../core/verbs';
import type { WordNode } from '../db/repo';
import Icon from './Icon';
import { ExampleLine, SpeakButton } from './ReviewView';

type Props = {
  word: WordNode;
  /** Its status (NodeDetails, bare): signal, memory, verb, example, origin, actions. */
  children?: ReactNode;
  verbLevel?: number;
  tenseCards: TenseCard[];
  onClose: () => void;
};

/**
 * A learned word you can look at any time, like a dictionary entry: the word,
 * its part of speech and meaning, then its status, example and tenses.
 */
export default function WordInfo(props: Props) {
  const { word, verbLevel, tenseCards, onClose, children } = props;
  const learned = tenses().filter((t) => tenseCards.some((c) => c.tense === t));
  return (
    <div className="panel p-4 text-sm">
      <HeadWord
        word={word.it}
        pos={word.pos}
        meaning={word.en}
        plural={word.pl}
        onClose={onClose}
      />
      {children ? (
        <div className="mt-4">{children}</div>
      ) : (
        word.example && <ExampleLine example={word.example} />
      )}
      {verbLevel !== undefined && word.conjugations && learned.length > 0 && (
        <div className="mt-4 space-y-2.5 border-t border-white/[0.06] pt-3">
          {learned.map((t) => (
            <div key={t}>
              <div className="eyebrow mb-1 text-amber-300/70">{t}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {word.conjugations![t]?.map((f, i) => (
                  <span key={i}>
                    <span className="text-slate-500">{persons()[i]}</span> {f}
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

/** The head of a word's card: the Italian word, then part of speech and meaning. */
export function HeadWord(props: {
  word: string;
  pos?: string | null;
  meaning?: string;
  plural?: string | null;
  /** Say the word aloud (only once its Italian may be shown). */
  speak?: boolean;
  onClose?: () => void;
}) {
  const { word, pos, meaning, plural, speak = true, onClose } = props;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h2 className="headword break-words text-[2rem]">{word}</h2>
          {speak && <SpeakButton text={word} />}
        </div>
        {(pos || meaning) && (
          <div className="mt-1.5 text-slate-300">
            {pos && <i className="mr-1.5 font-serif text-[1.05em] text-slate-500">{pos}</i>}
            {meaning}
          </div>
        )}
        {plural && <div className="mt-0.5 text-xs text-slate-500">pl. {plural}</div>}
      </div>
      {onClose && (
        <button className="icon-btn -mr-1.5 -mt-1" onClick={onClose} title="Close">
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}
