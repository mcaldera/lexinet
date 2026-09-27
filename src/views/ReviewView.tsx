import { useEffect, useRef, useState } from 'react';
import { checkAnswer, type AnswerCheck } from '../core/answer';
import { meaningChoices } from '../core/choices';
import { cloze } from '../core/cloze';
import { canSpeak, speak, speakAuto } from '../speech';
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
  /** `typed`: false when the answer was picked from choices (no fast track). */
  onRate: (row: CardRow, grade: Grade, typed: boolean) => Promise<void>;
  onCancel: () => void;
  /** A card's prompt is on screen (reopening the word must not switch direction). */
  onShow?: (row: CardRow) => void;
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
  // Reviews of your own words into Italian fill the gap in a sentence when there is one.
  const gap = word?.example && toItalian && !claimStep && !reclaim ? cloze(word.example) : null;
  // A word never seen before starts as multiple choice (typing it is the fast track).
  const [choices] = useState(() =>
    word && firstSight && !toItalian && claimStep?.step === 1
      ? meaningChoices(word, data.nodes)
      : null,
  );
  // A new word starts typed (right at first sight = the fast track). Choosing is
  // one way: once the options have shown, typing would prove nothing.
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (current) props.onShow?.(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Italian on screen is said aloud (never the answer before it's revealed).
  useEffect(() => {
    if (word && !toItalian) speakAuto(word.it);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word?.id]);
  useEffect(() => {
    if (check && word && toItalian) speakAuto(gap ? word.example!.it : word.it);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);

  const choose = (c: string) => {
    if (check || !word) return;
    setPicked(c);
    setCheck(
      c === word.en
        ? { verdict: 'correct', grade: Rating.Good, notes: [] }
        : { verdict: 'wrong', grade: Rating.Again, notes: [] },
    );
  };
  useEffect(() => {
    if (!choosing || check || !choices) return;
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < choices.length) choose(choices[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = () => {
    if (!answer || !word || check) return;
    let result = checkAnswer(typed, answer, toItalian ? 'it' : 'en');
    if (gap && result.verdict !== 'correct') {
      // The gap's own form ("cane" for "il cane") is exactly right there.
      const inGap = checkAnswer(typed, word.example!.blank, 'it');
      if (inGap.verdict !== 'wrong') result = inGap;
    }
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
      await onRate(current, grade, !choosing);
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
          {gap ? (
            <div className="pb-1 pt-3 text-center">
              <div className="text-xl">
                {gap.before}
                <span className="inline-block min-w-16 border-b-2 border-emerald-500 text-emerald-200">
                  {check ? word.example!.blank : '\u00a0'}
                </span>
                {gap.after}
              </div>
              <div className="mt-1 text-sm text-slate-400">{word.example!.en}</div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 pb-1 pt-3">
              <span className="text-2xl font-medium">{prompt}</span>
              {!toItalian && <SpeakButton text={word.it} />}
            </div>
          )}
          <div className="mb-3 text-center text-xs text-slate-500">
            {gap ? `${word.en} · ` : ''}
            {toItalian ? 'in Italian' : 'in English'}
            {word.pos && ` · ${word.pos}`}
          </div>
          {choices && !choosing && !check && (
            <div className="mb-2 flex justify-center text-xs">
              <button
                onClick={() => setChoosing(true)}
                title="Show 4 meanings to choose from (no fast track, and no going back to typing)"
                className="rounded border border-slate-700 px-2.5 py-0.5 text-slate-400 hover:border-slate-500 hover:text-slate-200"
              >
                ☰ Choose instead
              </button>
            </div>
          )}

          {choosing && choices ? (
            <div className="space-y-1.5">
              {choices.map((c, i) => {
                const right = !!check && c === word.en;
                const wrong = !!check && c === picked && c !== word.en;
                return (
                  <button
                    key={c}
                    disabled={!!check}
                    onClick={() => choose(c)}
                    className={`flex w-full items-center gap-2 rounded border px-3 py-1.5 text-left text-sm ${
                      right
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-100'
                        : wrong
                          ? 'border-red-500 bg-red-500/15 text-red-200'
                          : 'border-slate-700 hover:border-slate-500 disabled:opacity-60'
                    }`}
                  >
                    <span className="text-xs text-slate-500">{i + 1}</span> {c}
                  </button>
                );
              })}
              {!check && (
                <div className="flex justify-end pt-1 text-xs">
                  <button
                    onClick={() => answer && setCheck(checkAnswer('', answer, 'en'))}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    Show me
                  </button>
                </div>
              )}
            </div>
          ) : (
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
          )}

          {choosing && !check ? null : !check ? (
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
                <div className="mt-0.5 flex items-center gap-2 text-xl text-slate-100">
                  {answer}
                  <SpeakButton text={word.it} />
                </div>
              </div>
              {word.example && !gap && <ExampleLine example={word.example} />}
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

/** Say Italian aloud (hidden where the browser has no speech). */
export function SpeakButton({ text, title = 'Listen' }: { text: string; title?: string }) {
  if (!canSpeak()) return null;
  return (
    <button
      onClick={() => speak(text)}
      title={title}
      className="text-base text-slate-500 hover:text-slate-200"
    >
      🔊
    </button>
  );
}

/** A sentence using the word, with its translation (from Tatoeba). */
export function ExampleLine({ example }: { example: { it: string; en: string } }) {
  return (
    <div className="mt-3 text-sm">
      <div className="flex items-start gap-1.5 text-slate-200">
        <span className="italic">{example.it}</span>
        <SpeakButton text={example.it} title="Listen to the sentence" />
      </div>
      <div className="text-xs text-slate-500">{example.en}</div>
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
