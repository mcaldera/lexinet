import type { ReactNode } from 'react';

/**
 * Line icons (24 px grid, drawn with the text colour) in place of emoji, which
 * looked cheap and render differently on every system. Sized to the text: 1em.
 */
const ICONS = {
  x: <path d="M18 6 6 18M6 6l12 12" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M5 12h14M12 5v14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  arrowLeft: <path d="m12 19-7-7 7-7M19 12H5" />,
  volume: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  flame: (
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  ),
  trophy: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0z" />
    </>
  ),
  /** Sparks, the currency: a four-point sparkle (filled). */
  spark: (
    <path d="M12 2.5Q13.2 10.8 21.5 12 13.2 13.2 12 21.5 10.8 13.2 2.5 12 10.8 10.8 12 2.5z" />
  ),
  /** Focus sessions. */
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  /** Pop quizzes. */
  timer: (
    <>
      <path d="M10 2h4M12 14l3-3" />
      <circle cx="12" cy="14" r="8" />
    </>
  ),
  /** Connecting a new word. */
  link: (
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  ),
  /** The English cousin (a clue). */
  bulb: (
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4" />
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  shuffle: (
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22m-4-4 4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8m5.7-1.4 4 4-4 4" />
  ),
  /** Recovering a lost word. */
  recover: <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />,
  /** An anchor: a word known well enough to send full signal. */
  anchor: (
    <>
      <circle cx="12" cy="5" r="3" />
      <path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3" />
    </>
  ),
  /** The whole network. */
  network: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  /** Time running fast (nothing to do but wait). */
  fastForward: <path d="m13 19 9-7-9-7zM2 19l9-7-9-7z" />,
  /** Relaxing the map's layout: loose waves. */
  relax: (
    <path d="M2 8c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1M2 16c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1" />
  ),
  /** Choosing from a list. */
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export default function Icon({
  name,
  className = '',
  title,
}: {
  name: IconName;
  className?: string;
  /** Said by screen readers; otherwise the icon is decoration next to its text. */
  title?: string;
}) {
  const filled = name === 'spark';
  return (
    <svg
      viewBox="0 0 24 24"
      className={`inline-block h-[1em] w-[1em] shrink-0 ${className}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}

/** A price or balance in sparks: "3 ✦". */
export function Sparks({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${className}`}>
      {n}
      <Icon name="spark" className="text-[0.85em] text-amber-300" />
    </span>
  );
}
