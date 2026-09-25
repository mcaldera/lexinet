import { ACHIEVEMENTS } from '../core/achievements';
import type { ClusterScore } from '../core/score';
import { PLANT_COST, COINS_PER_CONQUEST } from '../config';

type Props = {
  score: number;
  clusters: ClusterScore[];
  regionName: (id: number) => string;
  achievements: Record<string, number>;
  coins: number;
  onClose: () => void;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Score by category, achievements, and how coins work. */
export default function ProgressPanel(props: Props) {
  const { score, clusters, regionName, achievements, coins, onClose } = props;
  const earned = ACHIEVEMENTS.filter((a) => a.id in achievements).length;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-slate-900 p-4 text-sm">
      <div className="mb-2 flex justify-between text-xs uppercase tracking-wider text-amber-300/90">
        <span>Your progress</span>
        <button className="normal-case text-slate-400 hover:text-slate-200" onClick={onClose}>
          Close ✕
        </button>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-bold text-amber-300">{score.toLocaleString()}</span>
        <span className="text-slate-300">🪙 {coins} coins</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Each category scores 10 × its conquered words × (1 + 2 × cohesion). Cohesion = links among
        them ÷ all their links: links leaving the category pull it apart. Conquer the words next to
        yours, or plant new ones, to tighten a category.
      </p>
      {clusters.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {clusters.map((c) => (
            <li key={c.region} className="text-xs">
              <div className="flex justify-between">
                <span className="text-slate-200">
                  {regionName(c.region)}{' '}
                  <span className="text-slate-500">
                    · {c.words} {c.words === 1 ? 'word' : 'words'} · {c.inside} in / {c.outside} out
                  </span>
                </span>
                <span className="font-semibold text-amber-300">{c.points}</span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded bg-slate-800">
                <div className="h-full bg-emerald-400" style={{ width: pct(c.cohesion) }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mb-1 mt-4 flex justify-between text-xs uppercase tracking-wider text-slate-400">
        <span>Achievements</span>
        <span>
          {earned}/{ACHIEVEMENTS.length}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-1.5">
        {ACHIEVEMENTS.map((a) => {
          const got = a.id in achievements;
          return (
            <li
              key={a.id}
              title={a.description}
              className={`rounded border px-2 py-1 text-xs ${
                got
                  ? 'border-amber-400/60 bg-amber-500/10 text-amber-100'
                  : 'border-slate-800 text-slate-500'
              }`}
            >
              <div className="font-semibold">
                {got ? '🏆' : '·'} {a.title}
              </div>
              <div className="text-[11px] opacity-80">
                {a.description} · 🪙{a.coins}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        🪙 Coins: +{COINS_PER_CONQUEST} per conquest and more per achievement. Spend {PLANT_COST} to
        plant a word next to one of yours (select a conquered word, then “Plant a word”).
      </p>
    </div>
  );
}
