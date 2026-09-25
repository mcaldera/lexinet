import type { Influence } from '../core/influence';
import { TENSES, type Drill } from '../core/verbs';
import { CLAIM_STEP_NAMES, type ClaimStep } from '../core/claim';
import type { NodeState } from '../core/unlock';
import type { WordNode } from '../db/repo';
import Etymology from './Etymology';
import { DANGER_MS, PLANT_COST } from '../config';
import { timeLeft } from './ReviewView';

type Props = {
  word: WordNode;
  state: NodeState;
  /** The name as the player may see it (faded words lose letters; '' = gone). */
  name: string;
  health: number | null;
  control: number;
  /** Conquered: who pushes its control up or down. Frontier: whom it attacks. */
  influences: Influence[];
  nameOf: (id: string) => string;
  cohesion: { links: number; cluster: number };
  hostile: boolean;
  /** Hours until a neutral frontier word turns hostile. */
  graceHours?: number;
  /** Hidden while this word is being quizzed (it would give the answer away). */
  showEtymology: boolean;
  /** Hidden or "?" words: their reach and who pushes them (names as the player may see them). */
  reach?: { value: number; sources: { name: string; push: number }[] };
  /** Won words: how hard they push the horizon, and why. */
  push?: { value: number; why: string };
  /** Claimed words endangered by a miss: the deadline and the word to win back. */
  danger?: { until: number; from: string };
  /** A missed word: how many claims it endangers and when the first falls. */
  endangers?: { count: number; until: number };
  /** Conquered words: links into their category and out of it (score cohesion). */
  links?: { inside: number; outside: number; category: string };
  /** Words with an English cousin: buy it as a hint, or see the one bought. */
  hint?: { cognate: string; bought: boolean; cost: number; onBuy: () => void };
  /** Conquered words: open the plant picker (core/plant.ts). */
  onPlant?: () => void;
  coins?: number;
  /** A lost word one right answer wins back: what it was and until when (app ms). */
  reclaim?: { was: 'conquered' | 'claimed'; steps: number; until: number };
  /** App time (ms), for the danger countdowns. */
  appNowMs?: number;
  dangerFrom?: (id: string) => string;
  /** Claimed words: the step to do next and when it opens (null = complete). */
  claimStep?: ClaimStep | null;
  /** Conquered verbs: level and what the next conjugation step is. */
  verb?: { level: number; drill: Drill };
  onConjugate?: () => void;
  nowMs: number;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const perDay = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%/day`;
const KIND = {
  attack: { text: 'hostile', cls: 'text-red-300' },
  rebel: { text: 'rebelling', cls: 'text-red-300' },
  support: { text: 'supports', cls: 'text-emerald-300' },
} as const;

/** Live status of the selected word: health, control, trend and who causes it. */
export default function NodeDetails(props: Props) {
  const { word, state, name, health, control, influences, nameOf, cohesion, hostile } = props;
  const total = influences.reduce((a, i) => a + i.perDay, 0);

  if (state === 'locked' && props.reach) {
    return (
      <div className="rounded-lg border border-sky-500/30 bg-slate-900/60 p-3 text-xs text-slate-300">
        <div className="mb-1 uppercase tracking-wider text-sky-300/80">Beyond your reach</div>
        <p>
          In sight but not yet conquerable. Win words around it: their push adds up and opens it at
          100%.
        </p>
        <ReachBar reach={props.reach} />
      </div>
    );
  }
  const clock = (until: number) => {
    const s = Math.max(0, Math.ceil((until - (props.appNowMs ?? props.nowMs)) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  if (state === 'frontier') {
    const attacked = influences.length;
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
        <div className="mb-1 uppercase tracking-wider text-slate-500">Unknown word</div>
        {props.reclaim && (
          <p className="mb-2 rounded border border-teal-500/50 bg-teal-500/10 px-2 py-1.5 text-teal-100">
            ↺ Lost, but not forgotten: it was{' '}
            {props.reclaim.was === 'conquered'
              ? 'conquered'
              : `claimed (${props.reclaim.steps}/3 steps)`}
            . One right answer wins it back as it was:{' '}
            <b>{timeLeft(props.reclaim.until - props.nowMs)}</b> left, then it is gone.
          </p>
        )}
        {props.endangers && (
          <p className="mb-2 rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1.5 text-rose-200">
            Win it back! {props.endangers.count} fragile{' '}
            {props.endangers.count === 1 ? 'claim falls' : 'claims fall'} with it in{' '}
            <b className="font-mono">{clock(props.endangers.until)}</b>.
          </p>
        )}
        {hostile ? (
          <p className="text-red-300">
            {attacked
              ? `Hostile: attacking ${attacked} of your words (${perDay(total)} of control in total). Conquer it to stop the damage.`
              : 'Hostile, but none of your conquered words are next to it to attack.'}
          </p>
        ) : (
          <p>
            Neutral for now: turns hostile in{' '}
            <b className="text-amber-300">~{Math.max(1, Math.round(props.graceHours ?? 0))} h</b>.
          </p>
        )}
        {props.reach && <ReachBar reach={props.reach} />}
        {props.hint && <HintLine hint={props.hint} coins={props.coins ?? 0} />}
      </div>
    );
  }
  if (state === 'claimed') {
    const next = props.claimStep;
    const wait = next ? next.opensAt - props.nowMs : 0;
    const when =
      wait <= 0
        ? 'ready now'
        : wait < 90_000
          ? `opens in ~${Math.ceil(wait / 1000)} s`
          : `opens in ~${Math.ceil(wait / 60_000)} min`;
    const HOW = [
      'Italian → English',
      'English → Italian, from memory',
      'either way, after a break',
    ];
    const step = (i: number) => {
      const n = i + 1;
      const done = !next || n < next.step;
      const current = next?.step === n;
      return (
        <li
          key={n}
          className={
            done ? 'text-emerald-300' : current && wait <= 0 ? 'text-slate-100' : 'text-slate-500'
          }
        >
          {done ? '✓' : current ? '▸' : '◻'} {n}. {CLAIM_STEP_NAMES[i]}{' '}
          <span className="opacity-70">({HOW[i]})</span>
          {current && (
            <span className={wait <= 0 ? ' text-emerald-300' : ' text-amber-300'}> · {when}</span>
          )}
        </li>
      );
    };
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-slate-900/60 p-3 text-xs text-slate-300">
        <div className="mb-1 flex justify-between">
          <span className="uppercase tracking-wider text-emerald-300/80">Claimed · fragile</span>
          <span className="text-sm text-slate-100">{name}</span>
        </div>
        {props.danger && (
          <p className="mb-2 rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1.5 text-rose-200">
            In danger! Falls in <b className="font-mono">{clock(props.danger.until)}</b> unless you
            win back <b>{props.dangerFrom?.(props.danger.from) ?? 'the word you missed'}</b> (or
            answer this one).
          </p>
        )}
        <ul className="space-y-0.5">{CLAIM_STEP_NAMES.map((_, i) => step(i))}</ul>
        <p className="mt-2 text-amber-300/90">
          Until conquered, a miss here makes it fall back to “?”, and a miss on a neighbour puts it
          in danger for {DANGER_MS / 60_000} min.
        </p>
        {props.push && <PushLine push={props.push} />}
        {props.hint && <HintLine hint={props.hint} coins={props.coins ?? 0} />}
      </div>
    );
  }
  if (state !== 'conquered') return null;

  const trendCls =
    total < -0.001 ? 'text-red-300' : total > 0.001 ? 'text-emerald-300' : 'text-slate-400';
  const daysLeft = total < 0 ? control / -total : null;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="uppercase tracking-wider text-slate-500">Status</span>
        <span className="text-sm text-slate-100">{name || '?'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-slate-800 py-1.5">
          <div className="text-base text-slate-100">{health === null ? '—' : pct(health)}</div>
          <div className="text-slate-500">health</div>
        </div>
        <div className="rounded bg-slate-800 py-1.5">
          <div className="text-base text-slate-100">{pct(control)}</div>
          <div className="text-slate-500">control</div>
        </div>
        <div className="rounded bg-slate-800 py-1.5">
          <div className={`text-base ${trendCls}`}>{perDay(total)}</div>
          <div className="text-slate-500">trend</div>
        </div>
      </div>
      {daysLeft !== null && (
        <p className="mt-2 text-red-300">
          At this rate it is lost in ~
          {daysLeft < 1
            ? `${Math.max(1, Math.round(daysLeft * 24))} h`
            : `${daysLeft.toFixed(1)} days`}
          .
        </p>
      )}
      {influences.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {[...influences]
            .sort((a, b) => a.perDay - b.perDay)
            .map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span>
                  {nameOf(i.id) || '?'}{' '}
                  <span className={KIND[i.kind].cls}>{KIND[i.kind].text}</span>
                </span>
                <span className={i.perDay < 0 ? 'text-red-300' : 'text-emerald-300'}>
                  {perDay(i.perDay)}
                </span>
              </li>
            ))}
        </ul>
      )}
      <p className="mt-2 text-slate-500">
        Cohesion {cohesion.links.toFixed(1)} · part of a {cohesion.cluster}-word territory
      </p>
      {props.push && <PushLine push={props.push} />}
      {props.hint && <HintLine hint={props.hint} coins={props.coins ?? 0} />}
      {props.links && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-slate-400">
            Links: <b className="text-emerald-300">{props.links.inside} inside</b>{' '}
            {props.links.category} ·{' '}
            <b className={props.links.outside > props.links.inside ? 'text-amber-300' : ''}>
              {props.links.outside} outside
            </b>
          </span>
          {props.onPlant && (
            <button
              onClick={props.onPlant}
              title="Spend coins to bring a hidden word next to this one"
              className="shrink-0 rounded bg-emerald-800 px-2 py-1 text-xs text-white hover:bg-emerald-700"
            >
              🌱 Plant a word (from 🪙{PLANT_COST})
            </button>
          )}
        </div>
      )}
      {props.verb && (
        <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-2">
          <div className="flex items-center justify-between">
            <span className="uppercase tracking-wider text-amber-300/90">
              Verb level {props.verb.level}/{TENSES.length}{' '}
              <span className="text-amber-300">{'◎'.repeat(props.verb.level)}</span>
            </span>
            {(props.verb.drill.kind === 'learn' || props.verb.drill.kind === 'defend') && (
              <button
                onClick={props.onConjugate}
                className="rounded bg-amber-700 px-2 py-1 text-xs text-white hover:bg-amber-600"
              >
                {props.verb.drill.kind === 'learn' ? 'Conjugate' : 'Defend'}:{' '}
                {props.verb.drill.tense}
              </button>
            )}
          </div>
          {props.verb.drill.kind === 'wait' && (
            <p className="mt-1 text-slate-400">
              Next tense ({props.verb.drill.tense}) in ~
              {Math.max(
                1,
                Math.round((props.verb.drill.until.getTime() - props.nowMs) / 3_600_000),
              )}{' '}
              h: one new tense per day.
            </p>
          )}
          {props.verb.drill.kind === 'done' && (
            <p className="mt-1 text-slate-400">All tenses mastered.</p>
          )}
        </div>
      )}
      {props.showEtymology && <Etymology word={word} />}
    </div>
  );
}

/** How far a word's reach has come: a bar to 100% (conquerable) and who pushes it. */
function ReachBar({ reach }: { reach: NonNullable<Props['reach']> }) {
  const pctOpen = Math.min(100, Math.round(reach.value * 100));
  return (
    <div className="mt-2">
      <div className="flex justify-between text-sky-300">
        <span>Reach</span>
        <span>{Math.round(reach.value * 100)}%</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-sky-400" style={{ width: `${pctOpen}%` }} />
      </div>
      {reach.sources.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {reach.sources.map((s, i) => (
            <li key={i} className="flex justify-between">
              <span>{s.name || '?'}</span>
              <span className="text-sky-300">+{Math.round(s.push * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PushLine({ push }: { push: NonNullable<Props['push']> }) {
  return (
    <p className="mt-2 text-sky-300/90">
      Pushes the horizon: {Math.round(push.value * 100)}% to its neighbours ({push.why}), half that
      two links away.
    </p>
  );
}

/** A bought hint (the English cousin, which also shields the word), or the offer to buy one. */
function HintLine({ hint, coins }: { hint: NonNullable<Props['hint']>; coins: number }) {
  if (hint.bought) {
    return (
      <p className="mt-2 text-amber-200/90">
        💡 Hint: <b>≈ {hint.cognate}</b> · shielded: hostile pressure on it is halved.
      </p>
    );
  }
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <span className="text-slate-400">Can't remember it? An English cousin helps.</span>
      <button
        onClick={hint.onBuy}
        disabled={coins < hint.cost}
        title="Shows its English cousin next to the word and halves the hostile pressure on it"
        className="shrink-0 rounded bg-amber-800 px-2 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
      >
        💡 Hint (🪙{hint.cost})
      </button>
    </div>
  );
}
