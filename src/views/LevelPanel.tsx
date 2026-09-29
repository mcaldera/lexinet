import type { ReactNode } from 'react';
import type { TierProgress } from '../core/tiers';
import { levelBand, levelRgb } from './visuals';

type Props = {
  p: TierProgress;
  /** Display names per tier, e.g. CEFR sub-levels ("A1.2"). */
  names?: Record<string, string> | null;
  /** Words being claimed in the open tiers: on their way to counting. */
  claimed: number;
  onClose: () => void;
  /** The verbs that earn verb points (VerbGoals), below the road. */
  children?: ReactNode;
};

/**
 * Where you are on the road: every level as a segment coloured by its band
 * (A1 green … B2 purple), the one you're on filling towards the next, what
 * the next needs, and how far the next band is.
 */
export default function LevelPanel({ p, names, claimed, onClose, children }: Props) {
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
    <div className="panel p-4 text-sm" style={{ borderColor: `rgba(${rgb}, 0.45)` }}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-slate-500">Level</span>
        <button className="text-slate-500 hover:text-slate-200" onClick={onClose}>
          ✕
        </button>
      </div>
      <div
        className="font-title text-2xl font-bold tracking-wide"
        style={{ color: `rgb(${rgb})`, textShadow: `0 0 18px rgba(${rgb}, 0.45)` }}
      >
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
                      boxShadow: current ? `0 0 0 1.5px rgb(${c}), 0 0 10px rgba(${c}, 0.7)` : '',
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
            label="Words"
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
