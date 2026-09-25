type Props = {
  /** The word as the player may see it ("?" until conquered). */
  title: string;
  subtitle?: string;
  message: string;
  tone: 'reach' | 'locked' | 'waiting' | 'info';
  /** Offered once the word can be worked on again. */
  action?: { label: string; onClick: () => void };
  onClose: () => void;
};

const TONE = {
  reach: 'border-sky-500/40 text-sky-300/90',
  locked: 'border-red-500/40 text-red-300/90',
  waiting: 'border-slate-600 text-slate-300',
  info: 'border-pink-500/40 text-pink-300/90',
} as const;

const LABEL = {
  reach: 'Beyond your reach',
  locked: 'Locked',
  waiting: 'Not yet',
  info: 'Root',
} as const;

/**
 * The selected word can't be worked on right now (out of reach, locked after a
 * miss, next claim step not open): the panel stays on it and says why.
 */
export default function WaitCard({ title, subtitle, message, tone, action, onClose }: Props) {
  return (
    <div className={`rounded-lg border bg-slate-900 p-4 text-sm ${TONE[tone].split(' ')[0]}`}>
      <div
        className={`mb-2 flex justify-between text-xs uppercase tracking-wider ${TONE[tone].split(' ')[1]}`}
      >
        <span>{LABEL[tone]}</span>
        <button className="normal-case text-slate-400 hover:text-slate-200" onClick={onClose}>
          Close ✕
        </button>
      </div>
      <div className="text-center text-2xl font-medium">{title}</div>
      {subtitle && <div className="text-center text-xs text-slate-500">{subtitle}</div>}
      <p className="mt-3 text-slate-300">{message}</p>
      {action && (
        <button
          autoFocus
          onClick={action.onClick}
          className="mt-3 w-full rounded bg-emerald-700 py-2 text-sm font-medium text-white hover:bg-emerald-600"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
