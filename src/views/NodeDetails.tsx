import type { ReactNode } from 'react';
import { TENSES, type Drill } from '../core/verbs';
import type { ClaimStep } from '../core/claim';
import type { NodeState } from '../core/unlock';
import type { WordNode } from '../db/repo';
import Etymology from './Etymology';
import Icon, { Sparks } from './Icon';
import { ExampleLine, StepDots, timeLeft } from './ReviewView';
import { MAX_STRENGTH, type MemoryOutlook } from '../core/strength';

type Props = {
  word: WordNode;
  state: NodeState;
  /** The name as the player may see it (faded words lose letters; '' = gone). */
  name: string;
  health: number | null;
  /** Learned words: their memory (strength, due, slipping, next level) and recall now (0-1). */
  memory?: { outlook: MemoryOutlook; recall: number | null };
  /** Its signal (core/supply.ts: "supply" in the code). */
  supply?: {
    value: number;
    min: number;
    /** The core word (the capital in the code). */
    capital: boolean;
    /** A learned word: what it sends out while it hasn't slipped (by memory strength and tenses). */
    sends?: number;
    /** An anchor: sends out full signal (known for months). */
    stronghold: boolean;
    /** Slipped (broken in the code). */
    broken: boolean;
    /** Slipped by a miss (else by fading past the line). */
    missed: boolean;
    /** Disconnected (it hasn't slipped itself): fades at this app time. */
    cutUntil?: number;
    /** Slipped and so disconnected too: fades at this app time. */
    brokenUntil?: number;
    /** Learned words that would be disconnected if it slipped (or are, while it has). */
    hanging?: number;
  };
  /** False while this word is being quizzed: etymology and meaning would give it away. */
  showEtymology: boolean;
  /** In the word's own card: its example sentence, between its status and its origin. */
  showExample?: boolean;
  /** Words with an English cousin: buy it as a hint, or see the one bought. */
  hint?: { cognate: string; bought: boolean; cost: number; onBuy: () => void };
  /** Learned words: open the connect picker (core/plant.ts). */
  onPlant?: () => void;
  coins?: number;
  /** A lost word one right answer recovers: what it was and until when (app ms). */
  reclaim?: { was: 'conquered' | 'claimed'; steps: number; until: number };
  /** Words being learned: the step to do next and when it opens (null = complete). */
  claimStep?: ClaimStep | null;
  /** Learned verbs: level and what the next conjugation step is. */
  verb?: { level: number; drill: Drill };
  onConjugate?: () => void;
  nowMs: number;
  /** Inside the word's own card (word card, wait card): no name line, no step countdown. */
  bare?: boolean;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** "3 d", "2 wk", "4 mo": how long a memory lasts. */
const span = (days: number) =>
  days < 1
    ? 'under a day'
    : days < 14
      ? `${Math.round(days)} d`
      : days < 60
        ? `${Math.round(days / 7)} wk`
        : `${Math.round(days / 30)} mo`;

/** "40 min", "5 h", "3 d": time until something. */
const until = (ms: number) =>
  ms < 3_600_000
    ? `${Math.max(1, Math.round(ms / 60_000))} min`
    : ms < 2 * 86_400_000
      ? `${Math.round(ms / 3_600_000)} h`
      : `${Math.round(ms / 86_400_000)} d`;

const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;

/**
 * How a status looks: its chip, the meter's fill and the box around both.
 * Trouble tints the whole box, so a disconnected word stands out at a glance.
 */
const TONE = {
  good: {
    chip: 'bg-amber-300/10 text-amber-200 ring-amber-300/25',
    bar: 'bg-gradient-to-r from-amber-400 to-amber-200',
    box: 'bg-white/[0.025] ring-white/[0.06]',
  },
  warn: {
    chip: 'bg-orange-400/15 text-orange-200 ring-orange-400/40',
    bar: 'bg-orange-400',
    box: 'bg-orange-500/[0.08] ring-orange-400/30',
  },
  bad: {
    chip: 'bg-rose-400/15 text-rose-200 ring-rose-400/40',
    bar: 'bg-rose-400',
    box: 'bg-rose-500/[0.08] ring-rose-400/30',
  },
  due: {
    chip: 'bg-violet-400/15 text-violet-200 ring-violet-400/40',
    bar: 'bg-violet-400',
    box: '',
  },
} as const;
type Tone = keyof typeof TONE;

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset ${TONE[tone].chip}`}
    >
      {children}
    </span>
  );
}

/**
 * Signal against the line a word needs: 0 to 100% (more fills it), with a
 * tick where it stays connected. 41% of 50% is a bar that stops short of it.
 */
function Meter({ value, min, tone }: { value: number; min: number; tone: Tone }) {
  return (
    <div
      className="relative mt-2 h-1.5 rounded-full bg-white/[0.08]"
      title={`Signal ${pct(value)}: it needs ${pct(min)} to stay connected`}
    >
      <div
        className={`h-full rounded-full ${TONE[tone].bar}`}
        style={{ width: `${Math.min(1, value) * 100}%` }}
      />
      <div
        className="absolute -bottom-1 -top-1 w-0.5 rounded-full bg-slate-200/90 shadow-[0_0_0_2px_rgba(15,23,42,0.9)]"
        style={{ left: `calc(${min * 100}% - 1px)` }}
      />
    </div>
  );
}

/**
 * A word's signal at a glance: what it means for the word (chip), how much
 * reaches it against what it needs (meter) and what happens next (one line).
 */
function Signal(props: {
  tone: Tone;
  chips: ReactNode;
  value?: number;
  min: number;
  note?: ReactNode;
}) {
  const { tone, chips, value, min, note } = props;
  const short = value !== undefined && value < min - 1e-9;
  return (
    <div className={`rounded-lg p-2.5 ring-1 ring-inset ${TONE[tone].box}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1">{chips}</span>
        {value !== undefined && (
          <span className="shrink-0 tabular-nums text-slate-300">
            {pct(value)}
            {short && <span className="text-slate-500"> / {pct(min)}</span>}
          </span>
        )}
      </div>
      {value !== undefined && <Meter value={value} min={min} tone={tone} />}
      {note && <p className="mt-2 leading-snug text-slate-400">{note}</p>}
    </div>
  );
}

