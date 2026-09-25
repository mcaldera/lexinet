import { useRef, useState } from 'react';
import type { Verdict } from '../core/answer';
import type { Grade } from '../core/scheduler';
import { checkConjugation, PRONOUNS, TENSES, type Tense } from '../core/verbs';
import type { WordNode } from '../db/repo';

type Props = {
  word: WordNode;
  tense: Tense;
  /** learn: earn the next level; defend: a learned tense is due. */
  kind: 'learn' | 'defend';
  onDone: (grade: Grade) => void;
  onCancel: () => void;
};

const ROW = {
  correct: 'border-emerald-500/60 text-emerald-200',
  almost: 'border-amber-500/60 text-amber-200',
  wrong: 'border-red-500/60 text-red-200',
} as const;

/** Conjugate one tense in all six persons. */
export default function VerbDrill({ word, tense, kind, onDone, onCancel }: Props) {
  const forms = word.conjugations?.[tense] ?? [];
  const [inputs, setInputs] = useState<string[]>(() => forms.map(() => ''));
  const [result, setResult] = useState<{ rows: Verdict[]; grade: Grade } | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const level = TENSES.indexOf(tense) + 1;

  const check = () => setResult(checkConjugation(inputs, forms));
  const passed = result && !result.rows.includes('wrong');

  return (
    <div className="rounded-lg border border-amber-500/40 bg-slate-900 p-4 text-sm">
      <div className="mb-3 flex justify-between text-xs text-amber-300/90">
        <span>
          {tense}
          {kind === 'learn' ? ` · ★${level}` : ''}
        </span>
        <button className="text-slate-500 hover:text-slate-200" onClick={onCancel}>
          ✕
        </button>
      </div>
      <div className="mb-3 text-center">
        <div className="text-2xl font-medium">{word.it}</div>
        <div className="text-slate-400">{word.en}</div>
      </div>
      <div className="space-y-1.5">
        {forms.map((form, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-right text-slate-400">{PRONOUNS[i]}</span>
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
              spellCheck={false}
              className={`min-w-0 flex-1 rounded border bg-slate-950 px-2 py-1 outline-none focus:border-amber-400 ${
                result ? ROW[result.rows[i]] : 'border-slate-700'
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
          {passed ? (kind === 'learn' ? `★${level} ${tense}` : 'Defended') : 'Not yet'}
        </div>
      )}
      <button
        autoFocus={!!result}
        onClick={() => (result ? onDone(result.grade) : check())}
        className="mt-3 w-full rounded bg-amber-700 py-2 text-sm hover:bg-amber-600"
      >
        {result ? 'Continue' : 'Check'}
      </button>
    </div>
  );
}
