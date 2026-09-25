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
  if (g.state === 'locked') return 'not discovered yet: conquer words nearby';
  if (g.state !== 'conquered') return 'discovered: conquer it first';
  if (!g.drill) return '';
  if (g.drill.kind === 'learn') return `ready: learn the ${g.drill.tense}`;
  if (g.drill.kind === 'defend') return `defend the ${g.drill.tense}`;
  if (g.drill.kind === 'wait')
    return `next tense in ~${Math.max(1, Math.round((g.drill.until.getTime() - nowMs) / 3_600_000))} h`;
  return 'fully conjugated';
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
  return (
    <div className="rounded-lg border border-amber-500/40 bg-slate-900 p-4 text-sm">
      <div className="mb-2 flex justify-between text-xs uppercase tracking-wider text-amber-300/90">
        <span>Verbs for {nextTier}</span>
        <button className="normal-case text-slate-400 hover:text-slate-200" onClick={onClose}>
          Close ✕
        </button>
      </div>
      <p className="mb-3 text-slate-300">
        Level <b>{need}</b> verb{need === 1 ? '' : 's'} to the <b>{TENSES[level - 1]}</b> ({done}/
        {need}
        ). Conquer a verb, then conjugate it: one new tense per day.
      </p>
      <ul className="space-y-1.5">
        {goals.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-2">
            <button
              className="text-left hover:underline disabled:no-underline"
              disabled={g.state === 'locked'}
              onClick={() => onSelect(g.id)}
            >
              <span className={g.level >= level ? 'text-emerald-300' : 'text-slate-200'}>
                {g.name || '? (undiscovered verb)'}
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
    </div>
  );
}
