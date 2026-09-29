import { forceCollide } from 'd3-force-3d';
import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { COOLDOWN_MS, RECLAIM_MS, SUPPLY } from '../config';
import { appNow } from '../core/clock';
import { hintedName, FULL_NAME } from '../core/fade';
import { edgeOpacity, healthBand } from '../core/health';
import { MAX_STRENGTH } from '../core/strength';
import { TENSES } from '../core/verbs';
import { CLAIM_STEPS, claimSteps, type Claim } from '../core/claim';
import { ATTENTION_ORDER, type Attention, type AttentionKind } from '../core/attention';
import type { AppData, Edge, RootHub, WordNode } from '../db/repo';
import { densityField, isoLines, levelAt, traceLoops, type Blob } from './contours';
import { stepCursor, useKeyboardCamera } from './useKeyboardCamera';
import {
  BAND_RGB,
  FONT_LATIN,
  FONT_TITLE,
  FONT_UI,
  isWeakBridge,
  levelRgb,
  mixRgb,
  REGION_RGB,
  regionColors,
  REASON_LABEL,
  REASON_RGB,
  reasonText,
  shapeOf,
  shapePath,
  type Shape,
} from './visuals';

/** Word node, or a root hub (then `word` holds the root's name/meaning for labels). */
/** Word node, a root hub, or a bought hint (`hintOf`: the word it belongs to). */
type GNode = { id: string; word: WordNode; hub?: RootHub; hintOf?: string };
/**
 * `descends`: link from a root hub to one of its words. `category`: invisible
 * spring pulling discovered words of the same category together.
 */
type GLink = Edge & {
  descends?: boolean;
  category?: boolean;
  /** Link from a word to its bought hint. */
  hint?: boolean;
};

/** Supply as the map draws it (core/supply.ts, via supplyState). */
export type SupplyView = {
  /** Supply arriving at each word it reaches. */
  value: Map<string, number>;
  /** The neighbour each word's supply comes from: the supply lines. */
  from: Map<string, string>;
  /** Held words that are broken (missed, or faded past the line). */
  broken: Set<string>;
  /** What each word sends out now (held and unbroken; the capital while it works). */
  sends: Map<string, number>;
  /** Towers: the capital and your strongholds (words sending out full supply); working = sending now. */
  towers: Map<string, { capital: boolean; working: boolean }>;
  /** Held words cut off: since when, and when they fall (app ms). */
  cut: Map<string, { since: number; until: number }>;
  /** Supply a word needs to count. */
  min: number;
};
/**
 * Where the selected word's supply comes from: each shown supplier's share (in
 * whole %, rounded to add up to `total`), the rest summed (`others`), the links
 * it takes (oriented towards the word), and, for a word short of supply, what
 * winning a "?" nearby would add.
 */
export type FlowView = {
  target: string;
  sources: Map<string, number>;
  others?: { pct: number; count: number };
  /** Its supply (whole %) and what it needs; none for the capital. */
  total?: { pct: number; needs: number };
  links: Map<string, [string, string]>;
  gains: Map<string, number>;
};
/** A link's key in `FlowView.links`, whichever way round. */
export const flowKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
type N = NodeObject<GNode>;
type L = LinkObject<GNode, GLink>;

/** Map backgrounds: night ground for your territory, deep space for the whole network. */
const GROUND_BG =
  'radial-gradient(ellipse 80% 70% at 50% 45%, #0b1430 0%, #050a1c 55%, #02040d 100%)';
const SPACE_BG =
  'radial-gradient(ellipse 90% 80% at 50% 50%, #0a0c24 0%, #03040f 60%, #010208 100%)';

/** A stable small number from a string (per-link pulse pace and phase). */
function hashOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Ripple colours (RGB) for words that need attention. */
const ATTENTION_RGB: Record<AttentionKind, string> = {
  broken: '244, 63, 94', // rose: a broken word, a gap in your supply
  raid: '251, 146, 60', // orange: a chokepoint under raid
  reclaim: '45, 212, 191', // teal: a lost word one answer wins back
  due: '167, 139, 250', // violet: a held word due for review
  ready: '52, 211, 153', // emerald: a claim step is open
  new: '125, 211, 252', // light sky: just revealed
};
const ATTENTION_LABEL: Record<AttentionKind, string> = {
  broken: 'broken',
  raid: 'raided',
  reclaim: 'to win back',
  due: 'due',
  ready: 'ready',
  new: 'new',
};
/** Supply's colour: gold, like the towers on the words sending out the most. */
const SUPPLY_RGB = '251, 191, 36';
/** Strong supply's pale gold: the gauge of a well-supplied word. */
const SUPPLY_LIGHT = '255, 236, 179';
/** A held word with less supply than this is thin: a little weakening nearby cuts it off (amber ring). */
const THIN_SUPPLY = 0.7;
/** Supply at which a word's ground is lit in full (shares add up, often past 100%). */
const LIGHT_FULL = 1.5;

type Props = {
  data: AppData;
  health: Map<string, number | null>;
  /** Node of the card being reviewed, or the node selected in inspect mode. */
  activeId?: string;
  /** Strength level 0-5 per word; stronger words are drawn bigger. */
  strength: Map<string, number>;
  /** Verb level (tenses mastered) per conjugable verb; drawn as gold rings. */
  verbLevels: Map<string, number>;
  /** Root hubs that opened (core/roots.ts). */
  unlockedRoots: Set<string>;
  /** Sealed root hub -> how far it is from opening (0..1), drawn as a filling ring. */
  rootCharge?: Map<string, number>;
  /** Word id -> real time (ms) its wrong-answer lock ends. */
  cooldowns: Map<string, number>;
  /** Current app time (ms). */
  nowMs: number;
  /** Claim progress of claimed words. */
  claims: Map<string, Claim | undefined>;
  /** Claimed words waiting for their next step: when it opens and the whole wait (app ms). */
  claimWaits: Map<string, { opensAt: number; total: number }>;
  /** Your supply: lines, broken and cut-off words, towers. */
  supply?: SupplyView;
  /** The selected word's suppliers and what winning a "?" nearby would add. */
  flow?: FlowView;
  /** Lost words one right answer wins back, what they were and until when (app ms). */
  reclaim: Map<string, { was: 'conquered' | 'claimed'; steps: number; until: number }>;
  /** Words with a bought hint -> their English cousin, drawn as a small node next to them. */
  hints: Map<string, string>;
  /** Each topic's (region id) level name ("A1.2"), shown under its name on your map. */
  topicLevels?: Map<number, string>;
  /** Words that need attention, most urgent first: ripples, edge arrows, jump bar. */
  attention: Attention[];
  /** Word whose Italian name is the answer being asked: its name is hidden. */
  answerId?: string;
  /** Words about to be asked into Italian: their names show only a few letters. */
  recall?: Set<string>;
  /** Show every word and edge (spoilers) for inspecting the network. */
  inspect: boolean;
  /** Hidden words a little supply seeps to: drawn as ghosts, not conquerable yet. */
  ghosts?: Set<string>;
  /** Supply seeping past your words (core/supply.ts, fog) at every word it reaches: the glow. */
  reach?: Map<string, number>;
  onNodeClick: (id: string) => void;
  /** A click into empty map (not on a word or an edge arrow): let go of the selection. */
  onBackgroundClick?: () => void;
};

