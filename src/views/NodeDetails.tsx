import { TENSES, type Drill } from '../core/verbs';
import type { ClaimStep } from '../core/claim';
import type { NodeState } from '../core/unlock';
import type { WordNode } from '../db/repo';
import Etymology from './Etymology';
import { StepDots, timeLeft } from './ReviewView';
import { MAX_STRENGTH, type MemoryOutlook } from '../core/strength';

type Props = {
  word: WordNode;
  state: NodeState;
  /** The name as the player may see it (faded words lose letters; '' = gone). */
  name: string;
  health: number | null;
  /** Conquered words: their memory (strength, due, breaking, next level) and recall now (0-1). */
  memory?: { outlook: MemoryOutlook; recall: number | null };
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
  /** Inside the word's own card (word card, wait card): no name line, no claim countdown. */
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
 * Memory strength: how long you'll remember the word (FSRS stability), as dots.
 * Only spaced reviews raise it. Stars are for verb tenses, not this.
 */
/** Strength as five dots: memory that lasts longer fills more of them. */
function Dots({ level }: { level: number }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: MAX_STRENGTH }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < level ? 'bg-sky-300' : 'bg-slate-700'}`}
        />
      ))}
    </span>
  );
}

/**
 * A held word's memory and fate on one bar: from its last review to the tick
 * where it's due (recall 90%), where it breaks (80%) and, while cut off, where
 * it falls back to "?", with now filled in (grey while cut off, rose when
 * broken). Below: what comes next, in time order; breaking is left out when
 * the word falls first. Above: its strength and what the next level takes.
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
  /** Broken already (missed, raided, or faded). */
  broken?: boolean;
  /** Cut off (or broken): when it falls back to "?" (app ms). */
  falls?: number;
}) {
  const events: { at: number; text: string; color: string; tick: string }[] = [];
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
      text: `breaks in ${until(o.breaks - nowMs)}`,
      color: 'text-rose-300/80',
      tick: 'bg-rose-400',
    });
  }
  if (falls !== undefined) {
    events.push({
      at: falls,
      text: `✂ falls to ? in ${until(Math.max(0, falls - nowMs))}`,
      color: 'text-slate-300',
      tick: 'bg-slate-300',
    });
  }
  events.sort((a, b) => a.at - b.at);
  const end = Math.max(events[events.length - 1]?.at ?? o.breaks, nowMs + 1);
  const length = Math.max(1, end - o.since);
  const at = (t: number) => `${Math.max(0, Math.min(1, (t - o.since) / length)) * 100}%`;
  const fill = broken
    ? 'bg-rose-400'
    : falls !== undefined
      ? 'bg-slate-400'
      : nowMs >= o.due
        ? 'bg-violet-400'
        : 'bg-sky-400/80';
  const lead = broken
    ? { text: 'broken: one right answer mends it', color: 'text-rose-300' }
    : nowMs >= o.due
      ? { text: 'due now: practise it', color: 'text-violet-300' }
      : null;
  const next = o.next;
  return (
    <div className="mt-1.5 space-y-1 text-xs">
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-400"
        title={`Memory strength ${o.level}/${MAX_STRENGTH}: after a review you still recall it (90%) for ~${span(o.days)}. It grows only when you answer right while it's due, never by cramming; the stronger, the more supply it sends out.`}
      >
        <Dots level={o.level} />
        <span>
          memory {o.level}/{MAX_STRENGTH}
        </span>
        {next && (
          <span className="text-slate-500">
            → {next.level}/{MAX_STRENGTH}{' '}
            {next.reviews === 1
              ? 'with the next right answer'
              : `after ${next.reviews} right answers`}
            {next.reachedAt > nowMs + 60_000 && ` (~${until(next.reachedAt - nowMs)})`}
          </span>
        )}
      </div>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-slate-800"
        title={recall == null ? undefined : `Recall now ${pct(recall)}: due at 90%, breaks at 80%`}
      >
        <div className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: at(nowMs) }} />
        {events.slice(0, -1).map((e) => (
          <div
            key={e.text}
            className={`absolute inset-y-0 w-0.5 ${e.tick}`}
            style={{ left: at(e.at) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-1.5 text-[11px]">
        {[...(lead ? [lead] : []), ...events].map((e, i) => (
          <span key={e.text} className={e.color}>
            {i > 0 && <span className="text-slate-600">· </span>}
            {e.text}
          </span>
        ))}
      </div>
    </div>
  );
}
const btn = 'btn rounded-md px-2 py-1 text-xs text-white disabled:opacity-40';

/** Inside your supply or not, for a "?" or a claim: won out there, a word is cut off. */
function SupplyHint({ supply }: { supply?: Props['supply'] }) {
  if (!supply) return null;
  if (supply.capital) {
    return (
      <p
        className="text-amber-200/80"
        title="Your capital always sends out 100%, from when you hold it"
      >
        ⚡ your capital: sends 100% once it's yours
      </p>
    );
  }
  return supply.value >= supply.min - 1e-9 ? (
    <p className="text-amber-200/80" title="Supply reaches it: won, it will count">
      ⚡ inside your supply ({pct(supply.value)})
    </p>
  ) : (
    <p
      className="text-slate-500"
      title="Won out here, it is cut off from the start and holds out only as long as its memory lasts. The map shows where its supply comes from, and what winning each ? nearby would add"
    >
      outside your supply: {pct(supply.value)} of the {pct(supply.min)} it needs
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
          <div className={`flex items-center gap-2 ${props.bare ? 'hidden' : ''}`}>
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
  return (
    <Panel>
      {!props.bare && (
        <div className="mb-1.5 text-sm text-slate-100">
          {props.name || '?'} {/* Not while it is being asked: the meaning would be the answer. */}
          {props.showEtymology && <span className="text-xs text-slate-500">{word.en}</span>}
        </div>
      )}
      {supply && <SupplyLine supply={supply} />}
      {props.memory && (
        <WordTimeline
          o={props.memory.outlook}
          nowMs={props.nowMs}
          recall={props.memory.recall}
          broken={supply?.broken}
          falls={supply?.cutUntil ?? supply?.brokenUntil}
        />
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
function SupplyLine({ supply }: { supply: NonNullable<Props['supply']> }) {
  const hang = supply.hanging ?? 0;
  if (supply.broken) {
    return (
      <p
        className="text-rose-300"
        title="A broken word passes no supply on: whatever hangs on it is cut off. One right answer mends it."
      >
        ⛓ Broken ({supply.missed ? 'missed' : 'forgotten'}) · mend it
        {hang > 0 && ` · ${words(hang)} cut off`}
      </p>
    );
  }
  if (supply.cutUntil !== undefined) {
    return (
      <p
        className="text-slate-400"
        title="Not enough supply reaches it: it doesn't count, and falls back to '?' when it can't hold out any longer. The map shows where its supply comes from and what winning each ? nearby would add; or mend a broken word on its way, or plant a link."
      >
        ✂ Cut off: {pct(supply.value)} of the {pct(supply.min)} it needs
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
