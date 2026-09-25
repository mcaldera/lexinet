type Props = {
  /** The word as the player may see it ("?" until conquered). */
  title: string;
  subtitle?: string;
  message: string;
  tone: 'reach' | 'locked' | 'waiting' | 'info';
  /** 0-1: how close it is (reach, or time until the next step). */
  progress?: number;
  /** Offered once the word can be worked on again. */
  action?: { label: string; onClick: () => void };
  /** Meanwhile: go and do something else. */
  onNext?: () => void;
  onClose: () => void;
};

const TONE = {
  reach: { border: 'border-sky-500/30', text: 'text-sky-300', bar: 'bg-sky-400' },
  locked: { border: 'border-red-500/30', text: 'text-red-300', bar: 'bg-red-400' },
  waiting: { border: 'border-slate-700', text: 'text-slate-400', bar: 'bg-slate-300' },
  info: { border: 'border-pink-500/30', text: 'text-pink-300', bar: 'bg-pink-400' },
} as const;

/**
 * The selected word can't be worked on right now (out of reach, locked after a
 * miss, next claim step not open): the panel stays on it and says why.
 */
export default function WaitCard(props: Props) {
  const { title, subtitle, message, tone, progress, action, onNext, onClose } = props;
  const t = TONE[tone];
  return (
    <div className={`rounded-lg border bg-slate-900 p-4 text-sm ${t.border}`}>
      <div className="flex justify-end">
        <button className="text-xs text-slate-500 hover:text-slate-200" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="text-center text-2xl font-medium">{title}</div>
      {subtitle && <div className="text-center text-xs text-slate-500">{subtitle}</div>}
      <p className={`mt-3 text-center ${t.text}`}>{message}</p>
      {progress !== undefined && (
        <div className="mx-auto mt-2 h-1 w-2/3 overflow-hidden rounded bg-slate-800">
          <div className={`h-full ${t.bar}`} style={{ width: `${Math.min(1, progress) * 100}%` }} />
        </div>
      )}
      {action ? (
        <button
          autoFocus
          onClick={action.onClick}
          className="mt-4 w-full rounded bg-emerald-700 py-2 text-sm font-medium text-white hover:bg-emerald-600"
        >
          {action.label}
        </button>
      ) : (
        onNext && (
          <button
            autoFocus
            onClick={onNext}
            className="mt-4 w-full rounded bg-slate-800 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            Next word <span className="text-xs opacity-60">(enter)</span>
          </button>
        )
      )}
    </div>
  );
}
