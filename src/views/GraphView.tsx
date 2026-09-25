import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { COOLDOWN_MS, DANGER_MS, INFLUENCE, REACH } from '../config';
import { appNow } from '../core/clock';
import { fadedName, FULL_NAME } from '../core/fade';
import { edgeOpacity, healthBand } from '../core/health';
import { MAX_STRENGTH } from '../core/strength';
import { TENSES } from '../core/verbs';
import { CLAIM_STEPS, claimSteps, type Claim } from '../core/claim';
import { ATTENTION_ORDER, type Attention, type AttentionKind } from '../core/attention';
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

/** Ripple colours (RGB) for words that need attention. */
const ATTENTION_RGB: Record<AttentionKind, string> = {
  danger: '244, 63, 94', // rose: a claim about to fall, or the missed word to win back
  ready: '52, 211, 153', // emerald: a claim step is open
  threat: '248, 113, 113', // red: hostile, rebelling or fading
  new: '125, 211, 252', // light sky: just revealed
};
const ATTENTION_LABEL: Record<AttentionKind, string> = {
  danger: 'in danger',
  ready: 'ready',
  threat: 'under threat',
  new: 'new',
};

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
  /** Claim progress of claimed words. */
  claims: Map<string, Claim | undefined>;
  /** Claimed words waiting for their next step: when it opens and the whole wait (app ms). */
  claimWaits: Map<string, { opensAt: number; total: number }>;
  /** Hidden words in sight (reach below what conquering needs): drawn as ghosts. */
  sighted: Map<string, number>;
  /** Claims endangered by a miss: deadline (app ms) and the missed word (core/danger.ts). */
  danger: Map<string, { until: number; from: string }>;
  /** Push of every won word (core/reach.ts pushOf), for the push flows. */
  pushes: Map<string, number>;
  /** Who pushes the selected word and how much: ringed on the map. */
  pushSources?: Map<string, number>;
  /** Words that need attention, most urgent first: ripples, edge arrows, jump bar. */
  attention: Attention[];
  /** Word whose Italian name is the answer being asked: its name is hidden. */
  answerId?: string;
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
  claims,
  claimWaits,
  sighted,
  danger,
  pushes,
  pushSources,
  attention,
  answerId,
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
  const attentionOf = useMemo(
    () => new Map(inspect ? [] : attention.map((a) => [a.id, a.kind])),
    [attention, inspect],
  );
  /** Off-screen arrows drawn last frame (CSS pixels), for clicks. */
  const pointers = useRef<{ id: string; x: number; y: number }[]>([]);
  /** Link weights sorted, to draw widths by rank (raw weights bunch up in 0.25-0.6). */
  const sortedWeights = useMemo(
    () => data.edges.map((e) => e.weight).sort((a, b) => a - b),
    [data.edges],
  );
  const weightRank = (w: number) => {
    let lo = 0;
    let hi = sortedWeights.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedWeights[mid] < w) lo = mid + 1;
      else hi = mid;
    }
    return sortedWeights.length ? lo / sortedWeights.length : w;
  };

  // Bursts: a flash on the map when a claim step, a conquest or a verb level lands.
  const bursts = useRef(new Map<string, { at: number; kind: BurstKind }>());
  const progressKey = useRef<Map<string, string> | null>(null);
  const [bursting, setBursting] = useState(false);
  useEffect(() => {
    const next = new Map<string, string>();
    for (const [id, st] of data.states) {
      if (st === 'claimed' || st === 'conquered') {
        next.set(id, `${st}:${claimSteps(claims.get(id))}:${verbLevels.get(id) ?? 0}`);
      }
    }
    const prev = progressKey.current;
    progressKey.current = next;
    if (!prev) return;
    let any = false;
    for (const [id, key] of next) {
      const old = prev.get(id);
      if (old === key) continue;
      const [st, steps, vl] = key.split(':');
      const [ost, osteps, ovl] = (old ?? 'frontier:0:0').split(':');
      const kind: BurstKind | null =
        Number(vl) > Number(ovl)
          ? 'verb'
          : st === 'conquered' && ost !== 'conquered'
            ? 'conquer'
            : Number(steps) > Number(osteps) || (st === 'claimed' && ost !== 'claimed')
              ? 'step'
              : null;
      if (kind) {
        bursts.current.set(id, { at: Date.now(), kind });
        any = true;
      }
    }
    if (!any) return;
    setBursting(true);
    const t = setTimeout(() => setBursting(false), BURST_MS.verb + 200);
    return () => clearTimeout(t);
  }, [data.states, claims, verbLevels]);

  /** Per kind, the index of the word the jump bar showed last. */
  const jumpIndex = useRef<Partial<Record<AttentionKind, number>>>({});

  // Keep node objects stable across renders so the layout doesn't restart.
  const nodeCache = useRef(new Map<string, N>());
  const hubs = useMemo(() => (showRoots ? (data.graph.roots ?? []) : []), [showRoots, data.graph]);
  // A root appears once you've conquered one of its words (always in inspect mode).
  const visibleKey = [
    ...data.nodes
      .filter((n) => inspect || data.states.get(n.id) !== 'locked' || sighted.has(n.id))
      .map((n) => n.id),
    ...hubs
      .filter((h) => inspect || h.words.some((w) => data.states.get(w) === 'conquered'))
      .map((h) => h.id),
  ].join(',');

  // Cohesion: summed strength of links to other conquered words (glow size).
  const cohesionOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.edges) {
      if (data.states.get(e.source) === 'conquered' && data.states.get(e.target) === 'conquered') {
        m.set(e.source, (m.get(e.source) ?? 0) + e.weight);
        m.set(e.target, (m.get(e.target) ?? 0) + e.weight);
      }
    }
    return m;
  }, [data.edges, data.states]);

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
  // Something moves on screen: keep redrawing (energy bands, arrows, breathing glow).
  const animate =
    !inspect &&
    (cohesionOf.size > 0 ||
      flowKey !== '' ||
      attentionOf.size > 0 ||
      claimWaits.size > 0 ||
      sighted.size > 0 ||
      danger.size > 0 ||
      bursting);

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

  /** Centre the camera on a word (zooming in if far out) and open it, like a click. */
  const jumpTo = (id: string) => {
    const n = nodeCache.current.get(id);
    if (n?.x === undefined) return;
    fg.current?.centerAt(n.x, n.y, 400);
    if ((fg.current?.zoom() ?? 1) < 1.2) fg.current?.zoom(1.6, 400);
    setCursorId(id);
    onNodeClick(id);
  };
  /** Next word of `kind` (or of any kind, most urgent first) that needs attention. */
  const jumpNext = (kind?: AttentionKind) => {
    const k = kind ?? (attentionOf.size ? attention[0]?.kind : undefined); // sorted by urgency
    if (!k) return;
    const ids = attention.filter((a) => a.kind === k).map((a) => a.id);
    const i = ((jumpIndex.current[k] ?? -1) + 1) % ids.length;
    jumpIndex.current[k] = i;
    jumpTo(ids[i]);
  };

  // A card for a word off-screen (e.g. from the automatic queue): bring it into view.
  useEffect(() => {
    const n = activeId ? nodeCache.current.get(activeId) : undefined;
    const c = fg.current;
    if (!c || n?.x === undefined || n.y === undefined) return;
    const p = c.graph2ScreenCoords(n.x, n.y);
    const m = 40;
    if (p.x < m || p.y < m || p.x > size.width - m || p.y > size.height - m) {
      c.centerAt(n.x, n.y, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useKeyboardCamera(fg, {
    onNext: () => jumpNext(),
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
        .map((n) => [n.x!, n.y!, territoryRadius(n.id)] as const),
    }));
  const fitted = useRef(false);
  /** A word's pull on its territory: practised words claim more ground. */
  const territoryRadius = (id: string) => {
    const st = data.states.get(id);
    if (st === 'conquered') {
      return 32 + 6 * (strength.get(id) ?? 0) + 4 * (verbLevels.get(id) ?? 0);
    }
    // Every claim step pushes the border out a little.
    if (st === 'claimed') return 18 + 5 * claimSteps(claims.get(id));
    return st === 'frontier' ? 16 : 12;
  };

  const endId = (x: unknown) => (typeof x === 'object' && x ? (x as N).id : (x as string));
  const isHub = (id: string) => id.startsWith('root:');
  /** A word's name as the player may see it: fading words lose letters (see core/fade). */
  const shownName = (id: string) => {
    const word = byId.get(id)?.it ?? '';
    if (inspect) return word;
    // A name is earned by conquering the word, and hidden while it is the answer.
    if (data.states.get(id) !== 'conquered' || id === answerId) return '';
    return fadedName(word, health.get(id) ?? null);
  };
  const won = (id: string) => ['conquered', 'claimed'].includes(data.states.get(id) ?? '');
  const hidden = (id: string) => !inspect && !isHub(id) && !won(id);
  const touchesActive = (l: L) =>
    inspect && activeId !== undefined && [endId(l.source), endId(l.target)].includes(activeId);

  const drawNode = (node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const state = data.states.get(node.id);
    const shape: Shape = shapeOf(node.word.pos);
    const vl = verbLevels.get(node.id) ?? 0;
    // Stronger words are bigger; every tense a verb masters makes it bigger still.
    const r = state === 'conquered' ? 5 + (strength.get(node.id) ?? 0) * 0.8 + vl * 0.9 : 6;
    ctx.save();
    const burst = bursts.current.get(node.id);
    if (burst && !inspect) {
      const p = (Date.now() - burst.at) / BURST_MS[burst.kind];
      if (p < 1) drawBurst(ctx, x, y, r, scale, burst.kind, p);
      else bursts.current.delete(node.id);
    }
    const src = pushSources?.get(node.id);
    if (src !== undefined && !inspect) {
      // This word pushes the selected one: ring it and say by how much.
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, 2 * Math.PI);
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `bold ${Math.max(3, 10 / scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(125, 211, 252, 0.95)';
      ctx.fillText(`+${Math.round(src * 100)}%`, x, y - r - 7);
    }
    const attn = attentionOf.get(node.id);
    if (attn) drawRipple(ctx, x, y, r, scale, ATTENTION_RGB[attn]);
    const appMs = appNow(data.offsetDays).getTime();
    const lockedUntil = cooldowns.get(node.id);
    if (lockedUntil && lockedUntil > appMs) {
      // Countdown ring for the wrong-answer lock (app time: time travel lifts it).
      const left = (lockedUntil - appMs) / COOLDOWN_MS;
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

    const reach = inspect ? undefined : sighted.get(node.id);
    if (reach !== undefined) {
      // Beyond the horizon: a faint ghost, its ring filling as your reach grows.
      shapePath(ctx, shape, x, y, r);
      ctx.fillStyle = 'rgba(71, 85, 105, 0.15)';
      ctx.fill();
      ctx.setLineDash([1, 2]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(
        x,
        y,
        r + 2.5,
        -Math.PI / 2,
        -Math.PI / 2 + Math.min(1, reach / REACH.open) * 2 * Math.PI,
      );
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (scale > 0.9) {
        ctx.font = `${Math.max(3, 9 / scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(125, 211, 252, 0.7)';
        ctx.fillText(`${Math.round((reach / REACH.open) * 100)}%`, x, y + r + 4);
      }
      ctx.restore();
      return;
    }
    if (state === 'claimed') {
      // Freshly won but fragile: pale, one ring segment per conquest step. The
      // name stays hidden ("?") until conquered, so producing it is real recall.
      const steps = claimSteps(claims.get(node.id));
      shapePath(ctx, shape, x, y, r);
      ctx.fillStyle = 'rgba(52, 211, 153, 0.3)';
      ctx.fill();
      ctx.setLineDash([1.5, 1.5]);
      ctx.strokeStyle = 'rgba(110, 231, 183, 0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const seg = (2 * Math.PI) / CLAIM_STEPS;
      for (let i = 0; i < CLAIM_STEPS; i++) {
        const a0 = -Math.PI / 2 + i * seg + 0.18;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, a0, a0 + seg - 0.36);
        ctx.strokeStyle = i < steps ? 'rgba(52, 211, 153, 0.95)' : 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      const d = danger.get(node.id);
      if (d && !inspect) {
        // In danger: a pulsing rose ring running down to the moment it falls.
        const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 180);
        ctx.beginPath();
        ctx.arc(x, y, r + 8, 0, 2 * Math.PI);
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = `rgba(244, 63, 94, ${0.5 * pulse})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        const left = Math.max(0, Math.min(1, (d.until - appMs) / DANGER_MS));
        ctx.beginPath();
        ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + left * 2 * Math.PI);
        ctx.strokeStyle = `rgba(244, 63, 94, ${0.7 + 0.3 * pulse})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = `bold ${Math.max(4, 11 / scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = `rgba(253, 164, 175, ${pulse})`;
        ctx.fillText('!', x + r + 8, y - r - 4);
      }
      const wait = claimWaits.get(node.id);
      if (wait) {
        // Time until the next step opens: a light ring that runs down.
        const left = Math.max(0, (wait.opensAt - appNow(data.offsetDays).getTime()) / wait.total);
        ctx.beginPath();
        ctx.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + left * 2 * Math.PI);
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y + (shape === 'triangle' ? 2 : 0.5));
      ctx.restore();
      return;
    }
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
    const coh = cohesionOf.get(node.id) ?? 0;
    if (coh > 0 && !inspect) {
      // Embedded words glow: bigger and brighter the more strongly they are
      // tied into conquered territory, breathing slowly.
      const breath = 0.85 + 0.15 * Math.sin(Date.now() / 900 + x * 0.01);
      const glow = r + 3 + Math.min(10, coh * 3);
      const g = ctx.createRadialGradient(x, y, r * 0.8, x, y, glow);
      const a = Math.min(0.45, 0.15 + coh * 0.12) * (control.get(node.id) ?? 1) * breath;
      g.addColorStop(0, `rgba(52, 211, 153, ${a})`);
      g.addColorStop(1, 'rgba(52, 211, 153, 0)');
      ctx.beginPath();
      ctx.arc(x, y, glow, 0, 2 * Math.PI);
      ctx.fillStyle = g;
      ctx.fill();
    }
    if (hostile.has(node.id)) {
      // Rebelling: control collapsed, now pressuring its own neighbours.
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // One gold ring per tense mastered: verbs are the strongholds of a territory.
    if (vl > 0 && !inspect) {
      const glow = ctx.createRadialGradient(x, y, r, x, y, r + 6 + vl * 2.5);
      glow.addColorStop(0, `rgba(251, 191, 36, ${0.15 + 0.05 * vl})`);
      glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.beginPath();
      ctx.arc(x, y, r + 6 + vl * 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = glow;
      ctx.fill();
    }
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
    if (vl > 0) {
      ctx.strokeStyle = vl >= TENSES.length ? '#fde047' : 'rgba(251, 191, 36, 0.95)';
      ctx.lineWidth = 1 + vl * 0.25;
      ctx.stroke();
    }
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
      const fontSize = Math.max(3, 11 / scale);
      let below = y + r + 2.5 + fontSize * 1.1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (vl > 0 && scale > 0.5) {
        // The verb's rank: stars and the tense it has reached.
        ctx.font = `bold ${fontSize * 0.8}px sans-serif`;
        ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
        ctx.fillText(`${'★'.repeat(vl)} ${TENSES[vl - 1]}`, x, below);
        below += fontSize;
      }
      if (node.word.root && scale > 1.3 && h >= FULL_NAME) {
        ctx.font = `italic ${fontSize * 0.8}px serif`;
        ctx.fillStyle = 'rgba(249, 168, 212, 0.75)';
        ctx.fillText(`‹ ${node.word.root}`, x, below);
      }
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
    if (sighted.has(a) || sighted.has(b)) return 0.12 * dim; // towards the horizon
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

  /** A link between two conquered words: carries a moving band of light. */
  const isEnergy = (l: L) =>
    !inspect &&
    !l.category &&
    !l.descends &&
    data.states.get(endId(l.source)) === 'conquered' &&
    data.states.get(endId(l.target)) === 'conquered';

  /** Push running from a won word into a ghost beyond the horizon: [from, to, push]. */
  const pushFlow = (l: L): [N, N, number] | null => {
    if (inspect || l.category || l.descends) return null;
    const a = l.source as N;
    const b = l.target as N;
    if (typeof a !== 'object' || typeof b !== 'object') return null;
    if (pushes.has(a.id) && sighted.has(b.id)) return [a, b, pushes.get(a.id)!];
    if (pushes.has(b.id) && sighted.has(a.id)) return [b, a, pushes.get(b.id)!];
    return null;
  };

  /** The missed word threatening an endangered claim along this link: [from, to]. */
  const dangerLink = (l: L): [N, N] | null => {
    if (inspect || l.category || l.descends) return null;
    const a = l.source as N;
    const b = l.target as N;
    if (typeof a !== 'object' || typeof b !== 'object') return null;
    if (danger.get(b.id)?.from === a.id) return [a, b];
    if (danger.get(a.id)?.from === b.id) return [b, a];
    return null;
  };

  const drawDanger = (ctx: CanvasRenderingContext2D, l: L) => {
    const f = dangerLink(l);
    if (!f) return;
    const [a, b] = f;
    if (a.x === undefined || b.x === undefined) return;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -Date.now() / 30; // runs towards the endangered claim
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(244, 63, 94, ${0.55 + 0.35 * Math.sin(Date.now() / 180)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y!);
    ctx.lineTo(b.x, b.y!);
    ctx.stroke();
    ctx.restore();
  };

  const drawPush = (ctx: CanvasRenderingContext2D, l: L) => {
    const f = pushFlow(l);
    if (!f) return;
    const [a, b, push] = f;
    if (a.x === undefined || b.x === undefined) return;
    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.lineDashOffset = -Date.now() / 45; // flows towards the ghost
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.35 + 0.35 * Math.min(1, push)})`;
    ctx.lineWidth = 0.8 + 1.6 * Math.min(1.5, push);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y!);
    ctx.lineTo(b.x, b.y!);
    ctx.stroke();
    ctx.restore();
  };

  const drawEnergy = (ctx: CanvasRenderingContext2D, l: L) => {
    const a = l.source as N;
    const b = l.target as N;
    if (a.x === undefined || b.x === undefined) return;
    const strength = Math.min(control.get(a.id) ?? 1, control.get(b.id) ?? 1);
    ctx.save();
    ctx.setLineDash([3, 9]);
    ctx.lineDashOffset = -Date.now() / 60; // flows along the link
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(167, 243, 208, ${0.25 + 0.55 * strength * l.weight})`;
    ctx.lineWidth = 0.6 + 3 * weightRank(l.weight) ** 2 * strength;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y!);
    ctx.lineTo(b.x, b.y!);
    ctx.stroke();
    ctx.restore();
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
          const nowApp = appNow(data.offsetDays).getTime();
          if (until && until > nowApp) {
            return `${hidden(n.id) ? 'Unknown word' : n.word.it} · locked ${Math.ceil((until - nowApp) / 1000)} s`;
          }
          const inSight = inspect ? undefined : sighted.get(n.id);
          if (inSight !== undefined) {
            return `Beyond your reach (${Math.round((inSight / REACH.open) * 100)}%): conquer words around it`;
          }
          if (!inspect && state === 'frontier') {
            return `Unknown ${n.word.pos ?? 'word'}: click to conquer`;
          }
          if (!inspect && state === 'claimed') {
            const steps = claimSteps(claims.get(n.id));
            return `Claimed ${steps}/${CLAIM_STEPS}: ${
              attentionOf.get(n.id) === 'ready' ? 'next step ready, click' : 'next step opens soon'
            }`;
          }
          if (!inspect && n.id === answerId) return 'The word you are recalling';
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
          const ety = n.word.root
            ? ` · from ${n.word.root_lang ?? ''} ${n.word.root}${n.word.cognate ? ` (cf. ${n.word.cognate})` : ''}`
            : '';
          return `${n.word.it} = ${n.word.en}${pct}${str}${verb}${ety} · ${hint}`;
        }}
        linkColor={(l) =>
          l.flow === 'attack'
            ? `rgba(248, 113, 113, ${0.35 + 0.3 * Math.sin(Date.now() / 250)})` // pulsing threat
            : `rgba(${REASON_RGB[l.reason]}, ${linkAlpha(l)})`
        }
        // Strong links are much thicker (and carry more influence).
        // By rank: the closest pairs (ghiaccio-gelato) stand out from mere same-theme ones.
        linkWidth={(l) => 0.3 + 5 * weightRank(l.weight) ** 2.5 + (touchesActive(l) ? 1 : 0)}
        linkLineDash={(l) =>
          isWeakBridge(l) || (l.descends && hidden(endId(l.target))) ? [3, 3] : null
        }
        linkHoverPrecision={6}
        linkVisibility={(l) => !l.category}
        // Keep animating while influence flows (particles); otherwise let the canvas idle.
        autoPauseRedraw={!animate}
        linkDirectionalParticles={(l) => (l.flow ? Math.max(1, Math.round(l.weight * 4)) : 0)}
        linkDirectionalParticleSpeed={(l) =>
          l.flow === 'attack' ? 0.004 + 0.01 * l.weight : 0.003 + 0.003 * l.weight
        }
        linkDirectionalParticleCanvasObject={(px, py, l, ctx) => drawChevron(ctx, px, py, l)}
        linkCanvasObjectMode={(l) =>
          isEnergy(l) || pushFlow(l) || dangerLink(l) ? 'after' : undefined
        }
        linkCanvasObject={(l, ctx) =>
          dangerLink(l) ? drawDanger(ctx, l) : isEnergy(l) ? drawEnergy(ctx, l) : drawPush(ctx, l)
        }
        onRenderFramePre={(ctx, scale) => drawRegions(ctx, scale, livePoints())}
        onRenderFramePost={(ctx) => {
          pointers.current = drawPointers(
            ctx,
            size.width,
            attention,
            attentionOf,
            nodeCache.current,
          );
        }}
        onBackgroundClick={(e) => {
          // Clicking an edge arrow jumps to the word it points at.
          const hit = pointers.current.find(
            (p) => Math.hypot(p.x - e.offsetX, p.y - e.offsetY) < 16,
          );
          if (hit) jumpTo(hit.id);
        }}
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
      {!inspect && attention.length > 0 && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded bg-slate-900/85 px-2 py-1.5 text-xs">
          {ATTENTION_ORDER.map((k) => {
            const n = attention.filter((a) => a.kind === k).length;
            if (!n) return null;
            return (
              <button
                key={k}
                onClick={() => jumpNext(k)}
                title={`Jump to the next ${ATTENTION_LABEL[k]} word`}
                className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-slate-800"
                style={{ color: `rgb(${ATTENTION_RGB[k]})` }}
              >
                <span
                  className="inline-block h-2 w-2 animate-pulse rounded-full"
                  style={{ background: `rgb(${ATTENTION_RGB[k]})` }}
                />
                {n} {ATTENTION_LABEL[k]}
              </button>
            );
          })}
          <span className="pl-1 text-slate-500">N: next</span>
        </div>
      )}
      <Legend />
    </div>
  );
}

/** Expanding rings (constant on screen) around a word that needs attention. */
function drawRipple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  scale: number,
  rgb: string,
) {
  const t = Date.now() / 1400;
  ctx.lineWidth = 2 / scale;
  for (const offset of [0, 0.5]) {
    const phase = (t + offset) % 1;
    ctx.beginPath();
    ctx.arc(x, y, r + 3 + (phase * 18) / scale, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(${rgb}, ${0.85 * (1 - phase)})`;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
  ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
  ctx.stroke();
}

/** At most this many edge arrows, most urgent first. */
const MAX_POINTERS = 12;

/**
 * Arrows at the edge of the view pointing at off-screen words that need
 * attention. Returns where they were drawn (CSS pixels) for click handling.
 */
function drawPointers(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  attention: Attention[],
  kindOf: Map<string, AttentionKind>,
  nodes: Map<string, N>,
) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const dpr = cssWidth > 0 ? W / cssWidth : 1;
  const T = ctx.getTransform();
  const m = 22 * dpr;
  const [cx, cy] = [W / 2, H / 2];
  const out: { id: string; x: number; y: number }[] = [];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const { id } of attention) {
    if (out.length >= MAX_POINTERS) break;
    const kind = kindOf.get(id);
    const n = nodes.get(id);
    if (!kind || n?.x === undefined || n.y === undefined) continue;
    const sx = T.a * n.x + T.c * n.y + T.e;
    const sy = T.b * n.x + T.d * n.y + T.f;
    if (sx >= 0 && sx <= W && sy >= 0 && sy <= H) continue; // visible: the ripple shows it
    // Where the line from the centre to the word leaves the inset view.
    const dx = sx - cx;
    const dy = sy - cy;
    const k = Math.min(
      dx ? (cx - m) / Math.abs(dx) : Infinity,
      dy ? (cy - m) / Math.abs(dy) : Infinity,
    );
    const px = cx + dx * k;
    const py = cy + dy * k;
    const angle = Math.atan2(dy, dx);
    const s = 9 * dpr;
    const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 250);
    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.35, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fill();
    ctx.strokeStyle = `rgba(${ATTENTION_RGB[kind]}, 0.6)`;
    ctx.lineWidth = dpr;
    ctx.stroke();
    ctx.rotate(angle);
    ctx.shadowColor = `rgba(${ATTENTION_RGB[kind]}, 0.9)`;
    ctx.shadowBlur = 8 * dpr;
    ctx.fillStyle = `rgba(${ATTENTION_RGB[kind]}, ${pulse})`;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, -s * 0.8);
    ctx.lineTo(-s * 0.3, 0);
    ctx.lineTo(-s * 0.7, s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    out.push({ id, x: px / dpr, y: py / dpr });
  }
  ctx.restore();
  return out;
}

