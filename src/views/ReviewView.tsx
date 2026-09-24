import { useRef, useState } from 'react';
import { checkAnswer, type AnswerCheck } from '../core/answer';
import { Rating, type Grade } from '../core/scheduler';
import { NEW_NODES_PER_DAY } from '../config';
import type { AppData, CardRow } from '../db/repo';
import Etymology from './Etymology';

const ACCENTS = ['à', 'è', 'é', 'ì', 'ò', 'ù'];

const VERDICT = {
  correct: { text: 'Correct', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
  almost: { text: 'Accepted (almost)', cls: 'border-amber-500/50 bg-amber-500/10 text-amber-300' },
  wrong: { text: 'Not quite', cls: 'border-red-500/50 bg-red-500/10 text-red-300' },
} as const;

type Props = {
  data: AppData;
  current?: CardRow;
  /** conquer/practice: a node the user clicked; due: the automatic queue. */
  mode: 'conquer' | 'practice' | 'due';
  dueCount: number;
  newToday: number;
  onRate: (row: CardRow, grade: Grade) => Promise<void>;
  onCancel: () => void;
};

export default function ReviewView(props: Props) {
  const { data, current, mode, dueCount, newToday, onRate, onCancel } = props;
  const [typed, setTyped] = useState('');
  const [check, setCheck] = useState<AnswerCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const word = current && data.nodes.find((n) => n.id === current.nodeId);
  const toItalian = current?.direction === 'en-it';
  const prompt = word && (toItalian ? word.en : word.it);
  const answer = word && (toItalian ? word.it : word.en);

  const submit = () => {
    if (!answer || !word || check) return;
    const result = checkAnswer(typed, answer, toItalian ? 'it' : 'en');
    if (result.verdict === 'wrong' && toItalian) {
      // Another word with the same English gloss is a valid answer too.
      const same = data.nodes.find(
        (n) =>
          n.id !== word.id &&
          n.en.trim().toLowerCase() === word.en.trim().toLowerCase() &&
          checkAnswer(typed, n.it, 'it').verdict !== 'wrong',
      );
      if (same) {
        return setCheck({
          verdict: 'almost',
          grade: Rating.Hard,
          notes: [`${same.it} also means that; we wanted this one`],
        });
      }
    }
    setCheck(result);
  };

  const rate = async (grade: Grade) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await onRate(current, grade);
    } finally {
      setBusy(false);
    }
  };

  const insert = (ch: string) => {
    const el = input.current;
    const at = el?.selectionStart ?? typed.length;
    setTyped(typed.slice(0, at) + ch + typed.slice(el?.selectionEnd ?? at));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + 1, at + 1);
    });
  };

  const newCls = newToday >= NEW_NODES_PER_DAY ? 'text-amber-400' : '';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex justify-between text-xs uppercase tracking-wider text-slate-400">
        <span>
          {mode === 'conquer' ? 'Conquering' : mode === 'practice' ? 'Defending' : 'Review'}
        </span>
        <span>
          {dueCount} due ·{' '}
          <span className={newCls}>
            new today {newToday}/{NEW_NODES_PER_DAY}
          </span>
        </span>
      </div>

      {!current || !word ? (
        <p className="py-8 text-center text-slate-400">
          Nothing due. Click a <span className="font-semibold text-slate-200">?</span> node on the
          graph to conquer new territory, or a word to practise it.
        </p>
      ) : (
        <>
          <div className="mb-1 flex gap-2 text-xs text-slate-500">
            <span>{toItalian ? 'English → Italian' : 'Italian → English'}</span>
            {word.pos && <span>{word.pos}</span>}
            {mode !== 'due' && (
              <button className="ml-auto text-slate-400 hover:text-slate-200" onClick={onCancel}>
                Cancel ✕
              </button>
            )}
          </div>
          <div className="py-4 text-center text-2xl font-medium">{prompt}</div>

          <input
            ref={input}
            autoFocus
            value={typed}
            readOnly={!!check}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') return e.currentTarget.blur(); // frees WASD for the map
              if (e.key !== 'Enter') return;
              // Otherwise the same Enter also activates the rating button focused after checking.
              e.preventDefault();
              submit();
            }}
            placeholder={toItalian ? 'Type the Italian…' : 'Type the English…'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-lg outline-none focus:border-emerald-500"
          />

          {!check ? (
            <>
              {toItalian && (
                <div className="mt-2 flex gap-1">
                  {ACCENTS.map((ch) => (
                    <button
                      key={ch}
                      onClick={() => insert(ch)}
                      className="rounded bg-slate-800 px-2 py-0.5 text-sm hover:bg-slate-700"
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={submit}
                  className="flex-1 rounded bg-emerald-700 py-2 text-sm hover:bg-emerald-600"
                >
                  Check <span className="text-xs opacity-60">(enter)</span>
                </button>
                <button
                  onClick={() => answer && setCheck(checkAnswer('', answer, 'it'))}
                  className="rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
                >
                  I don't know
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`mt-3 rounded border px-3 py-2 ${VERDICT[check.verdict].cls}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">{VERDICT[check.verdict].text}</span>
                  {check.notes.length > 0 && (
                    <span className="text-xs">{check.notes.join(' · ')}</span>
                  )}
                </div>
                <div className="mt-1 text-xl text-slate-100">{answer}</div>
              </div>
              <Etymology word={word} />
              <button
                autoFocus
                disabled={busy}
                onClick={() => rate(check.grade)}
                className={`mt-3 w-full rounded py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  check.verdict === 'wrong'
                    ? 'bg-red-700 hover:bg-red-600'
                    : 'bg-emerald-700 hover:bg-emerald-600'
                }`}
              >
                Continue <span className="text-xs opacity-60">(enter)</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
