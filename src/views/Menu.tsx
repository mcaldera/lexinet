import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { audioSettings, onAudioSettings, setMusic, setSfx } from '../audio';
import { GRAPH_NAMES, graphLabel } from '../graphs';

type Props = {
  graphName: string;
  showRoots: boolean;
  onRoots: (on: boolean) => void;
  inspect: boolean;
  onInspect: (on: boolean) => void;
  onGuide: () => void;
  offsetDays: number;
  onTravel: (days: number) => void;
  onNewGame: () => void;
};

/** Settings and rarely used actions, out of the way behind one button. */
export default function Menu(props: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const audio = useSyncExternalStore(onAudioSettings, audioSettings);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (label: string, on: boolean, set: (v: boolean) => void) => (
    <button
      onClick={() => set(!on)}
      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-800"
    >
      {label}
      <span
        className={`h-4 w-7 rounded-full p-0.5 transition ${on ? 'bg-emerald-600' : 'bg-slate-700'}`}
      >
        <span
          className={`block h-3 w-3 rounded-full bg-white transition ${on ? 'translate-x-3' : ''}`}
        />
      </span>
    </button>
  );
  const action = (label: string, onClick: () => void, cls = '') => (
    <button
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className={`w-full rounded px-2 py-1.5 text-left hover:bg-slate-800 ${cls}`}
    >
      {label}
    </button>
  );
  const time = 'rounded bg-slate-800 px-2 py-1 hover:bg-slate-700';

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Menu"
        className={`rounded px-2.5 py-1 text-slate-300 hover:bg-slate-800 ${open ? 'bg-slate-800' : ''}`}
      >
        ☰
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-sm text-slate-300 shadow-xl">
          {GRAPH_NAMES.length > 1 && (
            <select
              value={props.graphName}
              onChange={(e) => {
                const url = new URL(window.location.href);
                if (e.target.value === 'default') url.searchParams.delete('graph');
                else url.searchParams.set('graph', e.target.value);
                window.location.href = url.toString();
              }}
              className="mb-1 w-full rounded bg-slate-800 px-2 py-1.5"
            >
              {GRAPH_NAMES.map((n) => (
                <option key={n} value={n}>
                  {graphLabel(n)}
                </option>
              ))}
            </select>
          )}
          {toggle('Music', audio.music, setMusic)}
          {toggle('Sounds', audio.sfx, setSfx)}
          {toggle('Roots', props.showRoots, props.onRoots)}
          {toggle('Whole network', props.inspect, (on) => {
            setOpen(false);
            props.onInspect(on);
          })}
          <div className="my-1 border-t border-slate-800" />
          {action('How it works', props.onGuide)}
          <div className="px-2 pb-1 pt-2 text-xs text-slate-500">
            Time travel
            {props.offsetDays !== 0 && ` (+${Math.round(props.offsetDays * 100) / 100} d)`}
          </div>
          <div className="flex flex-wrap gap-1 px-2 pb-1.5 text-xs">
            <button className={time} onClick={() => props.onTravel(15 / 1440)}>
              +15 min
            </button>
            <button className={time} onClick={() => props.onTravel(1)}>
              +1 day
            </button>
            <button className={time} onClick={() => props.onTravel(7)}>
              +7 days
            </button>
            {props.offsetDays !== 0 && (
              <button className={time} onClick={() => props.onTravel(0)}>
                now
              </button>
            )}
          </div>
          <div className="my-1 border-t border-slate-800" />
          {action(
            'New game…',
            () => {
              if (confirm('Start over? All progress on this word list is lost.')) props.onNewGame();
            },
            'text-red-300',
          )}
        </div>
      )}
    </div>
  );
}
