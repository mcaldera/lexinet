import { useRef, useState } from 'react';
import { checkAnswer, type AnswerCheck } from '../core/answer';
import { CLAIM_STEP_NAMES, unseen, type ClaimStep } from '../core/claim';
import { Rating, type Grade } from '../core/scheduler';
import type { AppData, CardRow } from '../db/repo';
import Etymology from './Etymology';

const ACCENTS = ['à', 'è', 'é', 'ì', 'ò', 'ù'];

const VERDICT = {
  correct: { text: 'Correct', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
  almost: { text: 'Almost', cls: 'border-amber-500/50 bg-amber-500/10 text-amber-300' },
  wrong: { text: 'Not quite', cls: 'border-red-500/50 bg-red-500/10 text-red-300' },
} as const;

type Props = {
  data: AppData;
  current?: CardRow;
  /** conquer/practice: a node the user clicked; due: the automatic queue. */
  mode: 'conquer' | 'practice' | 'due';
  dueCount: number;
  /** Idle: go to the next thing to do (an open claim step or the nearest "?"). */
  onNext?: () => void;
  /** A lost word one right answer wins back: what it was and until when (app ms). */
  reclaim?: { was: 'conquered' | 'claimed'; steps: number; until: number };
  nowMs?: number;
  /** Cards due away from the word you're on (the review doesn't jump there). */
  elsewhere?: number;
  /** Word not conquered yet: the claim step this answer completes. */
  claimStep?: ClaimStep | null;
  onRate: (row: CardRow, grade: Grade) => Promise<void>;
  onCancel: () => void;
};

export default function ReviewView(props: Props) {
  const { data, current, mode, dueCount, onNext, claimStep, elsewhere, reclaim, onRate, onCancel } =
    props;
  const [typed, setTyped] = useState('');
  const [check, setCheck] = useState<AnswerCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const word = current && data.nodes.find((n) => n.id === current.nodeId);
  // Never seen before: not knowing it is learning, not a miss (see App.onRate).
  const firstSight = !!current && unseen(data.cards.filter((c) => c.nodeId === current.nodeId));
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

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      {!current || !word ? (
        <div className="py-4 text-center text-sm text-slate-400">
          {elsewhere ? (
            <p className="mb-3">
              {elsewhere} due elsewhere · <kbd className="text-slate-200">N</kbd>
            </p>
          ) : null}
          {onNext ? (
            <button
              autoFocus
              onClick={onNext}
              className="w-full rounded bg-emerald-700 py-2 font-medium text-white hover:bg-emerald-600"
            >
              Next word <span className="text-xs opacity-60">(enter)</span>
            </button>
          ) : (
            !elsewhere && <p>Pick a ? on the map.</p>
          )}
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
            {reclaim ? (
              <span className="text-teal-300">
                ↺ win back · {timeLeft(reclaim.until - (props.nowMs ?? 0))}
              </span>
            ) : claimStep ? (
              <ClaimSteps step={claimStep.step} />
            ) : (
              <span>review{dueCount > 1 ? ` · ${dueCount} due` : ''}</span>
            )}
            {mode !== 'due' && (
              <button
                className="ml-auto text-slate-500 hover:text-slate-200"
                onClick={onCancel}
                title="Cancel"
              >
                ✕
              </button>
            )}
          </div>
          <div className="pb-1 pt-3 text-center text-2xl font-medium">{prompt}</div>
          <div className="mb-3 text-center text-xs text-slate-500">
            {toItalian ? 'in Italian' : 'in English'}
            {word.pos && ` · ${word.pos}`}
          </div>

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
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-lg outline-none focus:border-emerald-500"
          />

          {!check ? (
            <>
              {toItalian && (
                <div className="mt-1.5 flex gap-1">
                  {ACCENTS.map((ch) => (
                    <button
                      key={ch}
                      onClick={() => insert(ch)}
                      className="rounded px-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
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
                  Check
                </button>
                <button
                  onClick={() => answer && setCheck(checkAnswer('', answer, 'it'))}
                  className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
                >
                  {firstSight ? 'Show me' : "Don't know"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`mt-3 rounded border px-3 py-2 ${VERDICT[check.verdict].cls}`}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold">
                    {firstSight && check.verdict === 'wrong'
                      ? 'New word'
                      : VERDICT[check.verdict].text}
                  </span>
                  {check.notes.length > 0 && <span>{check.notes.join(' · ')}</span>}
                </div>
                <div className="mt-0.5 text-xl text-slate-100">{answer}</div>
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
                Continue
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Where this answer sits in conquering a word: three dots and the step's name. */
function ClaimSteps({ step }: { step: number }) {
  return (
    <span
      className="flex items-center gap-1.5"
      title={`Step ${step} of ${CLAIM_STEP_NAMES.length}`}
    >
      <StepDots done={step - 1} current={step} />
      <span className="text-slate-400">{CLAIM_STEP_NAMES[step - 1]}</span>
    </span>
  );
}

/** Claim progress as three dots: done, the one in play, still to come. */
export function StepDots({ done, current }: { done: number; current?: number }) {
  return (
    <span className="flex gap-0.5">
      {CLAIM_STEP_NAMES.map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < done ? 'bg-emerald-400' : i + 1 === current ? 'bg-slate-200' : 'bg-slate-700'
          }`}
        />
      ))}
    </span>
  );
}

/** "2 d 5 h", "5 h", "40 min" */
export function timeLeft(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d ${h % 24} h`;
}
