import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { edgeOpacity, healthBand } from '../core/health';
import type { AppData, Edge, RootHub, WordNode } from '../db/repo';
import { useKeyboardCamera } from './useKeyboardCamera';
import {
  isWeakBridge,
  REASON_LABEL,
  REASON_RGB,
  reasonText,
  shapeOf,
  shapePath,
  type Shape,
} from './visuals';

/** Word node, or a root hub (then `word` holds the root's name/meaning for labels). */
type GNode = { id: string; word: WordNode; hub?: RootHub };
/** `descends`: link from a root hub to one of its words. */
type GLink = Edge & { descends?: boolean };
type N = NodeObject<GNode>;
type L = LinkObject<GNode, GLink>;

const BAND_COLOR = {
  solid: 'rgba(52, 211, 153, 1)', // emerald
  faded: 'rgba(52, 211, 153, 0.7)',
  dashed: 'rgba(250, 204, 21, 0.55)', // amber
  cracked: 'rgba(248, 113, 113, 0.85)', // red
} as const;

type Props = {
  data: AppData;
  health: Map<string, number | null>;
  /** Node of the card being reviewed, or the node selected in inspect mode. */
  activeId?: string;
  /** Show every word and edge (spoilers) for inspecting the network. */
  inspect: boolean;
  /** Draw shared roots as hub nodes (replaces word-to-word "shared root" links). */
  showRoots: boolean;
  onNodeClick: (id: string) => void;
};

export default function GraphView({
  data,
  health,
  activeId,
  inspect,
  showRoots,
  onNodeClick,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<N, L>>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useKeyboardCamera(fg);
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);

  // Keep node objects stable across renders so the layout doesn't restart.
  const nodeCache = useRef(new Map<string, N>());
  const hubs = useMemo(() => (showRoots ? (data.graph.roots ?? []) : []), [showRoots, data.graph]);
  // A root appears once you've conquered one of its words (always in inspect mode).
  const visibleKey = [
    ...data.nodes.filter((n) => inspect || data.states.get(n.id) !== 'locked').map((n) => n.id),
    ...hubs
      .filter((h) => inspect || h.words.some((w) => data.states.get(w) === 'conquered'))
      .map((h) => h.id),
  ].join(',');

  const graphData = useMemo(() => {
    const visible = new Set(visibleKey.split(',').filter(Boolean));
    const node = (id: string, word: WordNode, hub?: RootHub) => {
      let n = nodeCache.current.get(id);
      if (!n) {
        n = { id, word };
        nodeCache.current.set(id, n);
      }
      n.word = word;
      n.hub = hub;
      return n;
    };
    const hubNodes = hubs
      .filter((h) => visible.has(h.id))
      .map((h) =>
        node(h.id, { id: h.id, it: h.root, en: h.meaning ?? '', pos: null, theme: null }, h),
      );
    const nodes = [
      ...data.nodes.filter((n) => visible.has(n.id)).map((w) => node(w.id, w)),
      ...hubNodes,
    ];
    const links: GLink[] = data.edges
      .filter((e) => visible.has(e.source) && visible.has(e.target))
      .filter((e) => !(hubs.length && e.reason === 'etymological')) // the hub replaces these
      .map((e) => ({ ...e }));
    for (const n of hubNodes) {
      for (const w of n.hub!.words.filter((w) => visible.has(w))) {
        links.push({
          source: n.id,
          target: w,
          weight: 0.4,
          reason: 'etymological',
          descends: true,
        });
      }
    }
    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, data.edges, hubs]);

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

  const endId = (x: unknown) => (typeof x === 'object' && x ? (x as N).id : (x as string));
  const isHub = (id: string) => id.startsWith('root:');
  const hidden = (id: string) => !inspect && !isHub(id) && data.states.get(id) !== 'conquered';
  const touchesActive = (l: L) =>
    inspect && activeId !== undefined && [endId(l.source), endId(l.target)].includes(activeId);

  const drawNode = (node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const state = data.states.get(node.id);
    const shape: Shape = shapeOf(node.word.pos);
    const r = 6;
    ctx.save();
    if (node.hub) {
      drawHub(ctx, node, x, y, scale, node.id === activeId);
      ctx.restore();
      return;
    }
    if (node.id === activeId) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const label = (alpha: number) => {
      const fontSize = Math.max(3, 11 / scale);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
      ctx.fillText(node.word.it, x, y + r + 2.5);
    };

    if (state !== 'conquered') {
      shapePath(ctx, shape, x, y, r);
      ctx.fillStyle = state === 'locked' ? 'rgba(100, 116, 139, 0.7)' : 'rgba(71, 85, 105, 0.6)';
      ctx.fill();
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle =
        state === 'locked' ? 'rgba(100, 116, 139, 0.6)' : 'rgba(148, 163, 184, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (inspect) {
        label(state === 'locked' ? 0.6 : 0.8);
      } else {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x, y + (shape === 'triangle' ? 2 : 0.5));
      }
      ctx.restore();
      return;
    }

    const h = health.get(node.id) ?? 1;
    const band = healthBand(h);
    shapePath(ctx, shape, x, y, r);
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
    label(Math.max(0.35, h));
    ctx.restore();
  };

  const linkAlpha = (l: L) => {
    if (inspect) return activeId === undefined || touchesActive(l) ? 0.9 : 0.15;
    const [a, b] = [endId(l.source), endId(l.target)];
    if (hidden(a) || hidden(b)) return 0.3;
    return Math.max(0.15, edgeOpacity(health.get(a) ?? null, health.get(b) ?? null));
  };

  const linkTooltip = (l: L) => {
    const [a, b] = [endId(l.source), endId(l.target)];
    if (l.descends) {
      const hub = hubs.find((h) => h.id === a);
      const w = byId.get(b);
      const word = hidden(b) ? 'This unknown word' : `<b>${w?.it}</b>`;
      return `${word} descends from ${hub?.lang ?? ''} <i>${hub?.root}</i>${
        hub?.meaning ? ` “${hub.meaning}”` : ''
      }`;
    }
    const wa = byId.get(a);
    const wb = byId.get(b);
    const color = `rgb(${REASON_RGB[l.reason]})`;
    if (hidden(a) || hidden(b)) {
      return `<span style="color:${color}">● ${REASON_LABEL[l.reason]}</span>`;
    }
    const c = l.components;
    const tick = (v: number | undefined) => (v ? '✓' : '✗');
    const detail = c
      ? `<div style="opacity:.8;margin-top:2px">meaning ${Math.round(c.semantic * 100)}% · family ${tick(
          c.morphological,
        )} · root ${tick(c.etymological)} · theme ${tick(c.thematic)}</div>`
      : '';
    const weak = isWeakBridge(l)
      ? '<div style="opacity:.8">weak link: only here to connect two groups</div>'
      : '';
    return `<b>${wa?.it} ↔ ${wb?.it}</b><div style="color:${color}">● ${reasonText(l, wa, wb)}</div>
      <div>strength ${Math.round(l.weight * 100)}%</div>${detail}${weak}`;
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
          ctx.arc(node.x ?? 0, node.y ?? 0, 9, 0, 2 * Math.PI);
          ctx.fill();
        }}
        nodeLabel={(n) => {
          if (n.hub) {
            const known = n.hub.words.filter((w) => !hidden(w)).map((w) => byId.get(w)?.it);
            const unknown = n.hub.words.length - known.length;
            return `${n.hub.lang ?? ''} ${n.hub.root}${n.hub.meaning ? ` “${n.hub.meaning}”` : ''} → ${[
              ...known,
              ...(unknown ? [`${unknown} unknown`] : []),
            ].join(', ')}`;
          }
          const state = data.states.get(n.id);
          if (!inspect && state === 'frontier') {
            return `Unknown ${n.word.pos ?? 'word'}: click to conquer`;
          }
          const h = health.get(n.id);
          const pct = h != null ? ` · health ${Math.round(h * 100)}%` : '';
          const hint = inspect ? `${state} · tier ${n.word.tier ?? 1}` : 'click to practise';
          return `${n.word.it} = ${n.word.en}${pct} · ${hint}`;
        }}
        linkColor={(l) => `rgba(${REASON_RGB[l.reason]}, ${linkAlpha(l)})`}
        linkWidth={(l) => 0.5 + l.weight * 2.5 + (touchesActive(l) ? 1 : 0)}
        linkLineDash={(l) =>
          isWeakBridge(l) || (l.descends && hidden(endId(l.target))) ? [3, 3] : null
        }
        linkHoverPrecision={6}
        linkLabel={linkTooltip}
        onNodeClick={(n) => onNodeClick(n.id)}
        maxZoom={4}
        cooldownTicks={200}
        onEngineStop={() => fg.current?.zoomToFit(400, 60)}
      />
      <Legend />
    </div>
  );
}

