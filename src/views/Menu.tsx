import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { audioSettings, onAudioSettings, setMusic, setSfx, setSpeech } from '../audio';
import { listRuns } from '../runs';
import {
  canSpeak,
  chosenVoice,
  languageVoices,
  mayBeSilent,
  onVoices,
  setVoice,
  speak,
  voiceCount,
} from '../speech';
import { lang } from '../core/language';
import { GRAPH_NAMES, graphLabel, switchGraph } from '../graphs';
import Icon from './Icon';

type Props = {
  graphName: string;
  inspect: boolean;
  onInspect: (on: boolean) => void;
  onGuide: () => void;
  offsetDays: number;
  onTravel: (days: number) => void;
  /** Offer the "say words aloud" switch. */
  speechToggle?: boolean;
  runId: string;
  onNewRun: () => void;
  onSwitchRun: (id: string) => void;
  onDeleteRun: (id: string) => void;
  /** Wipe the current run and pick a new start. */
  onRestart: () => void;
};

/** Settings and rarely used actions, out of the way behind one button. */
export default function Menu(props: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const audio = useSyncExternalStore(onAudioSettings, audioSettings);
  // Chrome loads voices after the page: re-render when they arrive or one is picked.
  const [, setVoicesSeen] = useState(0);
  useEffect(() => onVoices(() => setVoicesSeen((n) => n + 1)), []);
  // Read fresh on every render: names and counts change while playing.
  const [, setDeleted] = useState(0);
  const runs = listRuns(props.graphName).runs;
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
      className={`w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06] ${cls}`}
    >
      {label}
    </button>
  );
  const time = 'rounded-md bg-white/[0.06] px-2 py-1 hover:bg-white/[0.12]';

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Menu"
        className={`chip px-2 py-1 text-base text-slate-300 ${open ? 'border-white/20 bg-white/10' : ''}`}
      >
        <Icon name="menu" />
      </button>
      {open && (
        <div className="glass absolute right-0 top-full z-20 mt-2 w-60 rounded-xl bg-slate-900/90 p-1.5 text-sm text-slate-300">
          {GRAPH_NAMES.length > 1 && (
            <select
              value={props.graphName}
              onChange={(e) => switchGraph(e.target.value)}
              className="mb-1 w-full rounded bg-slate-800 px-2 py-1.5"
            >
              {GRAPH_NAMES.map((n) => (
                <option key={n} value={n}>
                  Learn {graphLabel(n)}
                </option>
              ))}
            </select>
          )}
          {toggle('Music', audio.music, setMusic)}
          {toggle('Sounds', audio.sfx, setSfx)}
          {props.speechToggle && canSpeak() && toggle('Say words aloud', audio.speech, setSpeech)}
          {props.speechToggle && canSpeak() && <VoicePicker />}
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
          <div className="px-2 pb-1 pt-1 text-xs text-slate-500">Runs</div>
          {runs.map((r) => (
            <div key={r.id} className="group flex items-center">
              <button
                disabled={r.id === props.runId}
                onClick={() => props.onSwitchRun(r.id)}
                className={`flex flex-1 justify-between rounded px-2 py-1 text-left ${
                  r.id === props.runId ? 'text-emerald-300' : 'hover:bg-slate-800'
                }`}
              >
                <span className="truncate">{r.name}</span>
                <span className="text-xs text-slate-500">{r.conquered ?? 0}</span>
              </button>
              {r.id !== props.runId && (
                <button
                  title="Delete this run"
                  onClick={() => {
                    if (!confirm(`Delete the run “${r.name}”?`)) return;
                    props.onDeleteRun(r.id);
                    setDeleted((n) => n + 1);
                  }}
                  className="invisible px-1.5 text-xs text-slate-500 hover:text-red-300 group-hover:visible"
                >
                  <Icon name="x" />
                </button>
              )}
            </div>
          ))}
          {action('+ New run', props.onNewRun, 'text-emerald-300')}
          {action(
            'Restart this run…',
            () => {
              if (confirm('Start this run over? Its progress is lost.')) props.onRestart();
            },
            'text-red-300',
          )}
        </div>
      )}
    </div>
  );
}

/** Which voice speaks, with a test button; says so when the language has none. */
function VoicePicker() {
  const voices = languageVoices();
  const current = chosenVoice();
  return (
    <div className="px-2 pb-1.5 text-xs">
      {voices.length ? (
        <div className="flex items-center gap-1.5">
          <select
            value={current?.name}
            onChange={(e) => {
              setVoice(e.target.value);
              speak(lang().greeting);
            }}
            className="min-w-0 flex-1 rounded bg-slate-800 px-1.5 py-1"
            title="Voice"
          >
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
                {v.localService ? '' : ' (online)'}
                {mayBeSilent(v) ? ' (silent in Chrome)' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => speak(lang().greeting)}
            className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
            title="Test the voice"
          >
            <Icon name="volume" />
          </button>
        </div>
      ) : (
        <p className="text-amber-300">
          {voiceCount()
            ? `No ${lang().name} voice installed on this system (see “How it works”).`
            : 'The browser offers no voices yet.'}
        </p>
      )}
    </div>
  );
}