export default function GraphView({
  data,
  health,
  activeId,
  strength,
  verbLevels,
  unlockedRoots,
  rootCharge,
  cooldowns,
  nowMs,
  claims,
  claimWaits,
  supply,
  reclaim,
  hints,
  flow,
  topicLevels,
  attention,
  answerId,
  recall,
  inspect,
  ghosts,
  reach,
  onNodeClick,
  onBackgroundClick,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<N, L>>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });
  /** Names collected while drawing the words, drawn last where they fit (drawLabels). */
  const labels = useRef<Label[]>([]);
  // The canvas draws with the bundled fonts only once they have loaded: redraw then.
  const [, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all(
      [`600 16px ${FONT_UI}`, `700 16px ${FONT_TITLE}`, `italic 600 16px ${FONT_LATIN}`].map((f) =>
        document.fonts?.load(f),
      ),
    )
      .catch(() => undefined)
      .then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);
  /** Keyboard cursor: arrows move it along links, Enter/Space opens it. */
  const [cursorId, setCursorId] = useState<string | undefined>(activeId ?? data.seed);
  /** Where the cursor was before a click into empty map hid it: arrows go on from there. */
  const lastCursor = useRef<string | undefined>(undefined);
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
  const hubs = useMemo(() => data.graph.roots ?? [], [data.graph]);
  // A root appears once you've conquered one of its words (always in inspect mode).
  const visibleKey = [
    ...data.nodes
      .filter((n) => inspect || data.states.get(n.id) !== 'locked' || ghosts?.has(n.id))
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

  // Something moves on screen: keep redrawing (supply lines, arrows, breathing glow).
  const animate =
    !inspect &&
    (cohesionOf.size > 0 ||
      attentionOf.size > 0 ||
      claimWaits.size > 0 ||
      (supply?.cut.size ?? 0) > 0 ||
      !!flow?.links.size ||
      !!activeId ||
      bursting);

  const hintKey = [...hints].map(([id, c]) => `${id}=${c}`).join(',');

  /** Ids of the words the last graphData showed: any others entering are placed by a neighbour. */
  const shownBefore = useRef(new Set<string>());
  /** Your map and the whole network each keep their layout while you're in the other one. */
  const views = useRef<Partial<Record<ViewName, SavedView>>>({});
  /** Once the view you switched to has rendered: the camera you left it with, or 'fit'. */
  const pendingCamera = useRef<SavedView['camera'] | 'fit'>(undefined);
  const fitted = useRef(false);
  /** Whole network: rounds of pulling stray words home left (see `shake`). */
  const shakes = useRef(0);
  /** Layout ticks so far (the whole network's camera follows it every 60). */
  const ticks = useRef(0);
  /** The layout finished (all shakes done) since this view was entered. */
  const settled = useRef(false);
  /**
   * Back to a finished layout: show it exactly as it was. Rerunning the forces
   * from full heat would drift it (the map is never quite at rest).
   */
  const hold = useRef(false);
  /** The player panned or zoomed: stop refitting the view to the map. */
  const cameraMoved = useRef(false);
  // Switching views keeps the layout and camera of the one you leave and brings back
  // the one you return to: your map is exactly as you left it (the whole network
  // spreads its words far apart, and your map would take long to pull them back),
  // and the whole network opens laid out after the first time. A view seen for the
  // first time is laid out afresh.
  const wasInspect = useRef(inspect);
  if (wasInspect.current !== inspect) {
    const leaving: ViewName = wasInspect.current ? 'network' : 'map';
    wasInspect.current = inspect;
    views.current[leaving] = saveView(
      nodeCache.current,
      shownBefore.current,
      fg.current,
      cameraMoved.current,
      settled.current,
    );
    const back = views.current[inspect ? 'network' : 'map'];
    // Left before it finished: carry on from where it was.
    hold.current = !!back?.settled;
    shakes.current = back?.settled ? SHAKES : 0;
    settled.current = false;
    for (const n of nodeCache.current.values()) {
      const p = back?.pos.get(n.id);
      n.vx = 0;
      n.vy = 0;
      if (p) [n.x, n.y, n.fx, n.fy] = p;
      else [n.fx, n.fy] = [undefined, undefined];
    }
    if (back) shownBefore.current = new Set(back.pos.keys());
    // Where you had put the camera yourself, it goes back there; otherwise the view is fitted.
    pendingCamera.current = back?.moved ? back.camera : 'fit';
    cameraMoved.current = !!back?.moved;
  }
  useEffect(() => {
    const cam = pendingCamera.current;
    pendingCamera.current = undefined;
    if (cam === 'fit') fitView();
    else if (cam) {
      fg.current?.centerAt(cam.x, cam.y);
      fg.current?.zoom(cam.k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspect]);

  const graphData = useMemo(() => {
    const visible = new Set(visibleKey.split(',').filter(Boolean));
    const linkedTo = (id: string) =>
      data.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : []));
    const shown = shownBefore.current;
    const node = (id: string, word: WordNode, hub?: RootHub, hintOf?: string) => {
      let n = nodeCache.current.get(id);
      if (!n) {
        n = { id, word };
        nodeCache.current.set(id, n);
      }
      if (!shown.has(id)) {
        // Organic layout: a word entering the view appears next to a shown word it
        // links to (usually the one that revealed it), then settles by physics. Not
        // where it last was: after a visit to the whole network that is far away.
        const anchors = hintOf ? [hintOf] : hub ? hub.words : linkedTo(id);
        const anchor = anchors
          .filter((a) => shown.has(a))
          .map((a) => nodeCache.current.get(a))
          .find((a) => a?.x !== undefined && a.y !== undefined);
        if (anchor) {
          n.x = anchor.x! + (Math.random() - 0.5) * 40;
          n.y = anchor.y! + (Math.random() - 0.5) * 40;
          [n.vx, n.vy, n.fx, n.fy] = [0, 0, undefined, undefined];
          hold.current = false; // it has to settle in
        }
      }
      n.word = word;
      n.hub = hub;
      n.hintOf = hintOf;
      return n;
    };
    const hubNodes = hubs
      .filter((h) => visible.has(h.id))
      .map((h) =>
        node(h.id, { id: h.id, it: h.root, en: h.meaning ?? '', pos: null, theme: null }, h),
      );
    const hintNodes = inspect
      ? []
      : [...hints]
          .filter(([id]) => visible.has(id))
          .map(([id, cousin]) =>
            node(
              `hint:${id}`,
              { id: `hint:${id}`, it: cousin, en: cousin, pos: null, theme: null },
              undefined,
              id,
            ),
          );
    const nodes = [
      ...data.nodes.filter((n) => visible.has(n.id)).map((w) => node(w.id, w)),
      ...hubNodes,
      ...hintNodes,
    ];
    const links: GLink[] = data.edges
      .filter((e) => visible.has(e.source) && visible.has(e.target))
      .filter((e) => !(hubs.length && e.reason === 'etymological')) // the hub replaces these
      .map((e) => ({ ...e }));
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
    for (const n of hintNodes) {
      links.push({
        source: n.hintOf!,
        target: n.id,
        weight: 0.9,
        reason: 'etymological',
        hint: true,
      });
    }
    shownBefore.current = new Set(nodes.map((n) => n.id));
    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, data.edges, hubs, hintKey, inspect]);

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
      const visible = graphData.nodes.filter((n) => n.x !== undefined && !n.hintOf);
      const start = cursorId ?? lastCursor.current;
      const from = (start && pos(start)) || visible[0];
      if (!from) return;
      if (!start || !pos(start)) return setCursorId(from.id);
      const linked = new Set(
        graphData.links
          .filter((l) => !l.category && !l.hint)
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
    // Links between categories are long and loose, so each category holds
    // together as one territory instead of being torn apart by its outside ties.
    fg.current
      ?.d3Force('link')
      ?.distance((l: L) =>
        l.hint ? 14 : l.category ? 70 : (40 + (1 - l.weight) * 60) * (crossRegion(l) ? 2 : 1),
      )
      .strength((l: L) =>
        l.hint ? 1 : l.category ? 0.05 : (0.15 + l.weight * 0.5) * (crossRegion(l) ? 0.3 : 1),
      );
    fg.current?.d3Force('charge')?.strength(-150);
    // Words keep their distance (room for the name under each), so a category
    // spreads out instead of piling up in its middle.
    fg.current?.d3Force(
      'collide',
      forceCollide<N>((n) => (n.hintOf ? 6 : n.hub ? 14 : 20)).iterations(2),
    );
    fg.current?.d3Force('cluster', clusterForce());
    // Set once: a page shows one graph, and its regions never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Territories: every visible word of a region, named once you've conquered one of them.
  // Points are read from the live node objects at draw time, so dragged words take
  // their territory with them.
  // Colours by who sits next to whom, so neighbouring territories never match.
  const colorOf = useMemo(
    () => regionColors(data.graph.regions ?? [], data.edges, (id) => byId.get(id)?.region),
    [data.graph.regions, data.edges, byId],
  );
  const regionsToDraw = (data.graph.regions ?? []).flatMap((r) => {
    const ids = r.words.filter((w) => inspect || (data.states.get(w) ?? 'locked') !== 'locked');
    if (!ids.length) return [];
    const named = inspect || r.words.some((w) => data.states.get(w) === 'conquered');
    return [
      {
        name: named ? r.name : '',
        color: REGION_RGB[colorOf.get(r.id) ?? 0],
        level: named && !inspect ? topicLevels?.get(r.id) : undefined,
        ids,
      },
    ];
  });
  /** Star colour per word in the galaxy view: its category's colour. */
  const starRgb = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data.graph.regions ?? []) {
      for (const w of r.words) m.set(w, REGION_RGB[colorOf.get(r.id) ?? 0]);
    }
    return m;
  }, [data.graph.regions, colorOf]);
  const livePoints = (): Territory[] =>
    regionsToDraw.map((t) => ({
      ...t,
      pts: t.ids
        .map((id) => nodeCache.current.get(id))
        .filter((n): n is N => n?.x !== undefined && n?.y !== undefined)
        .map((n) => [n.x!, n.y!, territoryRadius(n.id), inspect ? 0 : lightOf(n.id)] as const),
    }));
  /** The whole network is far bigger than your map: it may zoom out further. */
  const minZoom = inspect ? 0.04 : 0.15;
  /** Fit the visible words into view, never closer than 2× (a new map has only a few). */
  const fitView = () => {
    const pts = graphData.nodes.filter((n) => n.x !== undefined && n.y !== undefined);
    if (!pts.length || !fg.current) return;
    const xs = pts.map((n) => n.x!);
    const ys = pts.map((n) => n.y!);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 80;
    const k = Math.min(
      2,
      (size.width - 2 * pad) / Math.max(1, x1 - x0),
      (size.height - 2 * pad) / Math.max(1, y1 - y0),
    );
    fg.current.centerAt((x0 + x1) / 2, (y0 + y1) / 2, 400);
    fg.current.zoom(Math.max(minZoom, k), 400);
  };
  /** A word's pull on its territory: practised words claim more ground. */
  const territoryRadius = (id: string) => {
    if (inspect) return 24; // galaxy view: every word lights up its nebula
    const st = data.states.get(id);
    // Cut off, a word barely holds any ground: the territory shrinks around the gap.
    if (st === 'conquered' && supply?.cut.has(id)) return 14;
    if (st === 'conquered') {
      return 32 + 6 * (strength.get(id) ?? 0) + 4 * (verbLevels.get(id) ?? 0);
    }
    // Every claim step pushes the border out a little.
    if (st === 'claimed') return 18 + 5 * claimSteps(claims.get(id));
    return st === 'frontier' ? 16 : 12;
  };

  const endId = (x: unknown) => (typeof x === 'object' && x ? (x as N).id : (x as string));

  /**
   * The supply the map lights a word with: a held word the supply there (what
   * reaches it, or what it sends out if more; none while cut off), any other
   * word what seeps to it.
   */
  const glowOf = (id: string) => {
    if (!supply) return 0;
    if (data.states.get(id) === 'conquered') {
      if (supply.cut.has(id)) return 0;
      return Math.max(supply.value.get(id) ?? 0, supply.sends.get(id) ?? 0);
    }
    return reach?.get(id) ?? supply.value.get(id) ?? 0;
  };
  /**
   * How brightly a word's ground is lit (0..1): its supply against LIGHT_FULL,
   * steeper than straight, so the thin fringe (50%) stands on dim ground, 100%
   * on clearly lit ground and the heart of a strong territory shines.
   */
  const lightOf = (id: string) => Math.pow(Math.min(1, glowOf(id) / LIGHT_FULL), 1.5);
  const isHub = (id: string) => id.startsWith('root:');
  /** A word's name as the player may see it: fading words lose letters (see core/fade). */
  const shownName = (id: string) => {
    const word = byId.get(id)?.it ?? '';
    if (inspect) return word;
    // A name is earned by conquering the word, and hidden while it is the answer.
    if (data.states.get(id) !== 'conquered' || id === answerId) return '';
    return hintedName(word, health.get(id) ?? null, recall?.has(id) ?? false);
  };
  const won = (id: string) => ['conquered', 'claimed'].includes(data.states.get(id) ?? '');
  const hidden = (id: string) => !inspect && !isHub(id) && !won(id);
  const activeNeighbours = useMemo(
    () =>
      new Set(
        data.edges.flatMap((e) =>
          e.source === activeId ? [e.target] : e.target === activeId ? [e.source] : [],
        ),
      ),
    [data.edges, activeId],
  );
  const touchesActive = (l: L) =>
    inspect && activeId !== undefined && [endId(l.source), endId(l.target)].includes(activeId);

  const drawNode = (node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const state = data.states.get(node.id);
    const shape: Shape = shapeOf(node.word.pos);
    const vl = verbLevels.get(node.id) ?? 0;
    // Stronger words are bigger; every tense a verb masters makes it bigger still.
    const active = node.id === activeId;
    // The selected word is drawn bigger: where you are must be found at a glance.
    const r =
      (state === 'conquered' ? 5 + (strength.get(node.id) ?? 0) * 0.8 + vl * 0.9 : 6) *
      (active && !inspect ? 1.35 : 1);
    /** Queue a name under the word; drawLabels places it last, where it fits. */
    const label = (lines: LabelLine[], priority: number, below = r + 2.5) => {
      // Zoomed far out, word labels give way to region names.
      const fade = active ? 1 : Math.min(1, Math.max(0, (scale - 0.3) / 0.12));
      if (fade > 0) {
        labels.current.push({ x, y: y + below, lines, fade, priority: active ? 1e6 : priority });
      }
    };
    if (inspect && !node.hub) {
      // Galaxy view: every word a small star in its category's colour.
      const linked = activeId !== undefined && activeNeighbours.has(node.id);
      const glow = drawStar(ctx, x, y, scale, starRgb.get(node.id) ?? '203, 213, 225', {
        active,
        linked,
      });
      if (active || linked || scale > 1.4) {
        const a = active ? 1 : linked ? 0.85 : Math.min(0.8, (scale - 1.4) * 1.5);
        labels.current.push({
          x,
          y: y + glow * 0.6,
          fade: 1,
          priority: active ? 1e6 : linked ? 1000 : 0,
          lines: [
            {
              text: node.word.it,
              px: 10,
              rgb: '226, 232, 240',
              alpha: a,
              weight: active ? 600 : 450,
            },
          ],
        });
      }
      return;
    }
    ctx.save();
    const burst = bursts.current.get(node.id);
    if (burst && !inspect) {
      const p = (Date.now() - burst.at) / BURST_MS[burst.kind];
      if (p < 1) drawBurst(ctx, x, y, r, scale, burst.kind, p);
      else bursts.current.delete(node.id);
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
    if (node.id === cursorId && !active) {
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, 2 * Math.PI);
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (node.hintOf) {
      drawHint(ctx, x, y);
      if (scale >= 0.6) {
        label(
          [{ text: `≈ ${node.word.it}`, px: 11.5, rgb: '253, 230, 138', alpha: 0.9, latin: true }],
          30,
          4.5,
        );
      }
      ctx.restore();
      return;
    }
    if (node.hub) {
      const unlocked = inspect || unlockedRoots.has(node.id);
      const lines = drawHub(
        ctx,
        node,
        x,
        y,
        scale,
        active,
        unlocked,
        inspect,
        inspect ? undefined : rootCharge?.get(node.id),
      );
      if (lines.length) label(lines, 40, 9);
      ctx.restore();
      return;
    }
    if (active) {
      // You are here: a white target around the word the side panel is about,
      // sized in screen pixels (k = one pixel in map units), so it is as plain
      // zoomed far out as close up: a halo, a ring with four ticks, and a pulse
      // running outwards.
      const t = Date.now();
      const k = 1 / scale;
      const R = r + 9 * k;
      const p = (t % 1600) / 1600;
      softGlow(ctx, x, y, r, R + 16 * k, '248, 250, 252', 0.5);
      ctx.beginPath();
      ctx.arc(x, y, R + p * 24 * k, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(248, 250, 252, ${0.75 * (1 - p)})`;
      ctx.lineWidth = 2 * k;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, R, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.lineWidth = 5.5 * k;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.8 * k;
      ctx.stroke();
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (R + 4 * k), y + Math.sin(a) * (R + 4 * k));
        ctx.lineTo(x + Math.cos(a) * (R + 11 * k), y + Math.sin(a) * (R + 11 * k));
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
        ctx.lineWidth = 5 * k;
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.6 * k;
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }

    if (!inspect && ghosts?.has(node.id)) {
      // Beyond the horizon: a faint ghost of what lies ahead, clearer the more
      // supply seeps to it (it becomes a "?" at SUPPLY.reveal).
      ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, (reach?.get(node.id) ?? 0) / SUPPLY.reveal);
      shapePath(ctx, shape, x, y, r);
      ctx.fillStyle = 'rgba(71, 85, 105, 0.15)';
      ctx.fill();
      ctx.setLineDash([1, 2]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }
    // Outside your supply, a word you win here is cut off from the start: drawn faint.
    const outside = !inspect && !!supply && (supply.value.get(node.id) ?? 0) < supply.min - 1e-9;
    if (state === 'claimed') {
      // Freshly won but fragile: glassy, one ring segment per conquest step. The
      // name stays hidden ("?") until conquered, so producing it is real recall.
      const steps = claimSteps(claims.get(node.id));
      softGlow(ctx, x, y, r, r + 7, '52, 211, 153', 0.22);
      shapePath(ctx, shape, x, y, r);
      ctx.fillStyle = orbGradient(ctx, x, y, r, '52, 211, 153', 0.45);
      ctx.fill();
      ctx.setLineDash([1.5, 1.5]);
      ctx.strokeStyle = 'rgba(110, 231, 183, 0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const seg = (2 * Math.PI) / CLAIM_STEPS;
      ctx.lineCap = 'round';
      for (let i = 0; i < CLAIM_STEPS; i++) {
        const a0 = -Math.PI / 2 + i * seg + 0.22;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.8, a0, a0 + seg - 0.44);
        ctx.strokeStyle = i < steps ? 'rgba(52, 211, 153, 0.95)' : 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1.7;
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      const wait = claimWaits.get(node.id);
      if (wait) {
        // Time until the next step opens: a light ring that runs down.
        const left = Math.max(0, (wait.opensAt - appNow(data.offsetDays).getTime()) / wait.total);
        ctx.beginPath();
        ctx.arc(x, y, r + 5.5, -Math.PI / 2, -Math.PI / 2 + left * 2 * Math.PI);
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      glyph(ctx, '?', x, y, shape, '#ecfdf5');
      ctx.restore();
      return;
    }
    if (state !== 'conquered') {
      const rgb = state === 'locked' ? '100, 116, 139' : '71, 85, 105';
      if (outside) ctx.globalAlpha = 0.55;
      shapePath(ctx, shape, x, y, r);
      ctx.fillStyle = orbGradient(ctx, x, y, r, rgb, outside ? 0.5 : 0.8);
      ctx.fill();
      ctx.setLineDash(outside ? [1, 2.5] : [2, 2]);
      ctx.strokeStyle =
        state === 'locked' ? 'rgba(100, 116, 139, 0.6)' : 'rgba(148, 163, 184, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const back = inspect ? undefined : reclaim.get(node.id);
      if (back) {
        // Lost but remembered: the old outline in teal, running down to when it's gone.
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, 2 * Math.PI);
        ctx.setLineDash([1.5, 2.5]);
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        const left = Math.max(0, Math.min(1, (back.until - nowMs) / RECLAIM_MS));
        ctx.beginPath();
        ctx.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + left * 2 * Math.PI);
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.9)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        badge(
          ctx,
          back.was === 'conquered' ? '↺ ★' : `↺ ${back.steps}/3`,
          x,
          y - r - 7,
          scale,
          '94, 234, 212',
        );
      }
      glyph(ctx, '?', x, y, shape, '#e2e8f0');
      ctx.restore();
      return;
    }

    const h = health.get(node.id) ?? 1;
    const band = healthBand(h);
    const cut = inspect ? undefined : supply?.cut.get(node.id);
    const broken = !inspect && !!supply?.broken.has(node.id);
    // Cut off from supply: drained of colour until reconnected.
    const rgb = cut && !broken ? '100, 116, 139' : BAND_RGB[band];
    const tower = inspect ? undefined : supply?.towers.get(node.id);
    if (tower) {
      // The capital and your strongholds: a gold tower over the word (grey while broken).
      const h = tower.capital ? 16 : 11;
      ctx.save();
      if (!tower.working) ctx.globalAlpha = 0.45;
      drawTower(ctx, x, y - r - h * 0.75, h, SUPPLY_RGB);
      ctx.restore();
    }
    const coh = inspect ? 0 : (cohesionOf.get(node.id) ?? 0);
    // Every word glows a little; embedded words glow bigger and brighter the more
    // strongly they are tied into conquered territory, breathing slowly.
    const breath = coh > 0 ? 0.85 + 0.15 * Math.sin(Date.now() / 900 + x * 0.01) : 1;
    softGlow(
      ctx,
      x,
      y,
      r * 0.7,
      r + 5 + Math.min(10, coh * 3),
      rgb,
      (0.2 + Math.min(0.3, coh * 0.12)) * (cut ? 0.3 : 1) * breath,
    );
    if (!cut && !inspect && supply) {
      // The supply gauge: a ring filled as far as its supply goes, full from
      // 100%. Amber when thin (a little weakening nearby cuts it off), gold in
      // the middle ground, pale gold once full.
      const v = Math.min(1, supply.value.get(node.id) ?? 0);
      // At least ~2.5 px on screen however far out you zoom: it has to be read at a glance.
      const w = Math.max(2.2, 2.6 / scale);
      const gr = r + 2.4 + vl * 1.8 + w / 2;
      ctx.beginPath();
      ctx.arc(x, y, gr, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.lineWidth = w + 1.2 / scale;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, gr, -Math.PI / 2, -Math.PI / 2 + Math.max(0.04, v) * 2 * Math.PI);
      ctx.strokeStyle =
        v < THIN_SUPPLY
          ? 'rgba(251, 146, 60, 0.95)'
          : v < 1
            ? `rgba(${SUPPLY_RGB}, 0.9)`
            : `rgba(${SUPPLY_LIGHT}, 1)`;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    if (cut) {
      // The siege clock: a ring running down to when it falls back to "?".
      const left = Math.max(0, Math.min(1, (cut.until - nowMs) / (cut.until - cut.since || 1)));
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI);
      ctx.setLineDash([1.5, 2]);
      ctx.strokeStyle = broken ? 'rgba(244, 63, 94, 0.55)' : 'rgba(148, 163, 184, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, -Math.PI / 2, -Math.PI / 2 + left * 2 * Math.PI);
      ctx.strokeStyle = broken ? 'rgba(244, 63, 94, 0.95)' : 'rgba(203, 213, 225, 0.85)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    // One gold ring per tense mastered: verbs are the strongholds of a territory.
    if (vl > 0 && !inspect) {
      softGlow(ctx, x, y, r, r + 6 + vl * 2.5, '251, 191, 36', 0.15 + 0.05 * vl);
    }
    for (let i = 0; i < vl; i++) {
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5 + i * 1.8, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.9 - i * 0.1})`;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    shapePath(ctx, shape, x, y, r);
    ctx.fillStyle = orbGradient(ctx, x, y, r, rgb, band === 'faded' ? 0.8 : 1);
    ctx.fill();
    ctx.strokeStyle = `rgba(${mixRgb(rgb, '255, 255, 255', 0.5)}, 0.55)`;
    ctx.lineWidth = 0.6;
    ctx.stroke();
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
      const lines: LabelLine[] = [
        { text: name, px: 11.5, rgb: '241, 245, 249', alpha: Math.max(0.4, h), weight: 550 },
      ];
      // The verb's rank: stars and the tense it has reached.
      if (vl > 0 && scale > 0.5) {
        lines.push({
          text: `${'★'.repeat(vl)} ${TENSES[vl - 1]}`,
          px: 9,
          rgb: '251, 191, 36',
          alpha: 0.95,
          weight: 700,
        });
      }
      const sv = supply?.value.get(node.id);
      if (!inspect && sv !== undefined && scale > 1.5) {
        // Close up, the supply in numbers: cut-off words too (grey), so you
        // can see how far they are from the 50% they need.
        lines.push({
          text: `⚡ ${Math.round(sv * 100)}%`,
          px: 8.5,
          rgb: cut ? '148, 163, 184' : sv < THIN_SUPPLY ? '251, 146, 60' : SUPPLY_RGB,
          alpha: 0.9,
          weight: 600,
        });
      }
      if (node.word.root && scale > 1.3 && h >= FULL_NAME) {
        lines.push({
          text: `‹ ${node.word.root}`,
          px: 10.5,
          rgb: '249, 168, 212',
          alpha: 0.8,
          latin: true,
        });
      }
      label(lines, 100 + 10 * (strength.get(node.id) ?? 0) + 20 * vl);
    } else {
      // Faded out completely: the word must be recalled to see it again.
      glyph(ctx, '?', x, y, shape, '#f8fafc');
    }
    ctx.restore();
  };

  const regionOf = (id: string) => byId.get(id)?.region;
  const crossRegion = (l: L) => {
    const [a, b] = [regionOf(endId(l.source)), regionOf(endId(l.target))];
    return a !== undefined && b !== undefined && a !== b;
  };
  const linkAlpha = (l: L) => {
    if (l.hint) return 0.6;
    if (touchesActive(l)) return 0.95;
    // Links between territories are long; keep them in the background.
    const dim = crossRegion(l) || l.descends ? (inspect ? 0.12 : 0.5) : 1;
    if (inspect) return (activeId === undefined ? 0.8 : 0.15) * dim;
    const [a, b] = [endId(l.source), endId(l.target)];
    if (ghosts?.has(a) || ghosts?.has(b)) return 0.2 * dim; // towards the horizon
    if (hidden(a) || hidden(b)) return 0.4 * dim;
    // Into or out of a cut-off pocket: the line is down.
    if (supply?.cut.has(a) || supply?.cut.has(b)) return 0.25 * dim;
    return 0.8 * Math.max(0.3, edgeOpacity(health.get(a) ?? null, health.get(b) ?? null)) * dim;
  };

  const linkTooltip = (l: L) => {
    const [a, b] = [endId(l.source), endId(l.target)];
    if (l.hint) return '💡 your hint';
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
    if (l.via === 'user') {
      return `<b>${shownName(a) || '?'} ↔ ${shownName(b) || '?'}</b><div style="color:rgb(52,211,153)">🌱 planted by you</div>`;
    }
    // The two words, why they belong together and how strongly.
    return `<b>${shownName(a) || '?'} ↔ ${shownName(b) || '?'}</b><div style="color:${color}">● ${reasonText(l, wa, wb)}</div>
      <div style="opacity:.8">strength ${Math.round(l.weight * 100)}%</div>`;
  };

  /**
   * A supply line: the link a held word's supply comes in by, from the word
   * it comes from [from, to]. Only supplied words have one.
   */
  const supplyLine = (l: L): [N, N] | null => {
    if (inspect || !supply || l.category || l.descends || l.hint) return null;
    const a = l.source as N;
    const b = l.target as N;
    if (typeof a !== 'object' || typeof b !== 'object') return null;
    // The selected word's suppliers: their supply runs towards it, cut off or not.
    const toward = flow?.links.get(flowKey(a.id, b.id));
    if (toward) return toward[0] === a.id ? [a, b] : [b, a];
    const fed = (from: N, to: N) =>
      supply.from.get(to.id) === from.id &&
      data.states.get(to.id) === 'conquered' &&
      !supply.cut.has(to.id);
    if (fed(a, b)) return [a, b];
    if (fed(b, a)) return [b, a];
    return null;
  };
  const isEnergy = (l: L) => !!supplyLine(l);

  /**
   * Supply flowing out along a supply line: pulses of gold light from where
   * it comes from, each line at its own pace and phase (from the words'
   * ids), brighter where more supply arrives.
   */
  const drawEnergy = (ctx: CanvasRenderingContext2D, l: L) => {
    const line = supplyLine(l);
    if (!line) return;
    const [s, e] = line;
    if (s.x === undefined || e.x === undefined || s.y === undefined || e.y === undefined) return;
    const strength = flow?.links.has(flowKey(s.id, e.id))
      ? 1
      : Math.min(1, (supply?.value.get(e.id) ?? 0) / LIGHT_FULL);
    const seed = hashOf(`${s.id}|${e.id}`);
    const [ax, ay, bx, by] = [s.x, s.y, e.x, e.y];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) return;
    const period = 2400 + (seed % 2000);
    const tail = Math.min(0.5, 30 / len);
    const head = (((Date.now() + seed) % period) / period) * (1 + tail);
    const t1 = Math.min(1, head);
    const t0 = Math.max(0, head - tail);
    if (t1 - t0 < 0.01) return;
    const [x0, y0] = [ax + (bx - ax) * t0, ay + (by - ay) * t0];
    const [x1, y1] = [ax + (bx - ax) * t1, ay + (by - ay) * t1];
    const rank = weightRank(l.weight);
    ctx.save();
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(253, 230, 138, 0)');
    g.addColorStop(1, `rgba(254, 243, 199, ${0.35 + 0.6 * strength})`);
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.8 + 2.4 * rank ** 2 * strength;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    if (head < 1) softGlow(ctx, x1, y1, 0, 2.5 + 3 * rank, SUPPLY_RGB, 0.6 * strength);
    ctx.restore();
  };

  return (
    <div
      ref={wrap}
      className="relative h-full w-full"
      onWheel={() => (cameraMoved.current = true)}
      onPointerMove={(e) => {
        if (e.buttons) cameraMoved.current = true;
      }}
    >
      <ForceGraph2D<GNode, GLink>
        ref={fg}
        width={size.width}
        height={size.height}
        graphData={graphData}
        // A CSS background (force-graph sets it on the canvas): deep space, lighter at the centre.
        backgroundColor={inspect ? SPACE_BG : GROUND_BG}
        nodeRelSize={6}
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, 9, 0, 2 * Math.PI);
          ctx.fill();
        }}
        nodeLabel={(n) => {
          if (n.hintOf) {
            return `💡 Hint: English cousin “${n.word.it}”`;
          }
          if (n.hub && !inspect && !unlockedRoots.has(n.id)) {
            return `${n.hub.lang ?? ''} root ${n.hub.root}: opens by itself once enough of its words are inside your supply, and reveals them all`;
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
          if (!inspect && ghosts?.has(n.id))
            return 'Beyond your horizon: conquer a word next to it';
          const outside = !inspect && supply && (supply.value.get(n.id) ?? 0) < supply.min - 1e-9;
          if (!inspect && state === 'frontier') {
            return `Unknown ${n.word.pos ?? 'word'}: click to conquer${
              outside ? ' · outside your supply: won here, it is cut off' : ''
            }`;
          }
          if (!inspect && state === 'claimed') {
            const steps = claimSteps(claims.get(n.id));
            return `Claimed ${steps}/${CLAIM_STEPS}: ${
              attentionOf.get(n.id) === 'ready' ? 'next step ready, click' : 'next step opens soon'
            }`;
          }
          if (!inspect && n.id === answerId) return 'The word you are recalling';
          const h = health.get(n.id);
          const pct = h != null ? ` · recall ${Math.round(h * 100)}%` : '';
          if (!inspect && supply?.broken.has(n.id)) {
            return `Broken: ${shownName(n.id) || '?'} · no supply passes · click to mend it`;
          }
          const cutOff = inspect ? undefined : supply?.cut.get(n.id);
          if (cutOff) {
            const hours = Math.max(1, Math.round((cutOff.until - nowMs) / 3_600_000));
            return `Cut off: ${shownName(n.id) || '?'} · falls back to "?" in ${hours} h unless reconnected`;
          }
          if (!inspect && state === 'conquered' && h != null && h < FULL_NAME) {
            return `Due: ${shownName(n.id) || '?'}${pct} · click to review`;
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
          inspect && !touchesActive(l)
            ? `rgba(148, 170, 220, ${activeId === undefined ? 0.16 : 0.06})`
            : l.hint
              ? 'rgba(251, 191, 36, 0.55)'
              : flow?.links.has(flowKey(endId(l.source), endId(l.target)))
                ? `rgba(${SUPPLY_RGB}, 0.9)` // the selected word's supply comes this way
                : l.via === 'user'
                  ? `rgba(52, 211, 153, ${Math.max(0.5, linkAlpha(l))})` // planted by you
                  : `rgba(${REASON_RGB[l.reason]}, ${linkAlpha(l)})`
        }
        // Strong links are much thicker (and carry more supply).
        // By rank: the closest pairs (ghiaccio-gelato) stand out from mere same-theme ones.
        linkWidth={(l) =>
          inspect
            ? touchesActive(l)
              ? 1.6
              : 0.6 // galaxy view: thin hyperlanes, the selected word's lanes lit
            : l.hint
              ? 0.8
              : // Screen pixels: even the weakest link stays a visible line.
                0.9 +
                3.1 * weightRank(l.weight) ** 2 +
                (touchesActive(l) ? 1 : 0) +
                (flow?.links.has(flowKey(endId(l.source), endId(l.target))) ? 1.2 : 0)
        }
        linkLineDash={(l) =>
          l.hint
            ? [1, 2]
            : l.via === 'user'
              ? [5, 2, 1, 2]
              : isWeakBridge(l) || (l.descends && hidden(endId(l.target)))
                ? [3, 3]
                : null
        }
        linkHoverPrecision={6}
        // A ghost shows the link it will be reached by, not its links to other ghosts.
        linkVisibility={(l) =>
          !l.category &&
          (inspect || !(ghosts?.has(endId(l.source)) && ghosts?.has(endId(l.target))))
        }
        // Keep animating while supply flows; otherwise let the canvas idle.
        autoPauseRedraw={!animate}
        linkCanvasObjectMode={(l) => (isEnergy(l) ? 'after' : undefined)}
        linkCanvasObject={(l, ctx) => drawEnergy(ctx, l)}
        onRenderFramePre={(ctx) => {
          labels.current = [];
          if (inspect) {
            drawStarfield(ctx);
            drawNebulae(ctx, livePoints());
          } else {
            drawBackdrop(ctx);
            drawTerritories(ctx, livePoints(), !!supply);
          }
        }}
        onRenderFramePost={(ctx, scale) => {
          // Names on top, so links and words never cover them.
          const names = drawRegionNames(ctx, scale, livePoints(), inspect);
          drawLabels(ctx, scale, labels.current, names);
          if (flow && !inspect) {
            drawFlow(ctx, scale, flow, nodeCache.current, (id) => {
              const tower = supply?.towers.get(id);
              return tower ? (tower.capital ? 16 : 11) : 0;
            });
          }
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
          if (hit) return jumpTo(hit.id);
          if (cursorId) lastCursor.current = cursorId;
          setCursorId(undefined);
          onBackgroundClick?.();
        }}
        linkLabel={linkTooltip}
        onNodeClick={(n) => {
          const id = n.hintOf ?? n.id; // a hint opens its word
          setCursorId(id);
          onNodeClick(id);
        }}
        maxZoom={4}
        minZoom={minZoom}
        onNodeDragEnd={(n) => {
          // Keep a dragged word where it was dropped (the map stays pinned).
          n.fx = n.x;
          n.fy = n.y;
        }}
        // The whole network is big: it cools slowly to find a better layout.
        d3AlphaDecay={inspect ? 0.006 : 0.0228}
        warmupTicks={fitted.current ? 0 : 80}
        cooldownTicks={hold.current ? 0 : inspect ? 2500 : 300}
        onEngineTick={() => {
          // The whole network spreads out as it lays out: keep it in view until you
          // take the camera yourself.
          if (inspect && !cameraMoved.current && ++ticks.current % 60 === 0) fitView();
        }}
        onEngineStop={() => {
          // A first layout can trap words in the wrong cluster: send strays home and rerun.
          if (inspect && shakes.current < SHAKES && shake(graphData.nodes)) {
            shakes.current++;
            fg.current?.d3ReheatSimulation();
            return;
          }
          settled.current = true;
          hold.current = false;
          // The camera follows the growing map until you pan or zoom it yourself (F refits).
          if (fitted.current && cameraMoved.current) return;
          fitted.current = true;
          fitView();
        }}
      />
      {/* Darker corners draw the eye to the middle of the map. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.5)_100%)]" />
      {!inspect && attention.length > 0 && (
        <div className="glass absolute right-3 top-3 flex items-center gap-1 rounded-full px-1.5 py-1 text-xs">
          {ATTENTION_ORDER.map((k) => {
            const n = attention.filter((a) => a.kind === k).length;
            if (!n) return null;
            return (
              <button
                key={k}
                onClick={() => jumpNext(k)}
                title={`Jump to the next ${ATTENTION_LABEL[k]} word`}
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 hover:bg-white/[0.08]"
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
        </div>
      )}
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
    // Newly revealed words are many and not urgent: the jump bar counts them.
    if (!kind || kind === 'new' || n?.x === undefined || n.y === undefined) continue;
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

/** A root hub: a pink hexagon. Returns its label lines (root, meaning, English cousins). */
function drawHub(
  ctx: CanvasRenderingContext2D,
  node: N,
  x: number,
  y: number,
  scale: number,
  active: boolean,
  unlocked: boolean,
  /** Galaxy view: a small marker, named only when zoomed in (or selected). */
  compact = false,
  /** Sealed: how far it is from opening (0..1). */
  charge?: number,
): LabelLine[] {
  const small = compact && !active && scale < 1.6;
  const r = small ? 3.5 : 7;
  if (!small) softGlow(ctx, x, y, r * 0.5, r + 9, '244, 114, 182', unlocked ? 0.32 : 0.12);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = unlocked
    ? orbGradient(ctx, x, y, r, '236, 72, 153', 0.6)
    : 'rgba(244, 114, 182, 0.1)';
  ctx.fill();
  if (!unlocked) ctx.setLineDash([2, 1.5]); // sealed: opens once its words are in reach
  ctx.strokeStyle = active ? '#f8fafc' : 'rgba(249, 168, 212, 0.9)';
  ctx.lineWidth = active ? 1.5 : 1;
  ctx.stroke();
  ctx.setLineDash([]);
  if (!unlocked && charge !== undefined && !small) {
    // Charging: the ring fills as more of its words come into reach.
    ctx.beginPath();
    ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.min(1, charge) * 2 * Math.PI);
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  if (small) return [];
  const lines: LabelLine[] = [
    {
      text: unlocked ? node.word.it : `${node.word.it} ?`,
      px: 12.5,
      rgb: '251, 207, 232',
      alpha: 0.95,
      latin: true,
    },
  ];
  if (!unlocked) return lines;
  if (node.word.en) {
    lines.push({ text: `“${node.word.en}”`, px: 9, rgb: '251, 207, 232', alpha: 0.65 });
  }
  const english = node.hub?.english ?? [];
  if (english.length) {
    lines.push({
      text: `≈ ${english.slice(0, 3).join(' · ')}`,
      px: 9,
      rgb: '226, 232, 240',
      alpha: 0.55,
    });
  }
  return lines;
}

type ViewName = 'map' | 'network';
/** A view's layout: where its words were (and pins), and the camera. */
type SavedView = {
  pos: Map<string, [number, number, number | undefined, number | undefined]>;
  camera?: { x: number; y: number; k: number };
  /** The player had moved the camera (so it isn't refitted as the map grows). */
  moved: boolean;
  /** Its layout had finished. */
  settled: boolean;
};

function saveView(
  nodes: Map<string, N>,
  shown: Set<string>,
  cam: ForceGraphMethods<N, L> | undefined,
  moved: boolean,
  settled: boolean,
): SavedView {
  const pos: SavedView['pos'] = new Map();
  for (const id of shown) {
    const n = nodes.get(id);
    if (n?.x !== undefined && n.y !== undefined) pos.set(id, [n.x, n.y, n.fx, n.fy]);
  }
  const camera = cam ? { ...cam.centerAt(), k: cam.zoom() } : undefined;
  return { pos, camera, moved, settled };
}

/** Rounds of `shake` the whole network gets after settling. */
const SHAKES = 3;

/**
 * Words stuck far from their region (more than twice its spread from its
 * centre) jump back next to the centre, and everything gets a small nudge, so
 * the next run can leave a local optimum. Returns whether any word was stray.
 */
function shake(nodes: N[]): boolean {
  const groups = new Map<number, N[]>();
  for (const n of nodes) {
    const r = n.hub || n.hintOf ? null : n.word?.region;
    if (r == null || n.x === undefined || n.y === undefined) continue;
    groups.set(r, [...(groups.get(r) ?? []), n]);
  }
  let strays = 0;
  for (const members of groups.values()) {
    const cx = members.reduce((a, n) => a + n.x!, 0) / members.length;
    const cy = members.reduce((a, n) => a + n.y!, 0) / members.length;
    const dist = members.map((n) => Math.hypot(n.x! - cx, n.y! - cy));
    const spread = dist.reduce((a, d) => a + d, 0) / members.length || 1;
    members.forEach((n, i) => {
      if (dist[i] <= 2 * spread || n.fx !== undefined) return;
      n.x = cx + (Math.random() - 0.5) * spread;
      n.y = cy + (Math.random() - 0.5) * spread;
      strays++;
    });
  }
  for (const n of nodes) {
    if (n.fx !== undefined || n.x === undefined) continue;
    n.x += (Math.random() - 0.5) * 20;
    n.y! += (Math.random() - 0.5) * 20;
  }
  return strays > 0;
}

/**
 * Keeps categories together and apart: pulls each word towards its region's
 * centre, and pushes regions whose circles overlap away from each other, so
 * territories and their names don't pile up. Words without a region (hubs,
 * hints, independent words) are left to the other forces.
 */
function clusterForce(pull = 0.05, gap = 60) {
  let nodes: N[] = [];
  const force = (alpha: number) => {
    const groups = new Map<number, { x: number; y: number; members: N[] }>();
    for (const n of nodes) {
      const r = n.hub || n.hintOf ? null : n.word?.region;
      if (r == null || n.x === undefined || n.y === undefined) continue;
      const g = groups.get(r) ?? { x: 0, y: 0, members: [] };
      g.x += n.x;
      g.y += n.y;
      g.members.push(n);
      groups.set(r, g);
    }
    const list = [...groups.values()].map((g) => ({
      ...g,
      cx: g.x / g.members.length,
      cy: g.y / g.members.length,
      radius: 24 * Math.sqrt(g.members.length) + 30,
    }));
    for (const g of list) {
      for (const m of g.members) {
        m.vx = (m.vx ?? 0) + (g.cx - m.x!) * pull * alpha;
        m.vy = (m.vy ?? 0) + (g.cy - m.y!) * pull * alpha;
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]];
        let dx = b.cx - a.cx;
        let dy = b.cy - a.cy;
        const d = Math.hypot(dx, dy) || 1;
        const min = a.radius + b.radius + gap;
        if (d >= min) continue;
        dx /= d;
        dy /= d;
        const push = (min - d) * 0.15 * alpha;
        for (const m of a.members) {
          m.vx = (m.vx ?? 0) - dx * push;
          m.vy = (m.vy ?? 0) - dy * push;
        }
        for (const m of b.members) {
          m.vx = (m.vx ?? 0) + dx * push;
          m.vy = (m.vy ?? 0) + dy * push;
        }
      }
    }
  };
  force.initialize = (ns: N[]) => {
    nodes = ns;
  };
  return force;
}

type Territory = {
  name: string;
  color: string;
  /** Its topic's level ("A1.2"), drawn small under the name. */
  level?: string;
  /** Per word: x, y, territory radius, and how brightly supply lights its ground (0..1). */
  pts: (readonly [number, number, number, number])[];
};

/** Device pixels per CSS pixel of the map canvas. */
const dprOf = (ctx: CanvasRenderingContext2D) =>
  Math.max(1, ctx.canvas.width / (ctx.canvas.clientWidth || ctx.canvas.width));

/** Where a word's territory ends: a lone word's reaches 0.6 × its field radius. */
const TERRITORY_EDGE = levelAt(0.6);
/** Denser ground inside: contour lines towards a territory's core, like a relief map. */
const TERRACES = [TERRITORY_EDGE * 3, TERRITORY_EDGE * 7];

/**
 * A region's words as soft circles in device pixels, and the part of the view
 * (plus a margin, so borders cut by the edge still close off screen) they cover.
 */
function screenBlobs(ctx: CanvasRenderingContext2D, t: Territory, spread: number, margin: number) {
  const T = ctx.getTransform();
  const s = Math.hypot(T.a, T.b);
  const blobs: Blob[] = [];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y, r, w] of t.pts) {
    const b = { x: T.a * x + T.c * y + T.e, y: T.b * x + T.d * y + T.f, r: spread * r * s, w };
    blobs.push(b);
    x0 = Math.min(x0, b.x - b.r);
    y0 = Math.min(y0, b.y - b.r);
    x1 = Math.max(x1, b.x + b.r);
    y1 = Math.max(y1, b.y + b.r);
  }
  const { width: W, height: H } = ctx.canvas;
  const bounds = {
    x0: Math.max(x0, -margin),
    y0: Math.max(y0, -margin),
    x1: Math.min(x1, W + margin),
    y1: Math.min(y1, H + margin),
  };
  return { blobs, bounds, empty: bounds.x0 >= bounds.x1 || bounds.y0 >= bounds.y1 };
}