/** Memory strength as five dots: memory that lasts longer fills more of them. */
function Dots({ level }: { level: number }) {
  return (
    <span className="flex gap-[3px]">
      {Array.from({ length: MAX_STRENGTH }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < level ? 'bg-sky-300' : 'bg-white/[0.12]'}`}
        />
      ))}
    </span>
  );
}

/**
 * A learned word's memory on one bar: from its last review to the ticks where
 * it's due (recall 90%), where it slips (80%) and, while disconnected, where it
 * fades, with now filled in. Under it: what comes next, in time order (the
 * fading is on the status line, so only its tick is here). Above: its strength
 * and what the next level takes.
 */
export function WordTimeline({
  o,
  nowMs,
  recall,
  broken,
  falls,
}: {
  o: MemoryOutlook;
  nowMs: number;
  recall?: number | null;
  /** Slipped already (missed, quizzed and lost, or faded). */
  broken?: boolean;
  /** Disconnected (or slipped): when it fades back to "?" (app ms). */
  falls?: number;
}) {
  const events: { at: number; text?: string; color: string; tick: string }[] = [];
  if (!broken && o.due > nowMs) {
    events.push({
      at: o.due,
      text: `due in ${until(o.due - nowMs)}`,
      color: 'text-slate-400',
      tick: 'bg-violet-300',
    });
  }
  if (!broken && o.breaks > nowMs && (falls === undefined || o.breaks < falls)) {
    events.push({
      at: o.breaks,
      text: `slips in ${until(o.breaks - nowMs)}`,
      color: 'text-slate-500',
      tick: 'bg-rose-400',
    });
  }
  if (falls !== undefined) events.push({ at: falls, color: '', tick: 'bg-orange-300' });
  events.sort((a, b) => a.at - b.at);
  const end = Math.max(events[events.length - 1]?.at ?? o.breaks, nowMs + 1);
  const length = Math.max(1, end - o.since);
  const at = (t: number) => `${Math.max(0, Math.min(1, (t - o.since) / length)) * 100}%`;
  const due = !broken && nowMs >= o.due;
  const fill = broken
    ? 'bg-rose-400/80'
    : falls !== undefined
      ? 'bg-slate-500'
      : due
        ? 'bg-violet-400'
        : 'bg-sky-400/70';
  const captions = [
    ...(due ? [{ text: 'due now: review it', color: 'text-violet-300' }] : []),
    ...events.filter((e) => e.text),
  ];
  const next = o.next;
  return (
    <div className="space-y-1.5">
      <div
        className="flex items-center justify-between gap-2"
        title={`Memory strength ${o.level} of ${MAX_STRENGTH} dots: after a review you still recall it (90%) for ~${span(o.days)}. It grows only when you answer right while it's due, never by cramming; the stronger, the more signal it sends out.`}
      >
        <span className="flex items-center gap-2">
          <span className="eyebrow">Memory</span>
          <Dots level={o.level} />
        </span>
        {next && (
          <span
            className="whitespace-nowrap text-[11px] text-slate-500"
            title={`${next.level} dots after ${next.reviews === 1 ? 'the next right answer' : `${next.reviews} right answers`}, each given when due${next.reachedAt > nowMs + 60_000 ? `: in ~${until(next.reachedAt - nowMs)}` : ''}`}
          >
            <span className="text-sky-300/80">level up</span>{' '}
            {next.reviews === 1 ? 'next review' : `in ${next.reviews} reviews`}
          </span>
        )}
      </div>
      <div
        className="relative h-1 overflow-hidden rounded-full bg-white/[0.08]"
        title={recall == null ? undefined : `Recall now ${pct(recall)}: due at 90%, slips at 80%`}
      >
        <div className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: at(nowMs) }} />
        {events.slice(0, -1).map((e) => (
          <div
            key={e.at}
            className={`absolute inset-y-0 w-0.5 ${e.tick}`}
            style={{ left: at(e.at) }}
          />
        ))}
      </div>
      {captions.length > 0 && (
        <div className="flex flex-wrap gap-x-1.5 text-[11px]">
          {captions.map((e, i) => (
            <span key={e.text} className={e.color}>
              {i > 0 && <span className="text-slate-600">· </span>}
              {e.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A word you don't hold yet: would it stay connected if learned now? */
function SignalHint({ supply }: { supply?: Props['supply'] }) {
  if (!supply) return null;
  if (supply.capital) {
    return (
      <Signal
        tone="good"
        chips={<Chip tone="good">Core</Chip>}
        min={supply.min}
        note="Your core word: it sends 100% signal once learned."
      />
    );
  }
  const inside = supply.value >= supply.min - 1e-9;
  return (
    <Signal
      tone={inside ? 'good' : 'warn'}
      chips={<span className="eyebrow">Signal</span>}
      value={supply.value}
      min={supply.min}
      note={
        inside
          ? 'Learned now, it stays connected.'
          : 'Too little here: learned now, it starts disconnected. The map shows which words nearby would help.'
      }
    />
  );
}

/** The selected word's status: its signal, its memory, and what can be done with it. */
export default function NodeDetails(props: Props) {
  const { word, state, supply } = props;
  const hint = props.hint && <HintButton hint={props.hint} coins={props.coins ?? 0} />;

  if (state === 'locked') return null;

  if (state === 'frontier') {
    return (
      <Panel>
        {props.reclaim && (
          <p className="mb-2 flex items-center gap-1.5 text-teal-300">
            <Icon name="recover" />
            Was{' '}
            {props.reclaim.was === 'conquered'
              ? 'learned'
              : `learning ${props.reclaim.steps}/3`} · {timeLeft(props.reclaim.until - props.nowMs)}{' '}
            to recover it
          </p>
        )}
        <SignalHint supply={supply} />
        {hint && <div className="mt-2.5 flex">{hint}</div>}
      </Panel>
    );
  }

  if (state === 'claimed') {
    const next = props.claimStep;
    const wait = next ? next.opensAt - props.nowMs : 0;
    return (
      <Panel>
        {!props.bare && next && (
          <div className="mb-2 flex items-center gap-2">
            <StepDots done={next.step - 1} />
            <span className={wait <= 0 ? 'text-emerald-300' : 'text-slate-400'}>
              {wait <= 0 ? `step ${next.step} ready` : `step ${next.step} in ${short(wait)}`}
            </span>
          </div>
        )}
        <SignalHint supply={supply} />
        {hint && <div className="mt-2.5 flex">{hint}</div>}
      </Panel>
    );
  }
  if (state !== 'conquered') return null;

  const verb = props.verb;
  const o = props.memory?.outlook;
  const due = !!o && !supply?.broken && props.nowMs >= o.due;
  return (
    <Panel>
      {/* Not while it is being asked (no name then): the meaning would be the answer. */}
      {!props.bare && props.name && (
        <div className="mb-2 flex items-baseline gap-2">
          <span className="headword text-xl">{props.name}</span>
          {props.showEtymology && <span className="text-slate-400">{word.en}</span>}
        </div>
      )}
      <div className="space-y-3">
        {supply && <SignalLine supply={supply} due={due} nowMs={props.nowMs} />}
        {o && (
          <WordTimeline
            o={o}
            nowMs={props.nowMs}
            recall={props.memory?.recall}
            broken={supply?.broken}
            falls={supply?.cutUntil ?? supply?.brokenUntil}
          />
        )}
        {verb && (
          <div className="flex items-center justify-between gap-2">
            <span
              className="flex items-center gap-2"
              title={`Verb level ${verb.level}/${TENSES.length}`}
            >
              <span className="eyebrow">Verb</span>
              <span className="tracking-[0.15em] text-amber-300">
                {'★'.repeat(verb.level)}
                <span className="text-white/[0.12]">{'★'.repeat(TENSES.length - verb.level)}</span>
              </span>
              {verb.drill.kind === 'wait' && (
                <span className="text-[11px] text-slate-500">
                  {verb.drill.tense} in{' '}
                  {Math.max(1, Math.round((verb.drill.until.getTime() - props.nowMs) / 3_600_000))}{' '}
                  h
                </span>
              )}
            </span>
            {(verb.drill.kind === 'learn' || verb.drill.kind === 'defend') && (
              <button
                onClick={props.onConjugate}
                className="btn-quiet border-amber-400/30 text-amber-200 hover:border-amber-300/60"
              >
                {verb.drill.kind === 'learn' ? 'Conjugate' : 'Review'} · {verb.drill.tense}
              </button>
            )}
          </div>
        )}
        {props.showExample && word.example && <ExampleLine example={word.example} />}
        {props.showEtymology && <Etymology word={word} />}
      </div>
      <div className="mt-3 flex items-center gap-1.5 border-t border-white/[0.06] pt-3">
        {props.onPlant && (
          <button
            onClick={props.onPlant}
            title="Bring a hidden word next to this one: your link carries signal too"
            className="btn-quiet"
          >
            <Icon name="link" className="text-emerald-300" />
            Connect
          </button>
        )}
        {hint}
      </div>
    </Panel>
  );
}

/** A learned word's signal: slipped, disconnected, or connected (and what depends on it). */
function SignalLine({
  supply,
  due,
  nowMs,
}: {
  supply: NonNullable<Props['supply']>;
  due: boolean;
  nowMs: number;
}) {
  const hang = supply.hanging ?? 0;
  const dueChip = due && <Chip tone="due">Due</Chip>;
  if (supply.broken) {
    return (
      <Signal
        tone="bad"
        chips={<Chip tone="bad">Slipped</Chip>}
        // No meter: signal reaching it doesn't help, only a right answer does.
        min={supply.min}
        note={
          <>
            {supply.missed ? 'Missed' : 'Forgotten'}: it passes no signal on. One right answer
            brings it back
            {hang > 0 && <b className="font-medium text-rose-200"> and {words(hang)} with it</b>}.
            {supply.brokenUntil !== undefined && (
              <> Fades in {until(Math.max(0, supply.brokenUntil - nowMs))}.</>
            )}
          </>
        }
      />
    );
  }
  if (supply.cutUntil !== undefined) {
    return (
      <Signal
        tone="warn"
        chips={
          <>
            <Chip tone="warn">Disconnected</Chip>
            {dueChip}
          </>
        }
        value={supply.value}
        min={supply.min}
        note={
          <>
            <b className="font-medium text-orange-200">
              Fades in {until(Math.max(0, supply.cutUntil - nowMs))}
            </b>{' '}
            unless it reconnects: learn a word next to it, or bring back one that slipped on the
            way.
          </>
        }
      />
    );
  }
  const role = supply.capital ? 'Core' : supply.stronghold ? 'Anchor' : 'Connected';
  return (
    <Signal
      tone="good"
      chips={
        <>
          <Chip tone="good">{role}</Chip>
          {dueChip}
        </>
      }
      value={supply.value}
      min={supply.min}
      note={
        <>
          {supply.sends !== undefined && `Sends ${pct(supply.sends)}`}
          {hang > 0 && (
            <span
              className="text-amber-200/90"
              title={`If it slipped, ${words(hang)} would be disconnected: keep it strong, or give them another way (a connected word, more words around them)`}
            >
              {' '}
              · {words(hang)} {hang === 1 ? 'depends' : 'depend'} on it
            </span>
          )}
        </>
      }
    />
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="text-xs text-slate-300">{children}</div>;
}

/** The bought hint (the word's English cousin), or the offer to buy one. */
function HintButton({ hint, coins }: { hint: NonNullable<Props['hint']>; coins: number }) {
  if (hint.bought) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-300/[0.07] px-2 py-1 text-amber-100"
        title="Its English cousin"
      >
        <Icon name="bulb" className="text-amber-300" />
        {hint.cognate}
      </span>
    );
  }
  return (
    <button
      onClick={hint.onBuy}
      disabled={coins < hint.cost}
      title="Show its English cousin, a related English word"
      className="btn-quiet"
    >
      <Icon name="bulb" className="text-amber-300" />
      Cousin
      <Sparks n={hint.cost} className="text-slate-500" />
    </button>
  );
}

/** "45 s", "3 min" */
function short(ms: number) {
  return ms < 90_000 ? `${Math.ceil(ms / 1000)} s` : `${Math.ceil(ms / 60_000)} min`;
}
