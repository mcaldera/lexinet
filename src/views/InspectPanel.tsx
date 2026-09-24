import type { AppData, Components, EdgeReason } from '../db/repo';
import { isWeakBridge, REASON_LABEL, REASON_RGB, reasonText } from './visuals';

type Props = {
  data: AppData;
  health: Map<string, number | null>;
  selectedId?: string;
  onSelect: (id: string) => void;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Chips({ c }: { c: Components }) {
  const chip = (on: boolean, reason: EdgeReason, text: string) => (
    <span
      className="rounded px-1"
      style={{
        background: on ? `rgba(${REASON_RGB[reason]}, 0.2)` : 'transparent',
        color: on ? `rgb(${REASON_RGB[reason]})` : 'rgb(100, 116, 139)',
      }}
    >
      {text}
    </span>
  );
  return (
    <span className="flex gap-1 text-[11px]">
      {chip(c.semantic >= 0.45, 'semantic', `meaning ${pct(c.semantic)}`)}
      {chip(c.morphological > 0, 'morphological', 'family')}
      {chip(c.etymological > 0, 'etymological', 'root')}
      {chip(c.thematic > 0, 'thematic', 'theme')}
    </span>
  );
}

export default function InspectPanel({ data, health, selectedId, onSelect }: Props) {
  const { graph } = data;
  const params = graph.params;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const word = selectedId ? byId.get(selectedId) : undefined;

  if (!word) {
    const counts = data.edges.reduce<Record<string, number>>(
      (m, e) => ({ ...m, [e.reason]: (m[e.reason] ?? 0) + 1 }),
      {},
    );
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
        <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Inspect network</div>
        <p className="mb-2">
          {data.nodes.length} words · {data.edges.length} links (
          {Object.entries(counts)
            .map(([r, n]) => `${n} ${REASON_LABEL[r as EdgeReason]}`)
            .join(', ')}
          ). Click any word to see its links and strongest candidates.
        </p>
        <p className="mb-1 font-medium text-slate-200">How links are built</p>
        <ol className="list-decimal space-y-1 pl-4 text-slate-400">
          <li>
            Every pair of words gets a strength: meaning similarity of the English glosses
            {params && ` (${params.model})`}, plus bonuses for same word family, shared root and
            same theme.
          </li>
          <li>
            A maximum spanning tree links all words with the strongest links that keep the network
            connected. Some of those are weak bridges between groups (dashed).
          </li>
          <li>
            Each word also links to its top {params?.bonus_k ?? 3} partners scoring at least{' '}
            {pct(params?.bonus_threshold ?? 0.25)}. Everything else stays unlinked so themes don't
            become tangles where everything connects to everything.
          </li>
        </ol>
      </div>
    );
  }

  const links = data.edges.filter((e) => e.source === word.id || e.target === word.id);
  const cands = graph.candidates?.[word.id] ?? [];
  const h = health.get(word.id);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
      <div className="mb-2 flex justify-between text-xs uppercase tracking-wider text-slate-400">
        <span>Inspect</span>
        <span>
          {data.states.get(word.id)}
          {h != null && ` · health ${pct(h)}`}
        </span>
      </div>
      <div className="text-xl font-medium">
        {word.it} <span className="text-slate-400">= {word.en}</span>
      </div>
      <div className="mb-3 text-xs text-slate-500">
        {[
          `tier ${word.tier ?? 1}`,
          word.pos,
          word.theme && `theme ${word.theme}`,
          word.root && `root ${word.root}`,
          word.cognate && `≈ ${word.cognate}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>

      <div className="mb-1 text-xs uppercase tracking-wider text-slate-400">
        Links ({links.length})
      </div>
      <ul className="mb-3 space-y-1">
        {links.map((e) => {
          const other = byId.get(e.source === word.id ? e.target : e.source)!;
          return (
            <li key={other.id} className="flex items-baseline justify-between gap-2">
              <button
                className="shrink-0 text-left hover:underline"
                onClick={() => onSelect(other.id)}
              >
                <span style={{ color: `rgb(${REASON_RGB[e.reason]})` }}>●</span> {other.it}
              </button>
              <span className="text-right text-xs text-slate-400">
                {reasonText(e, word, other)} · {pct(e.weight)}
                {isWeakBridge(e) ? ' · weak bridge' : e.via === 'bonus' ? ' · top partner' : ''}
              </span>
            </li>
          );
        })}
      </ul>

      {cands.length > 0 && (
        <>
          <div className="mb-1 text-xs uppercase tracking-wider text-slate-400">
            Strongest candidates
          </div>
          <ul className="space-y-1.5">
            {cands.map((c) => (
              <li key={c.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <button className="text-left hover:underline" onClick={() => onSelect(c.id)}>
                    <span className="text-slate-500">#{c.rank}</span> {byId.get(c.id)?.it}
                  </button>
                  <span className={`text-xs ${c.linked ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {pct(c.weight)} · {c.linked ? 'linked' : 'not linked'}
                  </span>
                </div>
                <Chips c={c.components} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            A candidate stays unlinked when it's outside both words' top {params?.bonus_k ?? 3} and
            isn't needed to connect the network.
          </p>
        </>
      )}
    </div>
  );
}
