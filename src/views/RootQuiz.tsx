import { useState } from 'react';
import { checkMeaning, type AnswerCheck } from '../core/answer';
import type { AppData, RootHub } from '../db/repo';

type Props = {
  data: AppData;
  hub: RootHub;
  /** Called once the player continues after seeing the result. */
  onDone: (correct: boolean) => void;
  onCancel: () => void;
};

/** Unlock a root by naming its meaning, with English and known Italian words as clues. */
export default function RootQuiz({ data, hub, onDone, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const [check, setCheck] = useState<AnswerCheck | null>(null);
  const known = hub.words
    .filter((w) => data.states.get(w) === 'conquered')
    .map((w) => data.nodes.find((n) => n.id === w)!);
  const hidden = hub.words.length - known.length;
  const correct = check?.verdict !== 'wrong';

  const submit = () => {
    if (!check) return setCheck(checkMeaning(typed, hub.meaning ?? hub.root));
    onDone(correct);
  };

  return (
    <div className="rounded-lg border border-pink-500/40 bg-slate-900 p-4 text-sm">
      <div className="flex justify-end">
        <button className="text-xs text-slate-500 hover:text-slate-200" onClick={onCancel}>
          ✕
        </button>
      </div>
      <div className="text-center">
        <div className="text-xs text-slate-500">{hub.lang}</div>
        <div className="py-1 font-serif text-3xl italic text-pink-200">{hub.root}</div>
      </div>
      <div className="my-3 space-y-0.5 text-center text-xs text-slate-400">
        {!!hub.english?.length && <div>≈ {hub.english.join(', ')}</div>}
        <div>
          {known.map((w) => w.it).join(', ')}
          {hidden > 0 && <span className="text-slate-600"> +{hidden}</span>}
        </div>
      </div>
      <input
        autoFocus
        value={typed}
        readOnly={!!check}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          submit();
        }}
        placeholder="meaning in English"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-lg outline-none focus:border-pink-400"
      />
      {check && (
        <div
          className={`mt-3 rounded border px-3 py-2 ${
            correct
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/50 bg-red-500/10 text-red-300'
          }`}
        >
          <div className="text-sm font-semibold">
            {correct ? `Unlocked${hidden ? ` · +${hidden}` : ''}` : 'Not quite'}
          </div>
          <div className="text-slate-100">
            {hub.root} = “{hub.meaning}”
          </div>
        </div>
      )}
      <button
        onClick={submit}
        className="mt-3 w-full rounded bg-pink-700 py-2 text-sm hover:bg-pink-600"
      >
        {check ? 'Continue' : 'Check'}
      </button>
    </div>
  );
}
