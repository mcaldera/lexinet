import type { Influence } from '../core/influence';
import { TENSES, type Drill } from '../core/verbs';
import type { ClaimStep } from '../core/claim';
import type { NodeState } from '../core/unlock';
import type { WordNode } from '../db/repo';
import Etymology from './Etymology';
import { StepDots, timeLeft } from './ReviewView';

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
  /** False while this word is being quizzed: etymology and meaning would give it away. */
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
const perDay = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%/d`;
const KIND = {
  attack: { text: 'hostile', cls: 'text-red-300' },
  rebel: { text: 'rebel', cls: 'text-red-300' },
  support: { text: 'support', cls: 'text-emerald-300' },
} as const;
const btn = 'rounded px-2 py-1 text-xs text-white disabled:opacity-40';

/** The selected word's status: a line or two, with the breakdown one click away. */
export default function NodeDetails(props: Props) {
  const { word, state, health, control, influences, nameOf, cohesion, hostile } = props;
  const total = influences.reduce((a, i) => a + i.perDay, 0);
  const clock = (until: number) => {
    const s = Math.max(0, Math.ceil((until - (props.appNowMs ?? props.nowMs)) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const hint = props.hint && <HintButton hint={props.hint} coins={props.coins ?? 0} />;

  // Hidden words: the wait card above already shows their reach.
  if (state === 'locked') return null;

  if (state === 'frontier') {
    const lines = [
      props.reclaim && (
        <p key="r" className="text-teal-300">
          ↺ was {props.reclaim.was === 'conquered' ? 'yours' : `claimed (${props.reclaim.steps}/3)`}{' '}
          · {timeLeft(props.reclaim.until - props.nowMs)} to win back
        </p>
      ),
      props.endangers && (
        <p key="e" className="text-rose-300">
          ⚠ {props.endangers.count} {props.endangers.count === 1 ? 'claim falls' : 'claims fall'} in{' '}
          <b className="font-mono">{clock(props.endangers.until)}</b>
        </p>
      ),
      hostile ? (
        <p key="h" className="text-red-300">
          Hostile{influences.length ? ` · ${perDay(total)} on ${influences.length} of yours` : ''}
        </p>
      ) : (
        <p key="h" className="text-slate-500">
          Hostile in {Math.max(1, Math.round(props.graceHours ?? 0))} h
        </p>
      ),
    ];
    return (
      <Panel>
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">{lines}</div>
          {hint}
        </div>
        {props.reach && (
          <More>
            <ReachList reach={props.reach} />
          </More>
        )}
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
        {props.danger && (
          <p className="mt-1 text-rose-300">
            ⚠ falls in <b className="font-mono">{clock(props.danger.until)}</b> unless{' '}
            {props.dangerFrom?.(props.danger.from) || 'the missed word'} is won back
          </p>
        )}
      </Panel>
    );
  }
  if (state !== 'conquered') return null;

  const trendCls =
    total < -0.001 ? 'text-red-300' : total > 0.001 ? 'text-emerald-300' : 'text-slate-500';
  const daysLeft = total < 0 ? control / -total : null;
  const h = health ?? 1;
  const verb = props.verb;
  return (
    <Panel>
      <div className="mb-1.5 text-sm text-slate-100">
        {props.name || '?'} {/* Not while it is being asked: the meaning would be the answer. */}
        {props.showEtymology && <span className="text-xs text-slate-500">{word.en}</span>}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800" title="Health">
          <div
            className={`h-full ${h >= 0.9 ? 'bg-emerald-400' : h >= 0.5 ? 'bg-amber-400' : 'bg-red-400'}`}
            style={{ width: pct(h) }}
          />
        </div>
        <span className="w-9 text-right text-slate-300">{pct(h)}</span>
        {Math.abs(total) > 0.001 && <span className={trendCls}>{perDay(total)}</span>}
      </div>
      {daysLeft !== null && (
        <p className="mt-1 text-red-300">
          Lost in ~
          {daysLeft < 1
            ? `${Math.max(1, Math.round(daysLeft * 24))} h`
            : `${daysLeft.toFixed(1)} d`}
        </p>
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
              title="Bring a hidden word next to this one"
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
        {influences.length > 0 && (
          <ul className="space-y-0.5">
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
        <p>
          Memory {health === null ? '—' : pct(health)} · control {pct(control)}
        </p>
        <p>
          Cohesion {cohesion.links.toFixed(1)} · {cohesion.cluster}-word territory
        </p>
        {props.links && (
          <p>
            {props.links.category}: {props.links.inside} links in, {props.links.outside} out
          </p>
        )}
        {props.push && (
          <p>
            Push {pct(props.push.value)} ({props.push.why})
          </p>
        )}
      </More>
    </Panel>
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

function ReachList({ reach }: { reach: NonNullable<Props['reach']> }) {
  return (
    <>
      <p className="text-sky-300">Reach {pct(reach.value)}</p>
      <ul className="space-y-0.5">
        {reach.sources.map((s, i) => (
          <li key={i} className="flex justify-between">
            <span>{s.name || '?'}</span>
            <span className="text-sky-300">+{pct(s.push)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The bought hint (English cousin, which also shields the word), or the offer to buy one. */
function HintButton({ hint, coins }: { hint: NonNullable<Props['hint']>; coins: number }) {
  if (hint.bought) {
    return (
      <span className="shrink-0 text-amber-200" title="Hint: hostile pressure on it is halved">
        ≈ {hint.cognate}
      </span>
    );
  }
  return (
    <button
      onClick={hint.onBuy}
      disabled={coins < hint.cost}
      title="Its English cousin, shown next to it; also halves hostile pressure on it"
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