/** Buffers for the supply light on the territories: one sample per territory grid point. */
const lightCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
let lightSum = new Float32Array(0);
let lightClear = new Float32Array(0);
/** The light on fully supplied ground (alpha); ground with no supply keeps the plain wash. */
const LIGHT_MAX = 0.6;
/**
 * The light fades in from the border over this much field, so it never spills
 * past the rim and gathers around the words rather than filling the fringe.
 */
const LIGHT_RAMP = 2.5 * TERRITORY_EDGE;
/** Under the light the plain wash is fainter: how bright ground is is supply's to say. */
const LIT_WASH = 0.35;

/**
 * Territories: every word spreads a soft field in its region's colour (wider
 * for practised words); where fields overlap they add up, and the contour at
 * TERRITORY_EDGE is the border. Contours are traced as vector paths at full
 * resolution: a faint wash, terraces towards dense cores, a glow along the
 * border and a crisp rim.
 *
 * `lit`: supply lights the ground. Each point of a territory takes the supply
 * of the words whose ground it is (their average, each by its pull there), so
 * well-supplied words stand on bright ground, the thin fringe on dim ground and
 * cut-off pockets on the bare wash. The light is summed on the contour grid into
 * a small image the browser scales up, under the terrace lines and the rim.
 */
function drawTerritories(ctx: CanvasRenderingContext2D, regions: Territory[], lit: boolean) {
  const { width: W, height: H } = ctx.canvas;
  if (!W || !H) return;
  const dpr = dprOf(ctx);
  // About 4 CSS px per sample, coarser on huge canvases (the curves hide the grid).
  const cell = Math.max(4 * dpr, Math.sqrt((W * H) / 90000));
  // Read the map transform before drawing in device pixels.
  const blobsOf = regions.map((t) => screenBlobs(ctx, t, 2, 3 * cell));
  const lctx = lit ? lightCanvas?.getContext('2d') : null;
  const cols = Math.ceil(W / cell) + 2;
  const rows = Math.ceil(H / cell) + 2;
  if (lctx) {
    if (lightClear.length < cols * rows) {
      lightSum = new Float32Array(cols * rows * 4);
      lightClear = new Float32Array(cols * rows);
    }
    lightSum.fill(0, 0, cols * rows * 4);
    lightClear.fill(1, 0, cols * rows);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineJoin = 'round';
  const shapes: { c: string; outline: Path2D; terraces: Path2D[] }[] = [];
  regions.forEach((t, k) => {
    const { blobs, bounds, empty } = blobsOf[k];
    if (empty || !blobs.length) return;
    // On the light's grid: sample (i, j) of the field is the light's (ox + i, oy + j).
    const ox = Math.floor(bounds.x0 / cell);
    const oy = Math.floor(bounds.y0 / cell);
    const grid = { ...bounds, x0: ox * cell, y0: oy * cell };
    const field = densityField(blobs, grid, cell, true, !!lctx);
    const edge = isoLines(field, TERRITORY_EDGE);
    if (!edge.length) return;
    const c = t.color;
    const outline = new Path2D();
    traceLoops(outline, edge);
    const wash = lctx ? LIT_WASH : 1;
    ctx.fillStyle = `rgba(${c}, ${0.07 * wash})`;
    ctx.fill(outline, 'evenodd');
    const terraces: Path2D[] = [];
    for (const level of TERRACES) {
      const loops = isoLines(field, level);
      if (!loops.length) break;
      const p = new Path2D();
      traceLoops(p, loops);
      ctx.fillStyle = `rgba(${c}, ${0.045 * wash})`;
      ctx.fill(p, 'evenodd');
      terraces.push(p);
    }
    shapes.push({ c, outline, terraces });
    if (!lctx || !field.w) return;
    // The region's own colour, lifted towards white: the ground brightens, it keeps its hue.
    const [r, g, b] = mixRgb(c, '255, 255, 255', 0.4).split(',').map(Number);
    for (let j = 0; j < field.rows; j++) {
      const gj = oy + j;
      if (gj < 0) continue;
      if (gj >= rows) break;
      for (let i = 0; i < field.cols; i++) {
        const gi = ox + i;
        if (gi < 0) continue;
        if (gi >= cols) break;
        const f = j * field.cols + i;
        const d = field.v[f];
        if (d <= TERRITORY_EDGE) continue;
        const supplied = field.w[f] / d;
        if (supplied < 0.005) continue;
        const m = Math.min(1, (d - TERRITORY_EDGE) / LIGHT_RAMP);
        const a = LIGHT_MAX * Math.min(1, supplied) * m * m * (3 - 2 * m);
        const q = gj * cols + gi;
        lightSum[4 * q] += a * r;
        lightSum[4 * q + 1] += a * g;
        lightSum[4 * q + 2] += a * b;
        lightSum[4 * q + 3] += a;
        lightClear[q] *= 1 - a;
      }
    }
  });
  if (lctx && lightCanvas) {
    if (lightCanvas.width !== cols || lightCanvas.height !== rows) {
      lightCanvas.width = cols;
      lightCanvas.height = rows;
    }
    const img = lctx.createImageData(cols, rows);
    const px = img.data;
    for (let q = 0; q < cols * rows; q++) {
      const sum = lightSum[4 * q + 3];
      if (sum <= 0) continue;
      // Where regions overlap, their colours mix by how much light each brings.
      px[4 * q] = lightSum[4 * q] / sum;
      px[4 * q + 1] = lightSum[4 * q + 1] / sum;
      px[4 * q + 2] = lightSum[4 * q + 2] / sum;
      px[4 * q + 3] = 255 * (1 - lightClear[q]);
    }
    lctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'screen';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Grid point i sits at i·cell: centre the image's pixels on them.
    ctx.drawImage(lightCanvas, -cell / 2, -cell / 2, cols * cell, rows * cell);
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const { c, outline, terraces } of shapes) {
    for (const p of terraces) {
      ctx.strokeStyle = `rgba(${c}, 0.2)`;
      ctx.lineWidth = 0.8 * dpr;
      ctx.stroke(p);
    }
    // A glow along the border (no clip: clipping to curved paths is costly per frame).
    ctx.strokeStyle = `rgba(${c}, 0.08)`;
    ctx.lineWidth = 14 * dpr;
    ctx.stroke(outline);
    ctx.strokeStyle = `rgba(${c}, 0.14)`;
    ctx.lineWidth = 5 * dpr;
    ctx.stroke(outline);
    ctx.strokeStyle = `rgba(${mixRgb(c, '255, 255, 255', 0.25)}, 0.85)`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke(outline);
  }
  ctx.restore();
}

/** Low-resolution buffers for the nebulae (smooth by nature, so upscaling can't show). */
const nebulaCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
let nebulaSum = new Float32Array(0);
let nebulaClear = new Float32Array(0);

/**
 * Galaxy view: each category a glowing nebula in its colour, brighter where its
 * stars crowd. The field is summed on a coarse grid into a small image, which
 * the browser scales up smoothly.
 */
function drawNebulae(ctx: CanvasRenderingContext2D, regions: Territory[]) {
  const { width: W, height: H } = ctx.canvas;
  const octx = nebulaCanvas?.getContext('2d');
  if (!nebulaCanvas || !octx || !W || !H) return;
  const dpr = dprOf(ctx);
  const cell = 6 * dpr;
  const cols = Math.ceil(W / cell) + 2;
  const rows = Math.ceil(H / cell) + 2;
  const n = cols * rows;
  if (nebulaClear.length < n) {
    nebulaSum = new Float32Array(n * 4);
    nebulaClear = new Float32Array(n);
  }
  nebulaSum.fill(0, 0, n * 4);
  nebulaClear.fill(1, 0, n);
  for (const t of regions) {
    const { blobs, bounds, empty } = screenBlobs(ctx, t, 3.6, cell);
    if (empty || !blobs.length) continue;
    // Align the region's grid with the image grid.
    const gx0 = Math.max(0, Math.floor(bounds.x0 / cell) - 1);
    const gy0 = Math.max(0, Math.floor(bounds.y0 / cell) - 1);
    const gx1 = Math.min(cols - 1, Math.ceil(bounds.x1 / cell) + 1);
    const gy1 = Math.min(rows - 1, Math.ceil(bounds.y1 / cell) + 1);
    if (gx0 >= gx1 || gy0 >= gy1) continue;
    const f = densityField(
      blobs,
      { x0: gx0 * cell, y0: gy0 * cell, x1: gx1 * cell, y1: gy1 * cell },
      cell,
      true,
    );
    const [cr, cg, cb] = t.color.split(',').map(Number);
    for (let j = 0; j < f.rows; j++) {
      const gj = gy0 + j;
      if (gj >= rows) break;
      for (let i = 0; i < f.cols; i++) {
        const d = f.v[j * f.cols + i];
        if (d < 0.002) continue;
        const gi = gx0 + i;
        if (gi >= cols) break;
        const a = 0.62 * (1 - Math.exp(-1.2 * d));
        const k = gj * cols + gi;
        nebulaSum[4 * k] += a * cr;
        nebulaSum[4 * k + 1] += a * cg;
        nebulaSum[4 * k + 2] += a * cb;
        nebulaSum[4 * k + 3] += a;
        nebulaClear[k] *= 1 - a;
      }
    }
  }
  if (nebulaCanvas.width !== cols || nebulaCanvas.height !== rows) {
    nebulaCanvas.width = cols;
    nebulaCanvas.height = rows;
  }
  const img = octx.createImageData(cols, rows);
  const px = img.data;
  for (let k = 0; k < n; k++) {
    const a = nebulaSum[4 * k + 3];
    if (a <= 0) continue;
    px[4 * k] = nebulaSum[4 * k] / a;
    px[4 * k + 1] = nebulaSum[4 * k + 1] / a;
    px[4 * k + 2] = nebulaSum[4 * k + 2] / a;
    px[4 * k + 3] = 255 * (1 - nebulaClear[k]);
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Grid point i sits at i·cell: centre the image's pixels on them.
  ctx.drawImage(nebulaCanvas, -cell / 2, -cell / 2, cols * cell, rows * cell);
  ctx.restore();
}

/** A dot for the backdrop grid, redrawn only when its spacing changes. */
const gridTile = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/**
 * Territory view: a faint grid of dots fixed to the map, so panning and zooming
 * feel like moving over ground. Dots stay 22–44 px apart at any zoom.
 */
function drawBackdrop(ctx: CanvasRenderingContext2D) {
  const tctx = gridTile?.getContext('2d');
  if (!gridTile || !tctx) return;
  const T = ctx.getTransform();
  const s = Math.hypot(T.a, T.b);
  const dpr = dprOf(ctx);
  let step = 40; // map units
  while (step * s < 22 * dpr) step *= 2;
  const size = Math.max(4, Math.round(step * s));
  if (gridTile.width !== size) {
    gridTile.width = gridTile.height = size;
    tctx.fillStyle = 'rgba(148, 163, 184, 1)';
    tctx.beginPath();
    tctx.arc(size / 2, size / 2, 0.9 * dpr, 0, 2 * Math.PI);
    tctx.fill();
  }
  const pattern = ctx.createPattern(gridTile, 'repeat');
  if (!pattern) return;
  const k = (step * s) / size;
  pattern.setTransform(new DOMMatrix([k, 0, 0, k, T.e - (size * k) / 2, T.f - (size * k) / 2]));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Sparser dots fade in as they come, so doubling the step doesn't pop.
  ctx.globalAlpha = 0.07 + 0.05 * Math.min(1, (step * s) / (40 * dpr) - 0.55);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/**
 * Region names: big, letter-spaced Roman capitals (Cinzel) on a dark halo with
 * a glow in the region's colour, so they read over anything. Bold when zoomed
 * out, faint when zoomed in on words.
 */
function drawRegionNames(
  ctx: CanvasRenderingContext2D,
  scale: number,
  regions: Territory[],
  galaxy = false,
) {
  const alpha = Math.min(galaxy ? 0.95 : 0.9, Math.max(0.12, 1.1 - 0.45 * scale));
  const dpr = dprOf(ctx);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  // Bigger territories claim their spot first; a name that would overlap one
  // already placed is nudged above or below it.
  const placed: Box[] = [];
  const hits = (b: Box) =>
    placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
  for (const t of [...regions].sort((a, b) => b.pts.length - a.pts.length)) {
    if (!t.name || !t.pts.length) continue;
    const cx = t.pts.reduce((a, p) => a + p[0], 0) / t.pts.length;
    let cy = t.pts.reduce((a, p) => a + p[1], 0) / t.pts.length;
    // Screen pixels; the whole network zoomed far out gets smaller names.
    const px =
      Math.min(26, Math.max(13, 9 + 2.5 * Math.sqrt(t.pts.length))) *
      (galaxy ? Math.min(1, Math.max(0.65, scale / 0.15)) : 1);
    const text = t.name.toUpperCase();
    ctx.font = `${galaxy ? 600 : 700} ${px / scale}px ${FONT_TITLE}`;
    c.letterSpacing = `${(px * (galaxy ? 0.3 : 0.14)) / scale}px`;
    const half = ctx.measureText(text).width / 2;
    const lh = (px * 1.25) / scale;
    const box = (y: number) => ({ x0: cx - half, x1: cx + half, y0: y - lh / 2, y1: y + lh / 2 });
    const dy = [0, 1, -1, 2, -2, 3, -3].find((d) => !hits(box(cy + d * lh)));
    // No room in the whole network: leave the name out (zooming in brings it back).
    if (dy === undefined && galaxy) continue;
    cy += (dy ?? 0) * lh;
    placed.push(box(cy));
    const rgb = t.color;
    const a = alpha;
    ctx.lineWidth = 5 / scale;
    ctx.strokeStyle = `rgba(1, 3, 11, ${0.7 * a})`;
    ctx.strokeText(text, cx, cy);
    ctx.shadowColor = `rgba(${rgb}, ${0.55 * a})`;
    ctx.shadowBlur = 14 * dpr;
    ctx.fillStyle = `rgba(${mixRgb(rgb, '255, 255, 255', 0.12)}, ${a})`;
    ctx.fillText(text, cx, cy);
    ctx.shadowBlur = 0;
    if (t.level) {
      // The topic's own level, in its band's colour, tucked under the name.
      const sub = Math.max(10, px * 0.5);
      ctx.font = `700 ${sub / scale}px ${FONT_TITLE}`;
      c.letterSpacing = `${(sub * 0.12) / scale}px`;
      const y = cy + (px * 0.55 + sub * 0.6) / scale;
      ctx.lineWidth = 4 / scale;
      ctx.strokeText(t.level, cx, y);
      ctx.fillStyle = `rgba(${levelRgb(t.level)}, ${a})`;
      ctx.fillText(t.level, cx, y);
    }
  }
  ctx.restore();
  // While bold, the names are in the way of word labels (see drawLabels).
  return alpha > 0.4 ? placed : [];
}

/**
 * The capital or a stronghold: a crenellated gold tower of height `h` standing on (x, y + h/2),
 * with a pennant in `rgb`.
 */
function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, rgb: string) {
  const w = h * 0.62;
  const top = y - h / 2;
  const base = y + h / 2;
  const m = w / 5; // merlon width
  softGlow(ctx, x, y, 0, h * 1.2, '252, 211, 77', 0.28);
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - h * 0.05, base);
  // Along the top: merlons (even) and gaps (odd), left to right.
  for (let i = 0; i < 5; i++) {
    const yy = i % 2 ? top + m : top;
    ctx.lineTo(x - w / 2 + i * m, yy);
    ctx.lineTo(x - w / 2 + (i + 1) * m, yy);
  }
  ctx.lineTo(x + w / 2 + h * 0.05, base);
  ctx.closePath();
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, '#fde68a');
  g.addColorStop(0.55, '#fbbf24');
  g.addColorStop(1, '#b45309');
  ctx.fillStyle = g;
  ctx.strokeStyle = 'rgba(1, 3, 11, 0.85)';
  ctx.lineWidth = h / 14;
  ctx.stroke();
  ctx.fill();
  // The door and a window slit.
  ctx.fillStyle = 'rgba(69, 26, 3, 0.9)';
  ctx.beginPath();
  ctx.moveTo(x - w / 7, base);
  ctx.lineTo(x - w / 7, base - h * 0.22);
  ctx.arc(x, base - h * 0.22, w / 7, Math.PI, 0);
  ctx.lineTo(x + w / 7, base);
  ctx.fill();
  ctx.fillRect(x - w / 24, top + m * 1.9, w / 12, h * 0.16);
  // The pennant.
  ctx.strokeStyle = 'rgba(253, 230, 138, 0.95)';
  ctx.lineWidth = h / 28;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top - h * 0.42);
  ctx.stroke();
  ctx.fillStyle = `rgba(${rgb}, 0.95)`;
  ctx.beginPath();
  ctx.moveTo(x, top - h * 0.42);
  ctx.lineTo(x + h * 0.34, top - h * 0.33);
  ctx.lineTo(x, top - h * 0.24);
  ctx.closePath();
  ctx.fill();
}

