import { useEffect, useState } from 'react';
import { sfx } from '../audio';
import type { GameEvent } from '../useSprawl';
import Icon, { Sparks } from './Icon';

/**
 * The pop quiz (core/raid.ts) as a moment: it strikes with an alarm, a flash
 * at the map's edges and a big title; while it runs the edges keep glowing and
 * the side panel leads with it (`QuizStrip`); passing it lands with a fanfare,
 * gold, and what speed earned. It used to be three chips in a corner (author,
 * Sep 2026: "more dramatic, more victory").
 */
export function QuizMoment({
  event,
}: {
  event: Extract<GameEvent, { kind: 'raid' | 'raid-won' }>;
}) {
  const [shown, setShown] = useState(true);
  const won = event.kind === 'raid-won';
  useEffect(() => {
    sfx(won ? 'fanfare' : 'alarm');
    const t = setTimeout(() => setShown(false), 2900);
    return () => clearTimeout(t);
  }, [won]);
  if (!shown) return null;
  const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden">
      <div
        className={`quiz-flash absolute inset-0 ${won ? 'quiz-flash-gold' : 'quiz-flash-orange'}`}
      />
      <div className="quiz-in rounded-2xl bg-slate-950/70 px-10 py-6 text-center shadow-2xl backdrop-blur-md">
        <div
          className={`font-title text-5xl font-bold tracking-[0.25em] ${
            won
              ? 'text-amber-200 [text-shadow:0_0_30px_rgba(251,191,36,0.7)]'
              : 'text-orange-200 [text-shadow:0_0_30px_rgba(249,115,22,0.8)]'
          }`}
        >
          {won ? (event.speed >= 3 ? 'Aced' : 'Passed') : 'Pop quiz'}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-100">
          {won ? (
            <>
              {words(event.ids.length)} in {clock(event.tookMs)}
              <span className="text-slate-500">·</span>
              <span className="inline-flex items-center gap-1 text-amber-200">
                +<Sparks n={event.coins} />
              </span>
              {event.speed > 0 && (
                <span className="text-amber-300/70">(+{event.speed} for speed)</span>
              )}
            </>
          ) : (
            <>Answer {words(event.count)} into Italian before the clock runs out</>
          )}
        </div>
      </div>
    </div>
  );
}

/** While a quiz runs: the map's edges glow and breathe. */
export function QuizEdge() {
  return <div className="quiz-edge pointer-events-none absolute inset-0 z-[5]" />;
}

/**
 * The quiz at the top of the side panel: a draining clock, and a chip per
 * word (English until saved; click one to take it). The panel serves the
 * words one after another by itself.
 */
export function QuizStrip(props: {
  targets: string[];
  defended: string[];
  start: number;
  until: number;
  nowMs: number;
  meaning: (id: string) => string;
  name: (id: string) => string;
  onWord: (id: string) => void;
}) {
  const left = Math.max(0, props.until - props.nowMs);
  const share = left / Math.max(1, props.until - props.start);
  return (
    <div className="rounded-xl border border-orange-500/50 bg-orange-950/40 p-3 shadow-[0_0_40px_-12px_rgba(249,115,22,0.8)]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-orange-200">
          <Icon name="timer" className="animate-pulse text-orange-300" />
          Pop quiz
          <span className="font-normal text-orange-300/70">
            {props.defended.length}/{props.targets.length}
          </span>
        </span>
        <span
          className={`font-mono text-sm tabular-nums ${left < 30_000 ? 'animate-pulse text-rose-300' : 'text-orange-200'}`}
        >
          {clock(left)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-orange-950">
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
            left < 30_000 ? 'bg-rose-400' : 'bg-gradient-to-r from-orange-500 to-amber-300'
          }`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {props.targets.map((id) =>
          props.defended.includes(id) ? (
            <span
              key={id}
              className="quiz-saved inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-200"
            >
              <Icon name="check" />
              {props.name(id)}
            </span>
          ) : (
            <button
              key={id}
              onClick={() => props.onWord(id)}
              className="rounded-md bg-orange-800/60 px-2 py-0.5 text-orange-100 hover:bg-orange-700"
            >
              {props.meaning(id)}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/** "0:52" */
function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
