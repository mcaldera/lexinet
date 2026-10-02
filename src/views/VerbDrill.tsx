import { useRef, useState } from 'react';
import type { Verdict } from '../core/answer';
import type { Grade } from '../core/scheduler';
import { checkConjugation, persons, tenses, type Tense } from '../core/verbs';
import type { WordNode } from '../db/repo';
import Icon from './Icon';
import { HeadWord } from './WordInfo';

type Props = {
  word: WordNode;
  tense: Tense;
  /** learn: earn the next level; defend: a learned tense is due for review. */
  kind: 'learn' | 'defend';
  onDone: (grade: Grade) => void;
  onCancel: () => void;
};

const ROW = {
  correct: 'border-emerald-500/60 text-emerald-200',
  almost: 'border-amber-500/60 text-amber-200',
  wrong: 'border-red-500/60 text-red-200',
} as const;

/** Conjugate one tense in every person. */
export default function VerbDrill({ word, tense, kind, onDone, onCancel }: Props) {
  const forms = word.conjugations?.[tense] ?? [];
  const [inputs, setInputs] = useState<string[]>(() => forms.map(() => ''));
  const [result, setResult] = useState<{ rows: Verdict[]; grade: Grade } | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const level = tenses().indexOf(tense) + 1;

  const check = () => setResult(checkConjugation(inputs, forms));
  const passed = result && !result.rows.includes('wrong');

  return (
    <div className="panel p-4 text-sm">
      <div className="mb-3 flex items-center justify-between text-xs text-amber-300/90">
        <span className="eyebrow text-amber-300/80">
          {tense}
          {kind === 'learn' ? ` · ★${level}` : ' · review'}
        </span>
        <button className="icon-btn -my-1 -mr-1.5" onClick={onCancel} title="Cancel">
          <Icon name="x" />
        </button>
      </div>
      <div className="mb-4">
        <HeadWord word={word.it} pos={word.pos} meaning={word.en} />
      </div>
      <div className="space-y-1.5">
        {forms.map((form, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-right text-slate-400">{persons()[i]}</span>
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              autoFocus={i === 0}
              value={inputs[i]}
              readOnly={!!result}
              onChange={(e) => setInputs((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (result) return onDone(result.grade);
                if (i < forms.length - 1) refs.current[i + 1]?.focus();
                else check();
              }}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={`field min-w-0 flex-1 px-2 py-1 focus:border-amber-400/70 focus:shadow-[0_0_0_3px_rgba(251,191,36,0.15)] ${
                result ? ROW[result.rows[i]] : ''
              }`}
            />
            {result && result.rows[i] !== 'correct' && (
              <span className="shrink-0 text-xs text-slate-300">{form}</span>
            )}
          </div>
        ))}
      </div>
      {result && (
        <div
          className={`mt-3 text-center font-semibold ${passed ? 'text-emerald-300' : 'text-red-300'}`}
        >
          {passed ? (kind === 'learn' ? `★${level} ${tense}` : 'Still there') : 'Not yet'}
        </div>
      )}
      <button
        autoFocus={!!result}
        onClick={() => (result ? onDone(result.grade) : check())}
        className="btn mt-3 w-full bg-amber-400 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-300"
      >
        {result ? 'Continue' : 'Check'}
      </button>
    </div>
  );
}
