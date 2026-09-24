import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { edgeOpacity, healthBand } from '../core/health';
import type { AppData, EdgeReason, WordNode } from '../db/repo';

type GNode = { id: string; word: WordNode };
type GLink = { source: string; target: string; reason: EdgeReason; weight: number };
type N = NodeObject<GNode>;
type L = LinkObject<GNode, GLink>;

const BAND_COLOR = {
  solid: 'rgba(52, 211, 153, 1)', // emerald
  faded: 'rgba(52, 211, 153, 0.7)',
  dashed: 'rgba(250, 204, 21, 0.55)', // amber
  cracked: 'rgba(248, 113, 113, 0.85)', // red
} as const;

const REASON_TEXT: Record<EdgeReason, string> = {
  semantic: 'similar meaning',
  morphological: 'shared root',
  thematic: 'same theme',
};

type Props = { data: AppData; health: Map<string, number | null> };

export default function GraphView({ data, health }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<N, L>>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });

  // Keep node objects stable across renders so the layout doesn't restart.
  const nodeCache = useRef(new Map<string, N>());
  const visibleKey = data.nodes
    .filter((n) => data.states.get(n.id) !== 'locked')
    .map((n) => n.id)
    .join(',');

  const graphData = useMemo(() => {
    const visible = new Set(visibleKey.split(',').filter(Boolean));
    const nodes = data.nodes
      .filter((n) => visible.has(n.id))
      .map((w) => {
        let n = nodeCache.current.get(w.id);
        if (!n) {
          n = { id: w.id, word: w };
          nodeCache.current.set(w.id, n);
        }
        return n;
      });
    const links: GLink[] = data.edges
      .filter((e) => visible.has(e.source) && visible.has(e.target))
      .map((e) => ({ ...e }));
    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, data.edges]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fg.current?.d3Force('link')?.distance(50);
    fg.current?.d3Force('charge')?.strength(-120);
  }, []);

  const endId = (x: string | N | undefined) => (typeof x === 'object' ? x.id : x) as string;
  const nodeWord = (id: string) => data.nodes.find((n) => n.id === id)?.it ?? '?';

  const drawNode = (node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const state = data.states.get(node.id);
    const r = 6;
    ctx.save();
    if (state === 'frontier') {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(71, 85, 105, 0.6)';
      ctx.fill();
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `bold ${8}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y + 0.5);
      ctx.restore();
      return;
    }
    const h = health.get(node.id) ?? 1;
    const band = healthBand(h);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = BAND_COLOR[band];
    ctx.fill();
    if (band === 'dashed' || band === 'cracked') {
      ctx.setLineDash([2, 1.5]);
      ctx.strokeStyle = band === 'cracked' ? '#fecaca' : '#fde68a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (band === 'cracked') {
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 4);
      ctx.lineTo(x, y - 0.5);
      ctx.lineTo(x - 1.5, y + 1.5);
      ctx.lineTo(x + 2, y + 4.5);
      ctx.moveTo(x, y - 0.5);
      ctx.lineTo(x + 3.5, y - 2);
      ctx.stroke();
    }
    const fontSize = Math.max(3, 11 / scale);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = `rgba(226, 232, 240, ${Math.max(0.35, h)})`;
    ctx.fillText(node.word.it, x, y + r + 1.5);
    ctx.restore();
  };

  const linkAlpha = (l: L) => {
    const a = health.get(endId(l.source as string | N));
    const b = health.get(endId(l.target as string | N));
    const frontier = [l.source, l.target].some(
      (e) => data.states.get(endId(e as string | N)) === 'frontier',
    );
    return frontier ? 0.25 : Math.max(0.12, edgeOpacity(a ?? null, b ?? null));
  };

  return (
    <div ref={wrap} className="relative h-full w-full">
      <ForceGraph2D<GNode, GLink>
        ref={fg}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="#020617"
        nodeRelSize={6}
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, 8, 0, 2 * Math.PI);
          ctx.fill();
        }}
        nodeLabel={(n) => {
          if (data.states.get(n.id) === 'frontier') return 'Unknown word: review it to conquer';
          const h = health.get(n.id);
          return `${n.word.it} = ${n.word.en}${h != null ? ` · health ${Math.round(h * 100)}%` : ''}`;
        }}
        linkColor={(l) => `rgba(148, 163, 184, ${linkAlpha(l)})`}
        linkWidth={(l) => 0.5 + l.weight * 2}
        linkHoverPrecision={6}
        linkLabel={(l) => {
          const a = endId(l.source as string | N);
          const b = endId(l.target as string | N);
          const hidden = [a, b].some((id) => data.states.get(id) === 'frontier');
          const theme = data.nodes.find((n) => n.id === a)?.theme;
          const why =
            l.reason === 'thematic' && theme ? `same theme (${theme})` : REASON_TEXT[l.reason];
          return hidden ? why : `${nodeWord(a)} ↔ ${nodeWord(b)}: ${why}`;
        }}
        cooldownTicks={200}
        onEngineStop={() => fg.current?.zoomToFit(400, 60)}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 rounded bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
        <Legend color={BAND_COLOR.solid} label="> 90%" />
        <Legend color={BAND_COLOR.faded} label="70–90%" />
        <Legend color={BAND_COLOR.dashed} label="50–70%" />
        <Legend color={BAND_COLOR.cracked} label="< 50%" />
        <Legend color="rgba(71, 85, 105, 0.9)" label="? frontier" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