function Legend() {
  const dot = (color: string) => (
    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
  );
  const line = (rgb: string, dashed = false) => (
    <span
      className="inline-block w-4"
      style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} rgb(${rgb})` }}
    />
  );
  const item = 'flex items-center gap-1';
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5 rounded bg-slate-900/85 px-3 py-2 text-xs text-slate-300">
      <div className="flex gap-3">
        <span className={item}>{dot(BAND_COLOR.solid)}&gt; 90%</span>
        <span className={item}>{dot(BAND_COLOR.faded)}70–90%</span>
        <span className={item}>{dot(BAND_COLOR.dashed)}50–70%</span>
        <span className={item}>{dot(BAND_COLOR.cracked)}&lt; 50%</span>
        <span className={item}>{dot('rgba(71, 85, 105, 0.9)')}? frontier</span>
      </div>
      <div className="flex gap-3">
        <span>● noun</span>
        <span>▲ verb</span>
        <span>◆ adjective</span>
        <span>■ adverb</span>
        <span className="text-pink-300">⬢ shared root</span>
      </div>
      <div className="flex gap-3">
        {(['semantic', 'thematic', 'morphological', 'etymological'] as const).map((r) => (
          <span key={r} className={item}>
            {line(REASON_RGB[r])}
            {REASON_LABEL[r]}
          </span>
        ))}
        <span className={item}>
          {line('148, 163, 184', true)}
          weak bridge
        </span>
      </div>
      <div className="text-slate-500">
        WASD / arrows move · +/− zoom · F fit · Esc leaves the answer box
      </div>
    </div>
  );
}

function drawHub(
  ctx: CanvasRenderingContext2D,
  node: N,
  x: number,
  y: number,
  scale: number,
  active: boolean,
) {
  const r = 7;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(244, 114, 182, 0.25)';
  ctx.fill();
  ctx.strokeStyle = active ? '#f8fafc' : 'rgba(244, 114, 182, 0.9)';
  ctx.lineWidth = active ? 1.5 : 1;
  ctx.stroke();
  const fontSize = Math.max(3, 11 / scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `italic ${fontSize}px serif`;
  ctx.fillStyle = 'rgba(251, 207, 232, 0.95)';
  ctx.fillText(node.word.it, x, y + r + 2);
  if (node.word.en) {
    ctx.font = `${fontSize * 0.8}px sans-serif`;
    ctx.fillStyle = 'rgba(251, 207, 232, 0.6)';
    ctx.fillText(`“${node.word.en}”`, x, y + r + 3 + fontSize);
  }
}
