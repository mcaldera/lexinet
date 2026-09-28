import { TENSES, type Drill } from '../core/verbs';
import type { NodeState } from '../core/unlock';

export type VerbGoal = {
  id: string;
  /** Shown name: '' while the verb is still undiscovered. */
  name: string;
  state: NodeState;
  level: number;
  drill: Drill | null;
};

type Props = {
  goals: VerbGoal[];
  need: number;
  /** Verb level required for the next tier (1 = presente). */
  level: number;
  nextTier: string;
  onSelect: (id: string) => void;
  onConjugate: (id: string) => void;
  onClose: () => void;
  nowMs: number;
};

function hint(g: VerbGoal, nowMs: number): string {
  if (g.state === 'locked') return 'not found yet';
  if (g.state !== 'conquered') return 'conquer it first';
  if (!g.drill) return '';
  if (g.drill.kind === 'learn' || g.drill.kind === 'defend') return g.drill.tense;
  if (g.drill.kind === 'wait')
    return `${g.drill.tense} in ${Math.max(1, Math.round((g.drill.until.getTime() - nowMs) / 3_600_000))} h`;
  return 'all tenses';
}

/** Which verbs can satisfy the next tier's verb requirement, and what to do next. */
export default function VerbGoals({
  goals,
  need,
  level,
  nextTier,
  onSelect,
  onConjugate,
  onClose,
  nowMs,
}: Props) {
  const done = goals.filter((g) => g.level >= level).length;
  // Undiscovered verbs are only counted: listing them spoils nothing and helps nobody.
  const shown = goals.filter((g) => g.state !== 'locked');
  const hidden = goals.length - shown.length;
  return (
    <div className="panel border-amber-500/40 p-4 text-sm">
      <div className="mb-3 flex justify-between text-xs text-amber-300/90">
        <span title="Conquer a verb, then conjugate it (one new tense per day)">
          To reach {nextTier}: {done}/{need} verbs conjugated in the {TENSES[level - 1]}
        </span>
        <button className="text-slate-500 hover:text-slate-200" onClick={onClose}>
          ✕
        </button>
      </div>
      <ul className="space-y-1.5">
        {shown.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-2">
            <button
              className="text-left hover:underline disabled:no-underline"
              disabled={g.state === 'locked'}
              onClick={() => onSelect(g.id)}
            >
              <span className={g.level >= level ? 'text-emerald-300' : 'text-slate-200'}>
                {g.name || '?'}
              </span>{' '}
              <span className="text-xs text-amber-300">{'◎'.repeat(g.level)}</span>
              <div className="text-xs text-slate-500">{hint(g, nowMs)}</div>
            </button>
            {(g.drill?.kind === 'learn' || g.drill?.kind === 'defend') && (
              <button
                onClick={() => onConjugate(g.id)}
                className="shrink-0 rounded bg-amber-700 px-2 py-1 text-xs hover:bg-amber-600"
              >
                Conjugate
              </button>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {shown.length ? '+' : ''}
          {hidden} not found yet
        </p>
      )}
    </div>
  );
}
