import type { ReactNode } from 'react';
import type { Levels } from '../core/tiers';
import { levelBand, levelRgb } from './visuals';
import Icon from './Icon';

type Props = {
  levels: Levels;
  /** Display names per tier, e.g. CEFR sub-levels ("A1.2"). */
  names?: Record<string, string> | null;
  /** Topics (categories) by id: their names. */
  topicName: (id: number) => string;
  /** Words being learned: on their way to counting. */
  claimed: number;
  onClose: () => void;
  /** The verbs that earn verb points (VerbGoals), below the road. */
  children?: ReactNode;
};

/**
 * Where you are: the overall level as a road, every level a segment coloured by
 * its band (A1 green … B2 purple), the one you're on filling towards the next,
 * what the next needs; then each topic you've entered with its own level.
 */
export default function LevelPanel(props: Props) {
  const { levels, names, claimed, onClose, children } = props;
  const p = { ...levels.overall, conquered: levels.overall.held };
  const name = (t: number) => names?.[String(t)] ?? `Tier ${t}`;
  const tiers = Array.from({ length: p.maxTier }, (_, i) => i + 1);
  // Consecutive tiers of one band, for the labels under the road.
  const bands: { band: string; tiers: number[] }[] = [];
  for (const t of tiers) {
    const band = names ? levelBand(name(t)) : name(t);
    const last = bands[bands.length - 1];
    if (last?.band === band) last.tiers.push(t);
    else bands.push({ band, tiers: [t] });
  }
  const rgb = levelRgb(name(p.tier));
  const words = p.needed ? Math.min(1, p.conquered / p.needed) : 1;
  const verbs = p.pointsNeed ? Math.min(1, p.verbPoints / p.pointsNeed) : 1;
  const here = names ? levelBand(name(p.tier)) : '';
  const nextBand = tiers.find((t) => t > p.tier && names && levelBand(name(t)) !== here);
  const last = p.tier >= p.maxTier;
  return (
    <div className="panel p-4 text-sm">
      <div className="flex items-start justify-between">
        <span className="eyebrow">Level</span>
        <button className="icon-btn -mr-1.5 -mt-1" onClick={onClose} title="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="font-title text-2xl font-bold tracking-wide" style={{ color: `rgb(${rgb})` }}>
        {name(p.tier)}
      </div>

      {/* The road: one segment per level, grouped by band. */}
      <div className="mt-3 flex gap-1.5">
        {bands.map((b) => (
          <div key={b.band + b.tiers[0]} className="flex-1" style={{ flexGrow: b.tiers.length }}>
            <div className="flex gap-0.5">
              {b.tiers.map((t) => {
                const c = levelRgb(name(t));
                const current = t === p.tier;
                return (
                  <div
                    key={t}
                    title={name(t)}
                    className="relative h-2.5 flex-1 overflow-hidden rounded-sm"
                    style={{
                      background: `rgba(${c}, ${t < p.tier ? 0.85 : 0.14})`,
                      boxShadow: current ? `0 0 0 1.5px rgb(${c})` : '',
                    }}
                  >
                    {current && (
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{ width: `${words * 100}%`, background: `rgba(${c}, 0.85)` }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div
              className="mt-1 text-center text-[10px] font-semibold"
              style={{ color: `rgba(${levelRgb(name(b.tiers[0]))}, 0.9)` }}
            >
              {b.band}
            </div>
          </div>
        ))}
      </div>

      {last ? (
        <p className="mt-3 text-slate-300">The last level: everything is open.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          <div className="text-xs text-slate-400">
            Next: <b style={{ color: `rgb(${levelRgb(name(p.tier + 1))})` }}>{name(p.tier + 1)}</b>
            {nextBand && nextBand > p.tier + 1 && (
              <span>
                {' '}
                · {nextBand - p.tier} levels to{' '}
                <b style={{ color: `rgb(${levelRgb(name(nextBand))})` }}>
                  {levelBand(name(nextBand))}
                </b>
              </span>
            )}
          </div>
          <Bar
            label="Words learned"
            value={`${p.conquered}/${p.needed}${claimed ? ` (+${claimed} on the way)` : ''}`}
            share={words}
            rgb={rgb}
          />
          {p.pointsNeed > 0 && (
            <Bar
              label="Verb points"
              value={`${p.verbPoints}/${p.pointsNeed}`}
              share={verbs}
              rgb="251, 191, 36"
              title="Every tense you learn of a verb is a point"
            />
          )}
        </div>
      )}
      <Topics {...props} name={name} />
      {children && <div className="mt-4 border-t border-white/[0.06] pt-3">{children}</div>}
    </div>
  );
}

function Bar(props: { label: string; value: string; share: number; rgb: string; title?: string }) {
  return (
    <div title={props.title}>
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{props.label}</span>
        <span className="text-slate-300">{props.value}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full"
          style={{ width: `${props.share * 100}%`, background: `rgb(${props.rgb})` }}
        />
      </div>
    </div>
  );
}

/**
 * The topics you've entered, most held first: each climbs its own levels on its
 * own words; one held back by the overall level shows a lock.
 */
function Topics({ levels, topicName, name }: Props & { name: (t: number) => string }) {
  const entered = [...levels.topics]
    .filter(([, t]) => t.held > 0)
    .sort((a, b) => b[1].held - a[1].held);
  if (!entered.length) return null;
  return (
    <div className="mt-4 border-t border-white/[0.06] pt-3">
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="eyebrow">Topics</span>
        <span
          className="text-slate-500"
          title="A topic climbs on its own words, at most one band past your overall level"
        >
          up to {name(levels.cap)}
        </span>
      </div>
      <div className="space-y-1.5">
        {entered.map(([id, t]) => {
          const rgb = levelRgb(name(t.tier));
          const share = t.needed ? Math.min(1, t.conquered / t.needed) : 1;
          return (
            <div
              key={id}
              title={
                t.needed === 0
                  ? 'Every level open'
                  : t.capped
                    ? `${name(t.tier + 1)} waits for your overall level`
                    : `${name(t.tier + 1)}: ${t.needed} of its words up to ${name(t.tier)} (${t.conquered} so far)`
              }
            >
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-slate-300">{topicName(id)}</span>
                <span className="flex shrink-0 items-center gap-1 text-slate-500">
                  {t.held}/{t.words} <b style={{ color: `rgb(${rgb})` }}>{name(t.tier)}</b>
                  {t.capped && <Icon name="lock" className="text-slate-400" />}
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${share * 100}%`,
                    background: `rgba(${rgb}, ${t.capped ? 0.4 : 0.9})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