function Legend() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('sprawl.legend') !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem('sprawl.legend', open ? 'closed' : 'open');
    } catch {
      // private mode: just not remembered
    }
  };
  if (!open) {
    return (
      <button
        onClick={toggle}
        className="absolute bottom-3 left-3 rounded bg-slate-900/85 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
      >
        Legend ▴
      </button>
    );
  }
  return <LegendBody onClose={toggle} />;
}

function LegendBody({ onClose }: { onClose: () => void }) {
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
      <button
        onClick={onClose}
        className="pointer-events-auto absolute right-2 top-1 text-slate-500 hover:text-slate-200"
        title="Hide the legend"
      >
        ▾ hide
      </button>
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
        <span className="text-red-300">› red: attack</span>
        <span className="text-emerald-300">› green: support</span>
        <span className="text-emerald-200">glow: cohesion</span>
        <span className="text-red-300">? red: hostile</span>
        <span className="text-amber-300">◔ time until hostile</span>
        <span className="text-emerald-300">◌ claimed (fragile, steps 1-3)</span>
        <span className="text-sky-300">◎ ripple / edge arrow: needs you</span>
        <span className="text-slate-300">◯ white ring: next step opens</span>
        <span className="text-slate-400">◌ ghost: in sight, not in reach yet</span>
        <span className="text-sky-300">┅ blue flow: push towards the horizon</span>
        <span className="text-rose-300">! rose ring: claim in danger after a miss</span>
        <span className="text-amber-300">★ verb tense reached</span>
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

type Territory = { name: string; color: string; pts: (readonly [number, number, number])[] };

/** Offscreen buffer for the territory field (a fraction of the screen resolution). */
const fieldCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const FIELD_DOWNSCALE = 2;
const FIELD_THRESHOLD = 0.42;
const FIELD_BORDER = 0.06;
/** Width of the anti-aliased ramp at the blob edge (fraction of full alpha). */
const FIELD_SOFT = 0.035;

/**
 * Territories as metaballs: every word paints a soft radial gradient in its
 * region colour (bigger for practised words); where they overlap the density
 * adds up, and a threshold turns the field into smooth, fused blobs with a
 * border. Denser, stronger areas are drawn more vividly. Names scale with zoom.
 */
function drawRegions(ctx: CanvasRenderingContext2D, scale: number, regions: Territory[]) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const off = fieldCanvas;
  const octx = off?.getContext('2d', { willReadFrequently: true });
  if (off && octx && W > 0 && H > 0) {
    const w = Math.ceil(W / FIELD_DOWNSCALE);
    const h = Math.ceil(H / FIELD_DOWNSCALE);
    if (off.width !== w || off.height !== h) {
      off.width = w;
      off.height = h;
    }
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, w, h);
    const T = ctx.getTransform();
    const d = FIELD_DOWNSCALE;
    octx.setTransform(T.a / d, T.b / d, T.c / d, T.d / d, T.e / d, T.f / d);
    for (const t of regions) {
      for (const [x, y, r] of t.pts) {
        const reach = r * 2;
        const g = octx.createRadialGradient(x, y, 0, x, y, reach);
        g.addColorStop(0, `rgba(${t.color}, 1)`);
        g.addColorStop(0.35, `rgba(${t.color}, 0.8)`);
        g.addColorStop(1, `rgba(${t.color}, 0)`);
        octx.fillStyle = g;
        octx.beginPath();
        octx.arc(x, y, reach, 0, 2 * Math.PI);
        octx.fill();
      }
    }
    // Threshold the density field: outside -> clear, rim -> border, inside ->
    // a tint that deepens with density.
    const img = octx.getImageData(0, 0, w, h);
    const px = img.data;
    const t0 = FIELD_THRESHOLD * 255;
    const band = FIELD_BORDER * 255;
    const soft = FIELD_SOFT * 255;
    const BORDER = 150;
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i];
      if (a < t0 - soft) px[i] = 0;
      else if (a < t0)
        px[i] = (BORDER * (a - t0 + soft)) / soft; // anti-aliased outer edge
      else if (a < t0 + band) px[i] = BORDER;
      else {
        // Inner edge of the border blends into a tint that deepens with density.
        const inner = Math.min(95, 18 + (a - t0 - band) * 0.9);
        const k = Math.min(1, (a - t0 - band) / soft);
        px[i] = BORDER + (inner - BORDER) * k;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, W, H);
    ctx.restore();
  }
  // Region names: big and bold zoomed out, faint when zoomed in on words.
  const alpha = Math.min(0.85, Math.max(0.12, 1.1 - 0.45 * scale));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of regions) {
    if (!t.name || !t.pts.length) continue;
    const cx = t.pts.reduce((a, p) => a + p[0], 0) / t.pts.length;
    const cy = t.pts.reduce((a, p) => a + p[1], 0) / t.pts.length;
    const px2 = Math.min(24, Math.max(12, 8 + 2.5 * Math.sqrt(t.pts.length))); // screen pixels
    ctx.font = `800 ${px2 / scale}px sans-serif`;
    ctx.fillStyle = `rgba(${t.color}, ${alpha})`;
    ctx.fillText(t.name.toUpperCase(), cx, cy);
  }
  ctx.restore();
}

