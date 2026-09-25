import type { Influence } from '../core/influence';
import { TENSES, type Drill } from '../core/verbs';
import { CLAIM_STEP_NAMES, type ClaimStep } from '../core/claim';
import type { NodeState } from '../core/unlock';
import type { WordNode } from '../db/repo';
import Etymology from './Etymology';

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

  if (state === 'frontier') {
    const attacked = influences.length;
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
        <div className="mb-1 uppercase tracking-wider text-slate-500">Unknown word</div>
        {hostile ? (
          <p className="text-red-300">
            Hostile: attacking {attacked} of your words ({perDay(total)} of control in total).
            Conquer it to stop the damage.
          </p>
        ) : (
          <p>
            Neutral for now: turns hostile in{' '}
            <b className="text-amber-300">~{Math.max(1, Math.round(props.graceHours ?? 0))} h</b>.
          </p>
        )}
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
        <ul className="space-y-0.5">{CLAIM_STEP_NAMES.map((_, i) => step(i))}</ul>
        <p className="mt-2 text-amber-300/90">
          Until conquered, a miss on this word or a neighbour makes it slip back to “?”.
        </p>
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
