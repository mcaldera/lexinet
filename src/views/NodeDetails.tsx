import type { Influence } from '../core/influence';
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
      {props.showEtymology && <Etymology word={word} />}
    </div>
  );
}
