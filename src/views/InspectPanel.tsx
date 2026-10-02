import type { AppData, EdgeReason } from '../db/repo';
import Etymology from './Etymology';
import { SpeakButton } from './ReviewView';
import { REASON_LABEL, REASON_RGB } from './visuals';

type Props = {
  data: AppData;
  selectedId?: string;
  onSelect: (id: string) => void;
};

/** Where a word stands for you, in a few words. */
const STANDING: Record<string, string> = {
  conquered: 'Learned',
  claimed: 'Learning',
  frontier: 'On your map',
  locked: 'Not found yet',
};

/**
 * The whole network's side panel, for players (not for building the network:
 * its old link statistics and scoring lived here). Nothing selected: what the
 * picture is. A word: what it means, where it stands for you, its origin and
 * the words it's linked to (tap to go). A root: its words.
 */
export default function InspectPanel({ data, selectedId, onSelect }: Props) {
  const { graph } = data;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const word = selectedId ? byId.get(selectedId) : undefined;
  const hub = graph.roots?.find((r) => r.id === selectedId);
  const chip = (id: string, reason?: EdgeReason) => {
    const w = byId.get(id);
    if (!w) return null;
    return (
      <button
        key={id}
        onClick={() => onSelect(id)}
        title={reason && REASON_LABEL[reason]}
        className="inline-flex items-baseline gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 hover:border-white/25 hover:bg-white/[0.07]"
      >
        {reason && (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 self-center rounded-full"
            style={{ background: `rgb(${REASON_RGB[reason]})` }}
          />
        )}
        <span className="text-slate-100">{w.it}</span>
        <span className="text-xs text-slate-500">{w.en}</span>
      </button>
    );
  };

  if (hub) {
    return (
      <div className="panel p-4 text-sm">
        <div className="eyebrow mb-1.5 text-pink-300/80">Shared root</div>
        <div className="text-xl">
          <i className="font-latin text-pink-200">{hub.root}</i>
          {hub.meaning && <span className="text-slate-400"> “{hub.meaning}”</span>}
        </div>
        <div className="text-xs text-slate-500">{hub.lang}</div>
        {!!hub.english?.length && (
          <p className="mt-2 text-slate-300">
            <span className="text-slate-500">In English: </span>
            {hub.english.join(', ')}
          </p>
        )}
        <div className="eyebrow mb-1.5 mt-3">{hub.words.length} words from it</div>
        <div className="flex flex-wrap gap-1.5">{hub.words.map((id) => chip(id))}</div>
      </div>
    );
  }

  if (!word) {
    return (
      <div className="panel p-4 text-sm text-slate-300">
        <div className="eyebrow mb-1.5">Whole network</div>
        <p>
          Every word you can learn: {data.nodes.length.toLocaleString()} words in{' '}
          {graph.regions?.length ?? 0} topics. Each star is a word, and lines join words that belong
          together. Tap one to look closer.
        </p>
      </div>
    );
  }

  const links = data.edges.filter((e) => e.source === word.id || e.target === word.id);
  const topic = graph.regions?.find((r) => r.id === word.region)?.name ?? word.theme;
  const level = word.tier ? graph.params?.tier_names?.[String(word.tier)] : undefined;
  return (
    <div className="panel p-4 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="headword text-2xl">{word.it}</span>
        <SpeakButton text={word.it} />
        <span className="ml-auto text-xs text-slate-400">
          {STANDING[data.states.get(word.id) ?? 'locked']}
        </span>
      </div>
      <div className="mt-1 text-slate-300">
        <i className="text-slate-500">{word.pos}</i> {word.en}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {[topic, level].filter(Boolean).join(' · ')}
      </div>
      <div className="mt-2">
        <Etymology word={word} />
      </div>
      {links.length > 0 && (
        <>
          <div className="eyebrow mb-1.5 mt-3">Linked to</div>
          <div className="flex flex-wrap gap-1.5">
            {links.map((e) => chip(e.source === word.id ? e.target : e.source, e.reason))}
          </div>
        </>
      )}
    </div>
  );
}
