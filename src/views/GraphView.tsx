import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { COOLDOWN_MS, INFLUENCE } from '../config';
import { fadedName, FULL_NAME } from '../core/fade';
import { edgeOpacity, healthBand } from '../core/health';
import { MAX_STRENGTH } from '../core/strength';
import { TENSES } from '../core/verbs';
import type { AppData, Edge, RootHub, WordNode } from '../db/repo';
import { stepCursor, useKeyboardCamera } from './useKeyboardCamera';
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
/**
 * `descends`: link from a root hub to one of its words. `category`: invisible
 * spring pulling discovered words of the same category together. `flow`:
 * influence travelling source -> target (drawn as moving particles).
 */
type GLink = Edge & { descends?: boolean; category?: boolean; flow?: 'attack' | 'support' };
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
  /** Strength level 0-5 per word; stronger words are drawn bigger. */
  strength: Map<string, number>;
  /** Verb level (tenses mastered) per conjugable verb; drawn as gold rings. */
  verbLevels: Map<string, number>;
  /** Root hubs unlocked by naming their meaning. */
  unlockedRoots: Set<string>;
  /** Word id -> real time (ms) its wrong-answer lock ends. */
  cooldowns: Map<string, number>;
  /** Influence game: control (0..1) of conquered words. */
  control: Map<string, number>;
  /** Hostile frontier words and rebelling conquered words. */
  hostile: Set<string>;
  /** Frontier word -> app time (ms) its grace period ends and it turns hostile. */
  graceUntil: Map<string, number>;
  /** Current app time (ms). */
  nowMs: number;
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
  strength,
  verbLevels,
  unlockedRoots,
  cooldowns,
  control,
  hostile,
  graceUntil,
  nowMs,
  inspect,
  showRoots,
  onNodeClick,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<N, L>>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });
  /** Keyboard cursor: arrows move it along links, Enter/Space opens it. */
  const [cursorId, setCursorId] = useState<string | undefined>(activeId ?? data.graph.seed);
  useEffect(() => {
    if (activeId) setCursorId(activeId);
  }, [activeId]);
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

  // Influence flows per link ("a|b" sorted): who attacks or supports whom.
  const flowKey = useMemo(() => {
    const out: string[] = [];
    for (const e of data.edges) {
      const [a, b] = [e.source, e.target];
      const [sa, sb] = [data.states.get(a), data.states.get(b)];
      if (hostile.has(a) && sb === 'conquered' && !hostile.has(b)) out.push(`${a}>${b}:attack`);
      else if (hostile.has(b) && sa === 'conquered' && !hostile.has(a))
        out.push(`${b}>${a}:attack`);
      else if (sa === 'conquered' && sb === 'conquered' && !hostile.has(a) && !hostile.has(b)) {
        const [ca, cb] = [control.get(a) ?? 1, control.get(b) ?? 1];
        if (ca < 0.99 || cb < 0.99) out.push(ca < cb ? `${b}>${a}:support` : `${a}>${b}:support`);
      }
    }
    return out.join(',');
  }, [data.edges, data.states, hostile, control]);

  const graphData = useMemo(() => {
    const visible = new Set(visibleKey.split(',').filter(Boolean));
    const flows = new Map(
      flowKey
        .split(',')
        .filter(Boolean)
        .map((f) => {
          const [pair, kind] = f.split(':');
          const [from, to] = pair.split('>');
          return [[from, to].sort().join('|'), { from, to, kind: kind as 'attack' | 'support' }];
        }),
    );
    const linkedTo = (id: string) =>
      data.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : []));
    const node = (id: string, word: WordNode, hub?: RootHub) => {
      let n = nodeCache.current.get(id);
      if (!n) {
        n = { id, word };
        // Organic layout: a newly revealed word appears next to a visible word it
        // links to (usually the one that revealed it), then settles by physics.
        const anchors = hub ? hub.words : linkedTo(id);
        const anchor = anchors.map((a) => nodeCache.current.get(a)).find((a) => a?.x !== undefined);
        if (anchor) {
          n.x = anchor.x! + (Math.random() - 0.5) * 40;
          n.y = anchor.y! + (Math.random() - 0.5) * 40;
        }
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
      .map((e) => {
        const f = flows.get([e.source, e.target].sort().join('|'));
        // Particles run source -> target, so orient the link along the flow.
        return f ? { ...e, source: f.from, target: f.to, flow: f.kind } : { ...e };
      });
    // Discovered words of the same category attract each other (invisible
    // springs): categories gather into territories as you explore them.
    for (const r of data.graph.regions ?? []) {
      const members = r.words.filter((w) => visible.has(w));
      members.forEach((w, i) => {
        for (const j of [i - 1, i - 3]) {
          if (j >= 0) {
            links.push({
              source: members[j],
              target: w,
              weight: 0.2,
              reason: 'thematic',
              category: true,
            });
          }
        }
      });
    }
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
  }, [visibleKey, data.edges, hubs, flowKey]);

  useKeyboardCamera(fg, {
    onArrow: (dx, dy) => {
      const pos = (id: string) => nodeCache.current.get(id);
      const visible = graphData.nodes.filter((n) => n.x !== undefined);
      const from = (cursorId && pos(cursorId)) || visible[0];
      if (!from) return;
      if (!cursorId || !pos(cursorId)) return setCursorId(from.id);
      const linked = new Set(
        graphData.links
          .filter((l) => !l.category)
          .flatMap((l) => {
            const [a, b] = [endId(l.source), endId(l.target)];
            return a === from.id ? [b] : b === from.id ? [a] : [];
          }),
      );
      const pts = visible.map((n) => ({ id: n.id, x: n.x!, y: n.y! }));
      const next = stepCursor(
        { x: from.x!, y: from.y! },
        dx,
        dy,
        pts.filter((p) => linked.has(p.id)),
        pts.filter((p) => p.id !== from.id),
      );
      if (!next) return;
      setCursorId(next);
      const n = pos(next)!;
      fg.current?.centerAt(n.x, n.y, 250);
      onNodeClick(next); // moving the cursor selects the word, like a click
    },
    onSelect: () => cursorId && onNodeClick(cursorId),
  });

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
    // Strong links pull words close; category springs are longer and softer.
    fg.current
      ?.d3Force('link')
      ?.distance((l: L) => (l.category ? 55 : 25 + (1 - l.weight) * 60))
      .strength((l: L) => (l.category ? 0.08 : 0.15 + l.weight * 0.6));
    fg.current?.d3Force('charge')?.strength(-90);
  }, []);

  // Territories: every visible word of a region, named once you've conquered one of them.
  // Points are read from the live node objects at draw time, so dragged words take
  // their territory with them.
  const regionsToDraw = (data.graph.regions ?? []).flatMap((r) => {
    const ids = r.words.filter((w) => inspect || (data.states.get(w) ?? 'locked') !== 'locked');
    if (!ids.length) return [];
    const named = inspect || r.words.some((w) => data.states.get(w) === 'conquered');
    return [{ name: named ? r.name : '', color: REGION_RGB[r.color % REGION_RGB.length], ids }];
  });
  const livePoints = () =>
    regionsToDraw.map((t) => ({
      ...t,
      pts: t.ids
        .map((id) => nodeCache.current.get(id))
        .filter((n): n is N => n?.x !== undefined && n?.y !== undefined)
        .map((n) => [n.x!, n.y!] as const),
    }));
  const fitted = useRef(false);

  const endId = (x: unknown) => (typeof x === 'object' && x ? (x as N).id : (x as string));
  const isHub = (id: string) => id.startsWith('root:');
  /** A word's name as the player may see it: fading words lose letters (see core/fade). */
  const shownName = (id: string) => {
    const word = byId.get(id)?.it ?? '';
    if (inspect) return word;
    if (data.states.get(id) !== 'conquered') return '';
    return fadedName(word, health.get(id) ?? null);
  };
  const hidden = (id: string) => !inspect && !isHub(id) && data.states.get(id) !== 'conquered';
  const touchesActive = (l: L) =>
    inspect && activeId !== undefined && [endId(l.source), endId(l.target)].includes(activeId);

  const drawNode = (node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const state = data.states.get(node.id);
    const shape: Shape = shapeOf(node.word.pos);
    const r = state === 'conquered' ? 5 + (strength.get(node.id) ?? 0) * 0.8 : 6;
    ctx.save();
    const lockedUntil = cooldowns.get(node.id);
    if (lockedUntil && lockedUntil > Date.now()) {
      // Countdown ring for the wrong-answer lock.
      const left = (lockedUntil - Date.now()) / COOLDOWN_MS;
      ctx.beginPath();
      ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + left * 2 * Math.PI);
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (node.id === cursorId && node.id !== activeId) {
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, 2 * Math.PI);
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (node.hub) {
      drawHub(ctx, node, x, y, scale, node.id === activeId, inspect || unlockedRoots.has(node.id));
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
    const label = (alpha: number, text = node.word.it) => {
      // Zoomed far out, word labels give way to region names.
      const fade = node.id === activeId ? 1 : Math.min(1, Math.max(0, (scale - 0.35) / 0.35));
      if (fade === 0) return;
      alpha *= fade;
      const fontSize = Math.max(3, 11 / scale);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
      ctx.fillText(text, x, y + r + 2.5);
    };

    if (state !== 'conquered') {
      const angry = hostile.has(node.id);
      shapePath(ctx, shape, x, y, r);
      ctx.fillStyle =
        state === 'locked'
          ? 'rgba(100, 116, 139, 0.7)'
          : angry
            ? 'rgba(185, 28, 28, 0.6)' // hostile: attacking its conquered neighbours
            : 'rgba(71, 85, 105, 0.6)';
      ctx.fill();
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle =
        state === 'locked'
          ? 'rgba(100, 116, 139, 0.6)'
          : angry
            ? 'rgba(252, 165, 165, 0.95)'
            : 'rgba(148, 163, 184, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const grace = graceUntil.get(node.id);
      if (state === 'frontier' && !angry && grace && !inspect) {
        // Grace period left before this word turns hostile.
        const left = Math.max(0, (grace - nowMs) / (INFLUENCE.hostileAfterHours * 3_600_000));
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, -Math.PI / 2, -Math.PI / 2 + left * 2 * Math.PI);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
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
    if (hostile.has(node.id)) {
      // Rebelling: control collapsed, now pressuring its own neighbours.
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // One gold ring per tense mastered: verbs are the strongholds of a territory.
    const vl = verbLevels.get(node.id) ?? 0;
    for (let i = 0; i < vl; i++) {
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5 + i * 1.8, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.9 - i * 0.1})`;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
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
    const name = shownName(node.id);
    if (name) {
      label(Math.max(0.35, h), name);
    } else {
      // Faded out completely: the word must be recalled to see it again.
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y + (shape === 'triangle' ? 2 : 0.5));
    }
    ctx.restore();
  };

  const regionOf = (id: string) => byId.get(id)?.region;
  const crossRegion = (l: L) => {
    const [a, b] = [regionOf(endId(l.source)), regionOf(endId(l.target))];
    return a !== undefined && b !== undefined && a !== b;
  };
  const linkAlpha = (l: L) => {
    if (touchesActive(l)) return 0.95;
    // Links between territories are long; keep them in the background.
    const dim = crossRegion(l) || l.descends ? (inspect ? 0.12 : 0.35) : 1;
    if (inspect) return (activeId === undefined ? 0.8 : 0.15) * dim;
    const [a, b] = [endId(l.source), endId(l.target)];
    if (hidden(a) || hidden(b)) return 0.3 * dim;
    return Math.max(0.15, edgeOpacity(health.get(a) ?? null, health.get(b) ?? null)) * dim;
  };

  const linkTooltip = (l: L) => {
    const [a, b] = [endId(l.source), endId(l.target)];
    if (l.descends) {
      const hub = hubs.find((h) => h.id === a);
      const word = hidden(b) || !shownName(b) ? 'This unknown word' : `<b>${shownName(b)}</b>`;
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
    return `<b>${shownName(a) || '?'} ↔ ${shownName(b) || '?'}</b><div style="color:${color}">● ${reasonText(l, wa, wb)}</div>
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
          if (n.hub && !inspect && !unlockedRoots.has(n.id)) {
            return `${n.hub.lang ?? ''} root ${n.hub.root}: click to unlock it and reveal its words`;
          }
          if (n.hub) {
            const known = n.hub.words.filter((w) => !hidden(w) && shownName(w)).map(shownName);
            const unknown = n.hub.words.length - known.length;
            return `${n.hub.lang ?? ''} ${n.hub.root}${n.hub.meaning ? ` “${n.hub.meaning}”` : ''} → ${[
              ...known,
              ...(unknown ? [`${unknown} unknown`] : []),
            ].join(', ')}${n.hub.english?.length ? ` · English: ${n.hub.english.join(', ')}` : ''}`;
          }
          const state = data.states.get(n.id);
          const until = cooldowns.get(n.id);
          if (until && until > Date.now()) {
            return `${hidden(n.id) ? 'Unknown word' : n.word.it} · locked ${Math.ceil((until - Date.now()) / 1000)} s`;
          }
          if (!inspect && state === 'frontier') {
            return `Unknown ${n.word.pos ?? 'word'}: click to conquer`;
          }
          const h = health.get(n.id);
          const pct = h != null ? ` · health ${Math.round(h * 100)}%` : '';
          if (!inspect && state === 'conquered' && h != null && h < FULL_NAME) {
            return `Fading: ${shownName(n.id) || '?'}${pct} · click to defend`;
          }
          const lvl = strength.get(n.id) ?? 0;
          const str =
            state === 'conquered'
              ? ` · strength ${'★'.repeat(lvl)}${'☆'.repeat(MAX_STRENGTH - lvl)}`
              : '';
          const hint = inspect ? `${state} · tier ${n.word.tier ?? 1}` : 'click to practise';

          const vl = verbLevels.get(n.id);
          const verb =
            vl === undefined
              ? ''
              : ` · verb level ${vl}/${TENSES.length}${vl < TENSES.length ? ` (next: ${TENSES[vl]})` : ''}`;
          return `${n.word.it} = ${n.word.en}${pct}${str}${verb} · ${hint}`;
        }}
        linkColor={(l) => `rgba(${REASON_RGB[l.reason]}, ${linkAlpha(l)})`}
        // Strong links are much thicker (and carry more influence).
        linkWidth={(l) => 0.3 + 5 * l.weight ** 2 + (touchesActive(l) ? 1 : 0)}
        linkLineDash={(l) =>
          isWeakBridge(l) || (l.descends && hidden(endId(l.target))) ? [3, 3] : null
        }
        linkHoverPrecision={6}
        linkVisibility={(l) => !l.category}
        // Keep animating while influence flows (particles); otherwise let the canvas idle.
        autoPauseRedraw={!flowKey}
        linkDirectionalParticles={(l) => (l.flow ? Math.max(1, Math.round(l.weight * 4)) : 0)}
        linkDirectionalParticleSpeed={(l) =>
          l.flow === 'attack' ? 0.004 + 0.01 * l.weight : 0.003 + 0.003 * l.weight
        }
        linkDirectionalParticleWidth={(l) => (l.flow === 'attack' ? 3 : 2)}
        linkDirectionalParticleColor={(l) =>
          l.flow === 'attack' ? 'rgba(248, 113, 113, 0.95)' : 'rgba(110, 231, 183, 0.9)'
        }
        onRenderFramePre={(ctx, scale) => drawRegions(ctx, scale, livePoints())}
        linkLabel={linkTooltip}
        onNodeClick={(n) => {
          setCursorId(n.id);
          onNodeClick(n.id);
        }}
        maxZoom={4}
        minZoom={0.15}
        onNodeDragEnd={(n) => {
          // Keep a dragged word where it was dropped (the map stays pinned).
          n.fx = n.x;
          n.fy = n.y;
        }}
        cooldownTicks={200}
        onEngineStop={() => {
          // Fit once on load; afterwards the camera is yours (F refits).
          if (fitted.current) return;
          fitted.current = true;
          fg.current?.zoomToFit(400, 60);
        }}
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
        <span className="text-amber-300">◎ verb level</span>
      </div>
      <div className="flex gap-3">
        <span className="text-red-300">• → red: attack</span>
        <span className="text-emerald-300">• → green: support</span>
        <span className="text-red-300">? red: hostile</span>
        <span className="text-amber-300">◔ time until hostile</span>
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
        ↑↓←→ move between words · Enter opens · WASD pan · +/− zoom · F fit (Esc leaves the answer
        box)
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
  unlocked: boolean,
) {
  const r = 7;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = unlocked ? 'rgba(244, 114, 182, 0.45)' : 'rgba(244, 114, 182, 0.1)';
  ctx.fill();
  if (!unlocked) ctx.setLineDash([2, 1.5]); // sealed: name its meaning to unlock
  ctx.strokeStyle = active ? '#f8fafc' : 'rgba(244, 114, 182, 0.9)';
  ctx.lineWidth = active ? 1.5 : 1;
  ctx.stroke();
  ctx.setLineDash([]);
  const fontSize = Math.max(3, 11 / scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `italic ${fontSize}px serif`;
  ctx.fillStyle = 'rgba(251, 207, 232, 0.95)';
  ctx.fillText(unlocked ? node.word.it : `${node.word.it} ?`, x, y + r + 2);
  if (!unlocked) return;
  ctx.font = `${fontSize * 0.8}px sans-serif`;
  ctx.fillStyle = 'rgba(251, 207, 232, 0.6)';
  if (node.word.en) ctx.fillText(`“${node.word.en}”`, x, y + r + 3 + fontSize);
  const english = node.hub?.english ?? [];
  if (english.length) {
    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.fillText(`≈ ${english.slice(0, 3).join(' · ')}`, x, y + r + 4 + fontSize * 1.8);
  }
}

/** Muted territory colours (RGB); neighbouring regions never share one. */
const REGION_RGB = [
  '96, 165, 250',
  '52, 211, 153',
  '251, 191, 36',
  '244, 114, 182',
  '167, 139, 250',
  '45, 212, 191',
  '251, 146, 60',
  '248, 113, 113',
];
const TERRITORY_RADIUS = 30; // map units around each word

type Territory = { name: string; color: string; pts: (readonly [number, number])[] };

/** Territories as unions of soft discs with a border; names scale with zoom. */
function drawRegions(ctx: CanvasRenderingContext2D, scale: number, regions: Territory[]) {
  const union = (r: number, pts: Territory['pts']) => {
    ctx.beginPath();
    for (const [x, y] of pts) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, 2 * Math.PI);
    }
  };
  const border = 1.5 / scale;
  ctx.save();
  for (const t of regions) {
    if (!t.pts.length) continue;
    union(TERRITORY_RADIUS + border, t.pts);
    ctx.fillStyle = `rgba(${t.color}, 0.45)`;
    ctx.fill();
    union(TERRITORY_RADIUS, t.pts);
    ctx.fillStyle = '#020617';
    ctx.fill();
    ctx.fillStyle = `rgba(${t.color}, 0.09)`;
    ctx.fill();
  }
  // Region names: big and bold zoomed out, faint when zoomed in on words.
  const alpha = Math.min(0.85, Math.max(0.12, 1.1 - 0.45 * scale));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of regions) {
    if (!t.name || !t.pts.length) continue;
    const cx = t.pts.reduce((a, p) => a + p[0], 0) / t.pts.length;
    const cy = t.pts.reduce((a, p) => a + p[1], 0) / t.pts.length;
    const px = Math.min(24, Math.max(12, 8 + 2.5 * Math.sqrt(t.pts.length))); // screen pixels
    ctx.font = `800 ${px / scale}px sans-serif`;
    ctx.fillStyle = `rgba(${t.color}, ${alpha})`;
    ctx.fillText(t.name.toUpperCase(), cx, cy);
  }
  ctx.restore();
}
