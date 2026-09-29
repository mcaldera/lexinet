import { TENSES, type Drill } from '../core/verbs';
import type { ClaimStep } from '../core/claim';
import type { NodeState } from '../core/unlock';
import type { WordNode } from '../db/repo';
import Etymology from './Etymology';
import { StepDots, timeLeft } from './ReviewView';
import { MAX_STRENGTH } from '../core/strength';

type Props = {
  word: WordNode;
  state: NodeState;
  /** The name as the player may see it (faded words lose letters; '' = gone). */
  name: string;
  health: number | null;
  /** Conquered words: memory strength (0-5), how many days it lasts, and recall right now (0-1). */
  memory?: { level: number; days: number; recall: number | null };
  /** When its next review is due (app ms). */
  due?: number;
  /** Its place in your supply (core/supply.ts). */
  supply?: {
    value: number;
    min: number;
    capital: boolean;
    /** A held word: what it sends out while unbroken (by memory strength and tenses). */
    sends?: number;
    /** Sends out full supply (known for months). */
    stronghold: boolean;
    broken: boolean;
    /** Broken by a miss (else by fading past the line). */
    missed: boolean;
    /** Cut off (not broken itself): falls at this app time. */
    cutUntil?: number;
    /** Broken and so cut off too: falls at this app time. */
    brokenUntil?: number;
    /** Held words that would be cut off if it broke (or are, while it's broken). */
    hanging?: number;
  };
  /** False while this word is being quizzed: etymology and meaning would give it away. */
  showEtymology: boolean;
  /** Conquered words: links into their category and out of it (score cohesion). */
  links?: { inside: number; outside: number; category: string };
  /** Words with an English cousin: buy it as a hint, or see the one bought. */
  hint?: { cognate: string; bought: boolean; cost: number; onBuy: () => void };
  /** Conquered words: open the plant picker (core/plant.ts). */
  onPlant?: () => void;
  coins?: number;
  /** A lost word one right answer wins back: what it was and until when (app ms). */
  reclaim?: { was: 'conquered' | 'claimed'; steps: number; until: number };
  /** Claimed words: the step to do next and when it opens (null = complete). */
  claimStep?: ClaimStep | null;
  /** Conquered verbs: level and what the next conjugation step is. */
  verb?: { level: number; drill: Drill };
  onConjugate?: () => void;
  nowMs: number;
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
 * Memory strength: how long you'll remember the word (FSRS stability), as dots.
 * Only spaced reviews raise it. Stars are for verb tenses, not this.
 */
export function MemoryDots({ level, days }: { level: number; days: number }) {
  return (
    <span
      className="flex items-center gap-1.5 text-slate-500"
      title={`Memory strength ${level}/${MAX_STRENGTH}: you should still recall it after ~${span(days)}. It grows only with spaced reviews; cut off from supply, a word holds out this long.`}
    >
      <span className="flex gap-0.5">
        {Array.from({ length: MAX_STRENGTH }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full ${i < level ? 'bg-sky-300' : 'bg-slate-700'}`}
          />
        ))}
      </span>
      <span>lasts ~{span(days)}</span>
    </span>
  );
}
const btn = 'btn rounded-md px-2 py-1 text-xs text-white disabled:opacity-40';

/** Inside your supply or not, for a "?" or a claim: won out there, a word is cut off. */
function SupplyHint({ supply }: { supply?: Props['supply'] }) {
  if (!supply) return null;
  return supply.value >= supply.min - 1e-9 ? (
    <p className="text-amber-200/80" title="Supply reaches it: won, it will count">
      ⚡ inside your supply ({pct(supply.value)})
    </p>
  ) : (
    <p
      className="text-slate-500"
      title="Won out here, it is cut off from the start and holds out only as long as its memory lasts: win the words around it, and once you know them well they hold each other up"
    >
      outside your supply
    </p>
  );
}

/** The selected word's status: a line or two, with the breakdown one click away. */
export default function NodeDetails(props: Props) {
  const { word, state, supply } = props;
  const hint = props.hint && <HintButton hint={props.hint} coins={props.coins ?? 0} />;

  if (state === 'locked') return null;

  if (state === 'frontier') {
    return (
      <Panel>
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            {props.reclaim && (
              <p className="text-teal-300">
                ↺ was{' '}
                {props.reclaim.was === 'conquered' ? 'yours' : `claimed (${props.reclaim.steps}/3)`}{' '}
                · {timeLeft(props.reclaim.until - props.nowMs)} to win back
              </p>
            )}
            <SupplyHint supply={supply} />
          </div>
          {hint}
        </div>
      </Panel>
    );
  }

  if (state === 'claimed') {
    const next = props.claimStep;
    const wait = next ? next.opensAt - props.nowMs : 0;
    return (
      <Panel>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StepDots done={next ? next.step - 1 : 3} />
            <span className={wait <= 0 ? 'text-emerald-300' : 'text-slate-400'}>
              {!next ? '' : wait <= 0 ? 'ready' : `step ${next.step} in ${short(wait)}`}
            </span>
          </div>
          {hint}
        </div>
        <div className="mt-1">
          <SupplyHint supply={supply} />
        </div>
      </Panel>
    );
  }
  if (state !== 'conquered') return null;

  const verb = props.verb;
  const dueIn = props.due !== undefined ? props.due - props.nowMs : undefined;
  return (
    <Panel>
      <div className="mb-1.5 text-sm text-slate-100">
        {props.name || '?'} {/* Not while it is being asked: the meaning would be the answer. */}
        {props.showEtymology && <span className="text-xs text-slate-500">{word.en}</span>}
      </div>
      {supply && <SupplyLine supply={supply} nowMs={props.nowMs} />}
      {props.memory && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <MemoryDots level={props.memory.level} days={props.memory.days} />
          {dueIn !== undefined && (
            <span className={dueIn <= 0 ? 'text-violet-300' : 'text-slate-500'}>
              · {dueIn <= 0 ? 'due now' : `due in ${until(dueIn)}`}
            </span>
          )}
        </div>
      )}
      {verb && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-amber-300" title={`Verb level ${verb.level}/${TENSES.length}`}>
            {'★'.repeat(verb.level)}
            <span className="text-slate-700">{'★'.repeat(TENSES.length - verb.level)}</span>
            {verb.drill.kind === 'wait' && (
              <span className="ml-2 text-slate-500">
                {verb.drill.tense} in{' '}
                {Math.max(1, Math.round((verb.drill.until.getTime() - props.nowMs) / 3_600_000))} h
              </span>
            )}
          </span>
          {(verb.drill.kind === 'learn' || verb.drill.kind === 'defend') && (
            <button
              onClick={props.onConjugate}
              className={`${btn} bg-amber-700 hover:bg-amber-600`}
            >
              {verb.drill.kind === 'learn' ? 'Conjugate' : 'Defend'} · {verb.drill.tense}
            </button>
          )}
        </div>
      )}
      {(props.onPlant || hint) && (
        <div className="mt-2 flex justify-end gap-1.5">
          {props.onPlant && (
            <button
              onClick={props.onPlant}
              title="Bring a hidden word next to this one: your link carries supply too"
              className={`${btn} bg-emerald-800 hover:bg-emerald-700`}
            >
              🌱 Plant
            </button>
          )}
          {hint}
        </div>
      )}
      {props.showEtymology && <Etymology word={word} />}
      <More>
        <p>
          Recall {props.memory?.recall == null ? '—' : pct(props.memory.recall)} (due at 90%, breaks
          at 80%)
        </p>
        {supply && (
          <p>
            Supply {pct(supply.value)} (counts from {pct(supply.min)})
          </p>
        )}
        {supply?.sends !== undefined && (
          <p title="What it passes to its neighbours: more the better you know it">
            Sends out {pct(supply.sends)}
          </p>
        )}
        {props.links && (
          <p>
            {props.links.category}: {props.links.inside} links in, {props.links.outside} out
          </p>
        )}
      </More>
    </Panel>
  );
}

/** One line: broken, cut off, or supplied (and how much hangs on it). */
function SupplyLine({ supply, nowMs }: { supply: NonNullable<Props['supply']>; nowMs: number }) {
  const hang = supply.hanging ?? 0;
  if (supply.broken) {
    return (
      <p
        className="text-rose-300"
        title="A broken word passes no supply on: whatever hangs on it is cut off. One right answer mends it."
      >
        ⛓ Broken ({supply.missed ? 'missed' : 'forgotten'}) · mend it
        {hang > 0 && ` · ${words(hang)} cut off`}
        {supply.brokenUntil !== undefined && (
          <span className="text-rose-300/70"> · falls in {until(supply.brokenUntil - nowMs)}</span>
        )}
      </p>
    );
  }
  if (supply.cutUntil !== undefined) {
    return (
      <p
        className="text-slate-400"
        title="Not enough supply reaches it: it doesn't count, and falls back to '?' when it can't hold out any longer. Mend the broken word on its way, win or strengthen the words around it, or plant a link around the gap."
      >
        ✂ Cut off · falls in {until(supply.cutUntil - nowMs)}
      </p>
    );
  }
  return (
    <p
      className="text-amber-200/90"
      title={
        hang > 0
          ? `If it broke, ${words(hang)} would be cut off: keep it strong, or give them another way (a planted link, more words around them)`
          : 'Supplied: it counts, and supplies its neighbours the better you know it'
      }
    >
      ⚡ {supply.capital ? 'Capital' : `Supply ${pct(supply.value)}`}
      {supply.stronghold && <span className="text-amber-300"> · stronghold</span>}
      {hang > 0 && (
        <span className="text-amber-300">
          {' '}
          · {words(hang)} {hang === 1 ? 'hangs' : 'hang'} on it
        </span>
      )}
    </p>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="px-1 text-xs text-slate-300">{children}</div>;
}

/** Numbers most players never need: folded away. */
function More({ children }: { children: React.ReactNode }) {
  return (
    <details className="group mt-2 text-slate-500">
      <summary className="cursor-pointer list-none text-[11px] hover:text-slate-300">
        <span className="group-open:hidden">more ▸</span>
        <span className="hidden group-open:inline">less ▾</span>
      </summary>
      <div className="mt-1 space-y-0.5 text-slate-400">{children}</div>
    </details>
  );
}

/** The bought hint (the word's English cousin), or the offer to buy one. */
function HintButton({ hint, coins }: { hint: NonNullable<Props['hint']>; coins: number }) {
  if (hint.bought) {
    return (
      <span className="shrink-0 text-amber-200" title="Hint: its English cousin">
        ≈ {hint.cognate}
      </span>
    );
  }
  return (
    <button
      onClick={hint.onBuy}
      disabled={coins < hint.cost}
      title="Its English cousin, shown next to it"
      className={`${btn} shrink-0 bg-amber-800 hover:bg-amber-700`}
    >
      💡 {hint.cost}
    </button>
  );
}

/** "45 s", "3 min" */
function short(ms: number) {
  return ms < 90_000 ? `${Math.ceil(ms / 1000)} s` : `${Math.ceil(ms / 60_000)} min`;
}
