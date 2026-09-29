import { ACHIEVEMENTS } from '../core/achievements';
import type { ClusterScore } from '../core/score';
import { calendar } from '../core/streak';
import Icon, { Sparks } from './Icon';

type Props = {
  score: number;
  clusters: ClusterScore[];
  regionName: (id: number) => string;
  achievements: Record<string, number>;
  coins: number;
  /** Words learned, being learned, and discovered so far, of `total`. */
  counts: { conquered: number; claimed: number; discovered: number; total: number };
  /** Answers per day, and the streak they make (core/streak.ts). */
  activity: Map<string, number>;
  streak: { current: number; best: number; playedToday: boolean };
  now: Date;
  onClose: () => void;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Score by topic and achievements (how scoring works is in the guide). */
export default function ProgressPanel(props: Props) {
  const { score, clusters, regionName, achievements, coins, counts, onClose } = props;
  const earned = ACHIEVEMENTS.filter((a) => a.id in achievements).length;
  return (
    <div className="panel p-4 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow">Score</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums text-amber-200">
              {score.toLocaleString()}
            </span>
            <Sparks n={coins} className="text-slate-300" />
          </div>
        </div>
        <button className="icon-btn -mr-1.5 -mt-1" onClick={onClose} title="Close">
          <Icon name="x" />
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {counts.conquered} of {counts.total} words learned
        {counts.claimed > 0 && ` · ${counts.claimed} learning`} · {counts.discovered} discovered
      </p>
      <Calendar activity={props.activity} streak={props.streak} now={props.now} />
      {clusters.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {clusters.map((c) => (
            <li
              key={c.region}
              className="text-xs"
              title={`${c.inside} links inside, ${c.outside} out`}
            >
              <div className="flex justify-between">
                <span className="text-slate-300">
                  {regionName(c.region)} <span className="text-slate-500">{c.words}</span>
                </span>
                <span className="text-amber-300">{c.points}</span>
              </div>
              <div className="mt-0.5 h-0.5 overflow-hidden rounded bg-slate-800">
                <div className="h-full bg-emerald-400/80" style={{ width: pct(c.cohesion) }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mb-1.5 mt-4 flex justify-between text-xs text-slate-500">
        <span className="eyebrow">Achievements</span>
        <span>
          {earned}/{ACHIEVEMENTS.length}
        </span>
      </div>
      <ul className="flex flex-wrap gap-1">
        {ACHIEVEMENTS.map((a) => {
          const got = a.id in achievements;
          return (
            <li
              key={a.id}
              title={`${a.description} · ${a.coins} sparks`}
              className={`rounded px-1.5 py-0.5 text-xs ${
                got ? 'bg-amber-500/15 text-amber-200' : 'text-slate-600'
              }`}
            >
              {a.title}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The last 15 weeks of play, GitHub style, with the streak. */
function Calendar({ activity, streak, now }: Pick<Props, 'activity' | 'streak' | 'now'>) {
  const weeks = calendar(activity, now, 15);
  const shade = (n: number) =>
    n === 0
      ? 'bg-slate-800'
      : n < 10
        ? 'bg-emerald-900'
        : n < 30
          ? 'bg-emerald-700'
          : n < 60
            ? 'bg-emerald-500'
            : 'bg-emerald-300';
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs text-slate-500">
        <span className={`flex items-center gap-1 ${streak.playedToday ? 'text-slate-200' : ''}`}>
          <Icon name="flame" className={streak.playedToday ? 'text-orange-400' : ''} />
          {streak.current} {streak.current === 1 ? 'day' : 'days'}
          {!streak.playedToday && streak.current > 0 && ' · play today to keep it'}
        </span>
        <span>best {streak.best}</span>
      </div>
      <div className="flex gap-[3px]">
        {weeks.map((w, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {w.map((d, j) =>
              d ? (
                <span
                  key={j}
                  title={`${d.key}: ${d.count} ${d.count === 1 ? 'answer' : 'answers'}`}
                  className={`h-[11px] w-[11px] rounded-sm ${shade(d.count)}`}
                />
              ) : (
                <span key={j} className="h-[11px] w-[11px]" />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
