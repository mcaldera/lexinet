import { useMemo, useState } from 'react';
import { SUPPLY } from '../config';
import { neighbourWeights } from '../core/game';
import { startCandidates } from '../core/start';
import { coverage } from '../core/supply';
import type { Edge, Region, WordNode } from '../db/repo';

type Props = {
  regions: Region[];
  nodes: WordNode[];
  edges: Edge[];
  /** A category's id (undefined: anywhere), and the capital chosen (undefined: by chance). */
  onPick: (region?: number, capital?: string) => void;
};

/**
 * A new game: pick a category, then your capital, the first word and your
 * first supply node. Each candidate says how many words it would keep
 * supplied once they are yours (core/supply.ts coverage), by its English
 * meaning: the Italian is earned.
 */
export default function StartPicker({ regions, nodes, edges, onPick }: Props) {
  const sorted = [...regions].sort((a, b) => a.name.localeCompare(b.name));
  const [region, setRegion] = useState<Region | null>(null);
  const candidates = useMemo(() => {
    if (!region) return [];
    const weights = neighbourWeights(edges);
    return startCandidates(nodes, edges, region.id)
      .map((id) => ({
        id,
        word: nodes.find((n) => n.id === id)!,
        supplies: coverage(weights, id, SUPPLY),
      }))
      .sort((a, b) => b.supplies - a.supplies)
      .slice(0, 8);
  }, [region, nodes, edges]);
  const best = candidates[0]?.supplies ?? 1;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(2,6,23,0.7),rgba(2,6,23,0.95))] p-6 backdrop-blur-sm">
      {region ? (
        <div className="w-full max-w-md">
          <h2 className="mb-2 text-center font-title text-3xl font-bold tracking-[0.08em] text-emerald-100 [text-shadow:0_0_24px_rgba(52,211,153,0.45)]">
            {region.name}: your capital
          </h2>
          <p className="mb-5 text-center text-sm text-slate-500">
            Your first word and first supply node. Strongly linked words supply more.
          </p>
          <ul className="space-y-1.5">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onPick(region.id, c.id)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-amber-400/60 hover:bg-amber-400/10"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-100">{c.word.en}</span>
                    <span className="shrink-0 text-xs text-amber-300">
                      supplies {c.supplies} words
                    </span>
                  </div>
                  <span className="mt-1 block h-1 overflow-hidden rounded bg-white/[0.06]">
                    <span
                      className="block h-full bg-amber-400/80"
                      style={{ width: `${Math.round((c.supplies / best) * 100)}%` }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => setRegion(null)} className="btn-ghost rounded-full px-4 py-1.5">
              ← Categories
            </button>
            <button
              autoFocus
              onClick={() => onPick(region.id)}
              className="btn-primary rounded-full px-5 py-1.5"
            >
              🎲 Choose for me
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-2xl">
          <h2 className="mb-2 text-center font-title text-3xl font-bold tracking-[0.08em] text-emerald-100 [text-shadow:0_0_24px_rgba(52,211,153,0.45)]">
            Where to begin?
          </h2>
          <p className="mb-5 text-center text-sm text-slate-500">
            Your territory grows from there.
          </p>
          <button
            autoFocus
            onClick={() => onPick()}
            className="btn-primary mx-auto mb-6 block rounded-full px-6 py-2"
          >
            🎲 Anywhere
          </button>
          {sorted.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {sorted.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRegion(r)}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm text-slate-300 transition hover:-translate-y-px hover:border-emerald-400/60 hover:bg-emerald-400/10 hover:text-emerald-100 hover:shadow-[0_0_16px_-4px_rgba(52,211,153,0.6)]"
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