/** A glowing chevron pointing along the link: the direction influence travels. */
function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, l: L) {
  const a = l.source as N;
  const b = l.target as N;
  const angle = Math.atan2((b.y ?? 0) - (a.y ?? 0), (b.x ?? 0) - (a.x ?? 0));
  const attack = l.flow === 'attack';
  const size = (attack ? 3.2 : 2.4) + l.weight * 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.shadowColor = attack ? 'rgba(248, 113, 113, 0.9)' : 'rgba(110, 231, 183, 0.9)';
  ctx.shadowBlur = 6;
  ctx.strokeStyle = attack ? 'rgba(254, 202, 202, 0.95)' : 'rgba(209, 250, 229, 0.95)';
  ctx.lineWidth = attack ? 1.6 : 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-size * 0.6, -size);
  ctx.lineTo(size * 0.6, 0);
  ctx.lineTo(-size * 0.6, size);
  ctx.stroke();
  ctx.restore();
}

type BurstKind = 'step' | 'conquer' | 'verb';
const BURST_MS: Record<BurstKind, number> = { step: 1200, conquer: 1800, verb: 2600 };

/**
 * Celebration on the map, `p` from 0 to 1: expanding rings for a claim step,
 * a bigger emerald wave for a conquest, a golden starburst for a verb level.
 */
function drawBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  scale: number,
  kind: BurstKind,
  p: number,
) {
  const ease = 1 - (1 - p) ** 3;
  const reach = (kind === 'step' ? 22 : kind === 'conquer' ? 40 : 55) / scale;
  const rgb = kind === 'verb' ? '251, 191, 36' : '52, 211, 153';
  ctx.save();
  for (const lag of kind === 'step' ? [0] : [0, 0.2]) {
    const q = Math.max(0, (ease - lag) / (1 - lag));
    ctx.beginPath();
    ctx.arc(x, y, r + 2 + q * reach, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(${rgb}, ${0.9 * (1 - q)})`;
    ctx.lineWidth = (kind === 'step' ? 2 : 3) / scale;
    ctx.stroke();
  }
  if (kind === 'verb') {
    // Rays of light turning outwards.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI + p * 1.2;
      const r0 = r + 3 + ease * reach * 0.3;
      const r1 = r + 3 + ease * reach;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.strokeStyle = `rgba(253, 224, 71, ${0.9 * (1 - p)})`;
      ctx.lineWidth = 2 / scale;
      ctx.stroke();
    }
  }
  ctx.restore();
}
