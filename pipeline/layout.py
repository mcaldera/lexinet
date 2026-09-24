"""Fixed map layout: communities become territories, each laid out on its own.

1. Louvain communities on the word graph = regions.
2. Regions are placed as circles (radius ~ sqrt(size)): spring layout of the
   region graph (weighted by links between regions), then overlap removal.
3. Words are laid out inside their region with a local spring layout.
The result is a stable "map": the same word is always in the same place.
"""

from __future__ import annotations

from collections import Counter

import networkx as nx
import numpy as np

SPACING = 22.0  # map units per word-diameter; the app draws nodes ~6 units wide
MIN_REGION = 5  # smaller communities are merged into their best-connected neighbour


def communities(G: nx.Graph, seed: int = 0, resolution: float = 1.0) -> list[set[str]]:
    comms = [set(c) for c in nx.community.louvain_communities(G, weight="weight", resolution=resolution, seed=seed)]
    while len(comms) > 1:
        small = min(range(len(comms)), key=lambda i: len(comms[i]))
        if len(comms[small]) >= MIN_REGION:
            break
        links = Counter()
        for v in comms[small]:
            for u in G[v]:
                for j, c in enumerate(comms):
                    if j != small and u in c:
                        links[j] += G[v][u].get("weight", 1.0)
        target = links.most_common(1)[0][0] if links else (0 if small else 1)
        comms[target] |= comms[small]
        del comms[small]
    return sorted(comms, key=len, reverse=True)


def _separate(centers: np.ndarray, radii: np.ndarray, gap: float, iters: int = 400) -> np.ndarray:
    """Push circles apart until none overlap (keeps the overall arrangement)."""
    c = centers.copy()
    for _ in range(iters):
        moved = False
        for i in range(len(c)):
            d = c[i] - c
            dist = np.linalg.norm(d, axis=1)
            need = radii[i] + radii + gap
            overlap = (dist < need) & (np.arange(len(c)) != i)
            if overlap.any():
                moved = True
                push = d[overlap] / np.maximum(dist[overlap], 1e-6)[:, None] * (need[overlap] - dist[overlap])[:, None]
                c[i] += push.sum(axis=0) * 0.5
        c -= c.mean(axis=0) * 0.01  # mild gravity keeps the map compact
        if not moved:
            break
    return c


def map_layout(G: nx.Graph, comms: list[set[str]], seed: int = 0) -> dict[str, tuple[float, float]]:
    cid = {v: i for i, c in enumerate(comms) for v in c}
    radii = np.array([SPACING * 1.25 * np.sqrt(len(c)) + SPACING for c in comms])

    R = nx.Graph()
    R.add_nodes_from(range(len(comms)))
    for a, b, d in G.edges(data=True):
        i, j = cid[a], cid[b]
        if i != j:
            w = R.get_edge_data(i, j, {"weight": 0.0})["weight"]
            R.add_edge(i, j, weight=w + d.get("weight", 1.0))
    rpos = nx.spring_layout(R, weight="weight", seed=seed, iterations=200) if len(comms) > 1 else {0: np.zeros(2)}
    centers = np.array([rpos[i] for i in range(len(comms))])
    # Scale so the arrangement roughly fits the total area, then remove overlaps.
    spread = np.abs(centers - centers.mean(axis=0)).max() or 1.0
    centers = (centers - centers.mean(axis=0)) / spread * np.sqrt((radii**2).sum()) * 1.2
    centers = _separate(centers, radii, gap=SPACING * 2)

    pos: dict[str, tuple[float, float]] = {}
    for i, c in enumerate(comms):
        sub = G.subgraph(c)
        if len(c) == 1:
            local = {next(iter(c)): np.zeros(2)}
        else:
            # Kamada-Kawai spreads words evenly (no dense cores); fine for region sizes.
            init = nx.spring_layout(sub, weight="weight", seed=seed, iterations=50)
            local = init
            if nx.is_connected(sub):
                with np.errstate(divide="ignore", invalid="ignore"):
                    kk = nx.kamada_kawai_layout(sub, pos=init)
                if np.isfinite(np.array(list(kk.values()))).all():
                    local = kk
        pts = np.array(list(local.values()))
        pts -= pts.mean(axis=0)
        scale = np.abs(pts).max() or 1.0
        pts = pts / scale * (radii[i] - SPACING)
        for v, p in zip(local, pts):
            x, y = centers[i] + p
            pos[v] = (round(float(x), 1), round(float(y), 1))
    return pos


def region_name(members: list[dict], G: nx.Graph) -> str:
    """Dominant theme if clear (>= 40% of words), else the gloss of the most
    central noun (nouns name places better than "certainly" or "to look")."""
    themes = Counter(m["theme"] for m in members if m.get("theme"))
    if themes:
        theme, n = themes.most_common(1)[0]
        if n >= 0.4 * len(members):
            return theme.capitalize()
    ids = {m["id"] for m in members}
    sub = G.subgraph(ids)
    nouns = {m["id"] for m in members if (m.get("pos") or "").lower() == "noun"} or ids
    hub = max(nouns, key=lambda v: (sub.degree(v, weight="weight"), v))
    gloss = next(m["en"] for m in members if m["id"] == hub)
    return gloss.removeprefix("to ").split("/")[0].capitalize()
