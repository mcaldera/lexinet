import type { ReactNode } from 'react';
import Icon from './Icon';

type Props = {
  /** The word as the player may see it ("?" until learned). */
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
  /** The word's status (NodeDetails, bare), inside the card rather than under it. */
  children?: ReactNode;
};

const TONE = {
  reach: { text: 'text-sky-300', bar: 'bg-sky-400' },
  locked: { text: 'text-rose-300', bar: 'bg-rose-400' },
  waiting: { text: 'text-slate-400', bar: 'bg-slate-300' },
  info: { text: 'text-pink-300', bar: 'bg-pink-400' },
} as const;

/**
 * The selected word can't be worked on right now (out of reach, locked after a
 * miss, next learning step not open): the panel stays on it and says why.
 */
export default function WaitCard(props: Props) {
  const { title, subtitle, message, tone, progress, action, onNext, onClose, children } = props;
  const t = TONE[tone];
  return (
    <div className="panel p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="headword text-[2rem]">{title}</h2>
          {subtitle && <i className="mt-1.5 block font-serif text-slate-500">{subtitle}</i>}
        </div>
        <button className="icon-btn -mr-1.5 -mt-1" onClick={onClose} title="Close">
          <Icon name="x" />
        </button>
      </div>
      {message && <p className={`mt-3 ${t.text}`}>{message}</p>}
      {progress !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={`h-full rounded-full ${t.bar}`}
            style={{ width: `${Math.min(1, progress) * 100}%` }}
          />
        </div>
      )}
      {action ? (
        <button autoFocus onClick={action.onClick} className="btn-primary mt-4 w-full py-2 text-sm">
          {action.label}
        </button>
      ) : (
        onNext && (
          <button autoFocus onClick={onNext} className="btn-ghost mt-4 w-full py-2 text-sm">
            Next word <span className="text-xs opacity-60">(enter)</span>
          </button>
        )
      )}
      {children && <div className="mt-4 border-t border-white/[0.06] pt-3">{children}</div>}
    </div>
  );
}