/** Far stars behind the galaxy view, in three layers that drift at different speeds. */
const STARFIELD = Array.from({ length: 300 }, (_, i) => {
  const r = (k: number) => {
    const v = Math.sin(i * 78.233 + k * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  const layer = i % 3;
  return {
    x: r(0),
    y: r(1),
    layer,
    size: (0.35 + r(2) * 0.6) * (1 + layer * 0.45),
    alpha: 0.12 + r(3) * 0.45 + layer * 0.08,
    warm: r(4) > 0.8,
  };
});
/** How much each starfield layer follows the camera (parallax). */
const STAR_DEPTH = [0.015, 0.04, 0.09];

function drawStarfield(ctx: CanvasRenderingContext2D) {
  const { width: W, height: H } = ctx.canvas;
  const T = ctx.getTransform();
  const dpr = dprOf(ctx);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const wrap = (v: number, m: number) => ((v % m) + m) % m;
  for (const s of STARFIELD) {
    const d = STAR_DEPTH[s.layer];
    const x = wrap(s.x * W + T.e * d, W);
    const y = wrap(s.y * H + T.f * d, H);
    ctx.fillStyle = s.warm ? `rgba(255, 228, 196, ${s.alpha})` : `rgba(220, 230, 255, ${s.alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, s.size * dpr, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

/** A word in the galaxy view: a glowing star. Returns its glow radius (for the label). */
function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  rgb: string,
  { active, linked }: { active: boolean; linked: boolean },
) {
  // Stars shrink slower than the map, and never below about a pixel.
  const core = Math.max((active ? 3 : 1.8) / Math.sqrt(scale), 1.1 / scale);
  const glow = core * (active ? 5 : 3.4);
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
  g.addColorStop(0, `rgba(${rgb}, ${active || linked ? 0.9 : 0.6})`);
  g.addColorStop(0.35, `rgba(${rgb}, ${active || linked ? 0.35 : 0.2})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, glow, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = active ? '#ffffff' : `rgba(${mixRgb(rgb, '255, 255, 255', 0.75)}, 0.95)`;
  ctx.beginPath();
  ctx.arc(x, y, core, 0, 2 * Math.PI);
  ctx.fill();
  if (active) {
    // A four-pointed glint on the selected star.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = core * 0.35;
    ctx.beginPath();
    ctx.moveTo(x - glow * 1.2, y);
    ctx.lineTo(x + glow * 1.2, y);
    ctx.moveTo(x, y - glow * 1.2);
    ctx.lineTo(x, y + glow * 1.2);
    ctx.stroke();
  }
  ctx.restore();
  return glow;
}

type Box = { x0: number; x1: number; y0: number; y1: number };

/** A line of a word's label; `px` is its size on screen. */
type LabelLine = {
  text: string;
  px: number;
  rgb: string;
  alpha: number;
  weight?: number;
  /** Latin roots and English cousins: an italic book face. */
  latin?: boolean;
};
/** A label under a word (x, y: its top centre in map units), placed by priority. */
type Label = { x: number; y: number; lines: LabelLine[]; fade: number; priority: number };

const labelFont = (l: LabelLine, scale: number) => {
  // Constant size on screen, except far zoomed in, where names grow with the map.
  const size = Math.max(l.px * 0.27, l.px / scale);
  return l.latin
    ? `italic 600 ${size * 1.15}px ${FONT_LATIN}`
    : `${l.weight ?? 500} ${size}px ${FONT_UI}`;
};

/**
 * Word names, drawn after everything so links and words never cover them, each
 * on a dark halo. The most important go first (the selected word, then stronger
 * words); a name that would overlap one already placed is left out, so a
 * crowded map zoomed out shows fewer names instead of a smudge.
 */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  scale: number,
  labels: Label[],
  /** Space already taken (region names). */
  taken: Box[] = [],
) {
  const placed = [...taken];
  const pad = 3 / scale;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  for (const l of [...labels].sort((a, b) => b.priority - a.priority)) {
    let w = 0;
    const heights = l.lines.map((line) => {
      ctx.font = labelFont(line, scale);
      w = Math.max(w, ctx.measureText(line.text).width);
      return Math.max(line.px * 0.27, line.px / scale) * 1.2;
    });
    const box = {
      x0: l.x - w / 2 - pad,
      x1: l.x + w / 2 + pad,
      y0: l.y,
      y1: l.y + heights.reduce((a, b) => a + b, 0),
    };
    if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) {
      continue;
    }
    placed.push(box);
    let y = l.y;
    l.lines.forEach((line, i) => {
      const a = line.alpha * l.fade;
      ctx.font = labelFont(line, scale);
      ctx.lineWidth = heights[i] * 0.28;
      ctx.strokeStyle = `rgba(2, 6, 23, ${0.8 * a})`;
      ctx.strokeText(line.text, l.x, y);
      ctx.fillStyle = `rgba(${line.rgb}, ${a})`;
      ctx.fillText(line.text, l.x, y);
      y += heights[i];
    });
  }
  ctx.restore();
}

/** A radial glow: full `alpha` at r0, gone at r1. */
function softGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r0: number,
  r1: number,
  rgb: string,
  alpha: number,
) {
  if (alpha <= 0.01 || r1 <= r0) return;
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  g.addColorStop(0.4, `rgba(${rgb}, ${alpha * 0.4})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r1, 0, 2 * Math.PI);
  ctx.fill();
}

/** A lit sphere in `rgb`: a highlight up and left, a darker rim. */
function orbGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rgb: string,
  alpha: number,
) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r * 1.3);
  g.addColorStop(0, `rgba(${mixRgb(rgb, '255, 255, 255', 0.6)}, ${alpha})`);
  g.addColorStop(0.45, `rgba(${rgb}, ${alpha})`);
  g.addColorStop(1, `rgba(${mixRgb(rgb, '2, 6, 23', 0.55)}, ${alpha})`);
  return g;
}

/** A glyph ("?") centred in a word's shape (triangles sit lower). */
function glyph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  shape: Shape,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.font = `700 8px ${FONT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + (shape === 'triangle' ? 2 : 0.6));
}

/** A small tag above a word (push share, win-back), on a dark halo. */
function badge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  rgb: string,
) {
  ctx.font = `700 ${Math.max(4, 10 / scale)}px ${FONT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 / scale;
  ctx.strokeStyle = 'rgba(2, 6, 23, 0.8)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = `rgba(${rgb}, 0.95)`;
  ctx.fillText(text, x, y);
}

/**
 * The selected word's suppliers: a gold ring and "+N%" (the share each sends
 * it, above its tower if it has one); over the word itself its total against
 * what it needs; a "?" nearby that would help: "+N% if won" in green.
 */
function drawFlow(
  ctx: CanvasRenderingContext2D,
  scale: number,
  flow: FlowView,
  nodes: Map<string, N>,
  /** The height of the tower over a word, if any (map units). */
  tower: (id: string) => number,
) {
  const pct = (v: number) => `+${Math.max(1, Math.round(v * 100))}%`;
  const lift = (id: string) => (tower(id) ? tower(id) * 1.4 + 6 : 0);
  const at = (id: string) => {
    const n = nodes.get(id);
    return n?.x === undefined || n.y === undefined ? null : { x: n.x, y: n.y };
  };
  ctx.save();
  for (const [id, share] of flow.sources) {
    const p = at(id);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(${SUPPLY_RGB}, 0.85)`;
    ctx.lineWidth = Math.max(1.2, 1.6 / scale);
    ctx.stroke();
    badge(ctx, share > 0 ? `+${share}%` : '+<1%', p.x, p.y - 15 - lift(id), scale, SUPPLY_LIGHT);
  }
  const t = at(flow.target);
  if (t && flow.total) {
    // The sum of the badges, against what the word needs to count.
    const { pct: total, needs } = flow.total;
    const y = t.y - 12 - 24 / scale - lift(flow.target);
    // With far suppliers summed up, their line goes under the total.
    badge(
      ctx,
      `${total}% of ${needs}%`,
      t.x,
      flow.others ? y - 13 / scale : y,
      scale,
      total >= needs ? SUPPLY_LIGHT : '251, 146, 60',
    );
    if (flow.others) {
      const { pct: rest, count } = flow.others;
      badge(ctx, `incl. ${rest}% from ${count} farther words`, t.x, y, scale, '148, 163, 184');
    }
  }
  for (const [id, gain] of flow.gains) {
    const p = at(id);
    if (p) badge(ctx, `${pct(gain)} if won`, p.x, p.y - 15, scale, '134, 239, 172');
  }
  ctx.restore();
}

/** A glowing chevron pointing along the link: the direction influence travels. */
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

/** A bought hint: a small amber dot tied to its word (the cousin is its label). */
function drawHint(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const r = 3;
  softGlow(ctx, x, y, r * 0.5, r + 5, '251, 191, 36', 0.3);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = orbGradient(ctx, x, y, r, '251, 191, 36', 0.55);
  ctx.fill();
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}
