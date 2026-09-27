"""Build the app's graph from the vocabulary folder (data/vocab/*.yaml).

Usage:
    python pipeline/build_vocab.py data/vocab -o data/graph_oic.json [--enrich]

Every word belongs to a category (its file), and the links are made so the
map reads sensibly:

  1. inside a category, a tier-respecting spanning tree (every level's words
     hang together) plus each word's two closest partners there;
  2. word families (same stem: la cucina / cucinare; or same root) are linked
     wherever they sit, which bridges categories naturally;
  3. a word links to a word of another category only when their meanings are
     strongly related, at most once per word;
  4. the categories are joined into one map by their strongest bridges, lowest
     levels first, so a new area opens from the start;
  5. hand-made `links` / `unlink` in the vocabulary win.

Rebuilding is not deterministic in layout, but node ids come from the
vocabulary (the Italian's slug or an explicit `id`), so progress is kept.
With --enrich, words without etymology get it from Wiktionary and it is
written back into the vocabulary files (review it there).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import networkx as nx
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_graph as bg  # noqa: E402
import layout  # noqa: E402
import vocab as V  # noqa: E402

TIERS = 10
WITHIN_K = 2  # closest partners linked inside a category
WITHIN_MIN = 0.35
BRIDGE_MIN = 0.62  # rescaled meaning similarity for a link across categories
FAMILY = 0.5  # weight of a family link (same stem or root)
STEM_MIN_SEM = 0.25  # a shared stem only counts when the meanings relate this much
CANDIDATES = 8

PAREN = re.compile(r"\s*\([^)]*\)")


# Small words that only blur a phrase's meaning vector ("to put on make-up").
EMBED_STOP = {"a", "an", "the", "to", "of", "on", "in", "up", "off", "out", "for", "with", "at", "by", "from", "your", "oneself"}


def head(en: str) -> str:
    """The gloss to embed: its first meaning without notes or small words
    ("clubs (card suit)" -> "clubs", "to put on make-up" -> "put make-up")."""
    h = bg.gloss_head(PAREN.sub("", en)) or en
    words = [w for w in h.split() if w not in EMBED_STOP]
    return " ".join(words) or h


def stems(en: str) -> set[str]:
    """First five letters of the content words of every meaning in a gloss, for
    spotting English homographs ("club" / "clubs", "drawing" / "to draw")."""
    words = re.findall(r"[a-z]+", PAREN.sub("", en.lower()))
    return {w[:5] if len(w) > 5 else w.rstrip("s") for w in words if len(w) > 2 and w not in EMBED_STOP}


# English words with several unrelated senses: a meaning vector for them is a
# blend, so they make no trustworthy link to another category ("will" / "can").
AMBIGUOUS = set("""will can may might must so too even still well just right left close show draw bear fine
rest kind mean lie light second watch ring play match present fair spring fall case point order sign mark
free sound set book park bank date letter fire type key note time way line run turn stick trip ball board
change check club cross cut dish fan file glass ground hand head iron land last leave long miss object place
plant port post press row scale seal sink slip square stamp star state step table tap tie tip wave pass lot
count face fit form get hold keep lead let make put stand take""".split())


def assign_tiers(words: list[dict], ranks: dict[str, int], verb_forms: dict, n: int = TIERS) -> list[tuple[int, str]]:
    """(tier, level name) per word: each CEFR level gets a share of the `n` tiers
    proportional to its size, dealt common-first ("A1.1", "A1.2", ...)."""
    import split_levels

    level = [w.get("level") or V.cefr_for_rank(V.word_rank(w, ranks, verb_forms)) for w in words]
    levels = [lvl for lvl in V.CEFR if lvl in level]
    n = max(1, min(n, len(words) // bg.MIN_TIER_SIZE))  # small lists get fewer, fuller tiers
    ks = [min(k, level.count(lvl)) for k, lvl in zip(split_levels.shares([level.count(lvl) for lvl in levels], n), levels)]
    out: list[tuple[int, str]] = [(0, "")] * len(words)
    tier = 0
    for lvl, k in zip(levels, ks):
        idx = sorted((i for i in range(len(words)) if level[i] == lvl), key=lambda i: (V.word_rank(words[i], ranks, verb_forms), words[i]["it"]))
        for part in range(k):
            tier += 1
            for i in idx[len(idx) * part // k : len(idx) * (part + 1) // k]:
                out[i] = (tier, lvl if k == 1 else f"{lvl}.{part + 1}")
    return out


def w_root(w: dict) -> str:
    return bg.root_key(w["root"]) if w.get("root") and w["root"] != "-" else ""


def families(words: list[dict]) -> list[list[int]]:
    """Groups of words sharing a stem or a root (2+ members)."""
    groups: dict[str, list[int]] = {}
    for i, w in enumerate(words):
        s = bg.stem(w["it"])
        if " " not in V.lemma(w["it"]) and len(s) >= bg.MIN_STEM:
            groups.setdefault("stem:" + s, []).append(i)
        if w_root(w):
            groups.setdefault("root:" + w_root(w), []).append(i)
    return [g for g in groups.values() if len(g) > 1]


def build(words: list[dict], embed: bg.Embedder, ranks: dict[str, int], verb_forms: dict,
          english=None, conjugate=None, example=None) -> dict:
    n = len(words)
    ids = [V.node_id(w) for w in words]
    cat = [w["cat"] for w in words]
    tiers_named = assign_tiers(words, ranks, verb_forms)
    tiers = [t for t, _ in tiers_named]

    sem = bg.rescale(bg.cosine_matrix(embed, [head(w["en"]) for w in words]))
    np.fill_diagonal(sem, 0.0)
    # Families: a shared root (curated) always counts; a shared stem only when the
    # meanings relate too (la cucina / cucinare yes, la casa / il caso no).
    same_stem = np.zeros((n, n), dtype=bool)
    same_root = np.zeros((n, n), dtype=bool)
    for grp in families(words):
        for a in grp:
            for b in grp:
                if a == b:
                    continue
                if w_root(words[a]) and w_root(words[a]) == w_root(words[b]):
                    same_root[a, b] = True
                elif bg.stem(words[a]["it"]) == bg.stem(words[b]["it"]) and sem[a, b] >= STEM_MIN_SEM:
                    same_stem[a, b] = True
    fam = (same_stem | same_root).astype(float)
    same_cat = np.array(cat)[:, None] == np.array(cat)[None, :]
    total = np.clip(0.7 * sem + FAMILY * fam + 0.15 * same_cat, 0, None)

    chosen: dict[tuple[int, int], str] = {}

    def add(i: int, j: int, via: str) -> None:
        key = (min(i, j), max(i, j))
        chosen.setdefault(key, via)

    # 1. Inside each category: a skeleton, then the closest partners.
    by_cat: dict[str, list[int]] = {}
    for i, c in enumerate(cat):
        by_cat.setdefault(c, []).append(i)
    for idx in by_cat.values():
        sub = total[np.ix_(idx, idx)]
        for a, b in bg.tiered_spanning_tree(sub, [tiers[i] for i in idx]):
            add(idx[a], idx[b], "tree")
        for a, i in enumerate(idx):
            for b in np.argsort(-sub[a])[:WITHIN_K]:
                if b != a and sub[a, b] >= WITHIN_MIN:
                    add(i, idx[b], "theme")

    # 2. Families: each member links to its closest relative among the more
    # common members (a tree from the most common one).
    for grp in families(words):
        grp = sorted(grp, key=lambda i: (tiers[i], words[i]["it"]))
        for k, b in enumerate(grp[1:], 1):
            kin = [a for a in grp[:k] if fam[a, b]]
            if kin:
                add(max(kin, key=lambda a: sem[a, b]), b, "family")

    # 3. Strong meaning links across categories, one per word. Not between
    # words whose English shares a word: that is often an English homograph
    # (il diritto "right" / la destra "right", il disegno "drawing" / trarre "to draw").
    st = [stems(w["en"]) for w in words]
    shared = np.array([[bool(st[i] & st[j]) for j in range(n)] for i in range(n)])
    cross = np.where(same_cat | shared, 0.0, sem)
    # Direct bridges: same part of speech, and no blurred English meaning.
    pos = np.array([w["pos"] for w in words])
    clear = np.array([head(w["en"]) not in AMBIGUOUS for w in words])
    direct = np.where((pos[:, None] == pos[None, :]) & clear[:, None] & clear[None, :], cross, 0.0)
    for i in range(n):
        j = int(np.argmax(direct[i]))
        if direct[i, j] >= BRIDGE_MIN:
            add(i, j, "bridge")

    # 4. One map: join categories by their best low-level bridges.
    cats = sorted(by_cat)
    cidx = {c: k for k, c in enumerate(cats)}
    parent = list(range(len(cats)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j in chosen:
        ra, rb = find(cidx[cat[i]]), find(cidx[cat[j]])
        if ra != rb:
            parent[ra] = rb
    pairs = []
    for i in range(n):
        for j in np.argsort(-direct[i])[:10]:
            if direct[i, j] > 0:
                pairs.append((max(tiers[i], tiers[j]), -direct[i, j], i, int(j)))
    for _, _, i, j in sorted(pairs):
        ra, rb = find(cidx[cat[i]]), find(cidx[cat[j]])
        if ra != rb:
            parent[ra] = rb
            add(i, j, "bridge")

    # 5. Hand-made links win.
    at = {i_: k for k, i_ in enumerate(ids)} | {w["it"].lower(): k for k, w in enumerate(words)}
    for i, w in enumerate(words):
        for other in w.get("unlink") or []:
            j = at.get(str(other).lower())
            if j is not None:
                chosen.pop((min(i, j), max(i, j)), None)
        for other in w.get("links") or []:
            j = at.get(str(other).lower())
            if j is None:
                raise ValueError(f"{w['it']!r} links to unknown word {other!r}")
            chosen[(min(i, j), max(i, j))] = "manual"

    def reason(i: int, j: int) -> str:
        if same_stem[i, j]:
            return "morphological"
        if same_root[i, j]:
            return "etymological"
        return "thematic" if cat[i] == cat[j] and sem[i, j] < bg.STRONG_SEMANTIC else "semantic"

    def comps(i: int, j: int) -> dict:
        return {
            "semantic": round(float(sem[i, j]), 3),
            "morphological": float(same_stem[i, j]),
            "etymological": float(same_root[i, j]),
            "thematic": float(cat[i] == cat[j]),
        }

    def strength(i: int, j: int) -> float:
        return round(min(1.0, float(total[i, j])), 3)

    edges = [
        {"source": ids[i], "target": ids[j], "weight": strength(i, j), "reason": reason(i, j), "components": comps(i, j), "via": via}
        for (i, j), via in sorted(chosen.items())
    ]
    ranked = np.argsort(-total, axis=1)[:, : CANDIDATES + 1]
    candidates = {
        ids[i]: [
            {"id": ids[j], "weight": strength(i, j), "rank": r + 1, "components": comps(i, j), "linked": (min(i, j), max(i, j)) in chosen}
            for r, j in enumerate(int(j) for j in ranked[i] if j != i)
        ][:CANDIDATES]
        for i in range(n)
    }

    nodes = []
    for i, w in enumerate(words):
        root = w.get("root") if w.get("root") != "-" else None
        node = {
            "id": ids[i],
            "it": w["it"],
            "en": w["en"],
            "pos": w["pos"],
            "theme": V.CATEGORIES[w["cat"]],
            "root": root,
            "root_lang": w.get("root_lang") if root else None,
            "root_meaning": w.get("root_meaning") if root else None,
            "cognate": None if w.get("cousin") in (None, "-") else w["cousin"],
            "cognate_note": None,
            "tier": tiers[i],
            "level": tiers_named[i][1],
        }
        if w.get("pl"):
            node["pl"] = w["pl"]
        nodes.append(node)
    if english:
        bg.add_cognates(nodes, english, embed, only=lambda nd: not words[ids.index(nd["id"])].get("cousin"))
    roots = bg.root_hubs(nodes, english, embed)
    if conjugate:
        for node in nodes:
            if node["pos"] == "verb" and " " not in node["it"]:
                table = conjugate(node["it"])
                if table:
                    node["conjugations"] = table
    if example:
        for node in nodes:
            ex = example(node["it"], node["en"])
            if ex:
                node["example"] = ex

    G = nx.Graph()
    G.add_nodes_from(ids)
    G.add_edges_from((e["source"], e["target"], {"weight": e["weight"]}) for e in edges)
    names = [c for c in V.CATEGORIES if c in by_cat]
    comms = [{ids[i] for i in by_cat[c]} for c in names]
    pos = layout.map_layout(G, comms)
    region_of = {v: k for k, c in enumerate(comms) for v in c}
    adjacency = nx.Graph()
    adjacency.add_nodes_from(range(len(comms)))
    adjacency.add_edges_from((region_of[e["source"]], region_of[e["target"]]) for e in edges)
    adjacency.remove_edges_from(nx.selfloop_edges(adjacency))
    colors = nx.greedy_color(adjacency, strategy="largest_first")
    for node in nodes:
        node["x"], node["y"] = pos[node["id"]]
        node["region"] = region_of[node["id"]]
    regions = [
        {"id": k, "name": V.CATEGORIES[c], "color": colors[k], "words": [ids[i] for i in by_cat[c]]}
        for k, c in enumerate(names)
    ]

    # Start: the best-connected first-level noun.
    degree = np.zeros(n)
    for i, j in chosen:
        if tiers[i] == 1 and tiers[j] == 1:
            degree[i] += 1
            degree[j] += 1
    nouns = np.array([w["pos"] == "noun" for w in words])
    seed = ids[int(np.argmax(degree * nouns))]
    return {
        "seed": seed,
        "params": {
            "model": None,
            "weights": bg.WEIGHTS,
            "source": "vocab",
            "tiers": max(tiers),
            "tier_names": {str(t): name for t, name in sorted(set(tiers_named))},
        },
        "nodes": nodes,
        "edges": edges,
        "roots": roots,
        "regions": regions,
        "candidates": candidates,
    }


def enrich(folder: Path, words: list[dict]) -> int:
    """Look up missing etymology in Wiktionary and write it into the files."""
    import make_wordlist as mw

    lemmas, _ = mw.load_italian(mw.fetch(mw.KAIKKI.format(lang="Italian"), mw.CACHE / "kaikki.org-dictionary-Italian.jsonl.gz"))
    meanings, parent = mw.latin_index(mw.fetch(mw.KAIKKI.format(lang="Latin"), mw.CACHE / "kaikki.org-dictionary-Latin.jsonl.gz"))
    found = 0
    for w in words:
        base = V.lemma(w["it"])
        if w.get("root") or " " in base or base not in lemmas:
            continue
        ety = mw.etymon(max(lemmas[base], key=lambda e: len(e["senses"])), lemmas)
        if not ety:
            continue
        root, lang, gloss = ety
        gloss = mw.short_gloss(gloss, "") if gloss else ""
        if "Latin" in lang:
            top = mw.latin_ancestor(root, parent, meanings)
            if top != root:
                root, gloss = top, ""
            gloss = gloss or meanings.get(mw.plain(root).lstrip("*"), "")
        w.update(root=root, root_lang=lang, root_meaning=gloss or None)
        found += 1
    for c in V.CATEGORIES:
        ws = [w for w in words if w["cat"] == c]
        if ws:
            V.dump_category(folder / f"{c}.yaml", c, ws)
    return found


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("folder")
    p.add_argument("-o", "--out", default="data/graph_oic.json")
    p.add_argument("--model", default=bg.DEFAULT_MODEL)
    p.add_argument("--enrich", action="store_true", help="fill missing etymology from Wiktionary into the files first")
    p.add_argument("--check", action="store_true", help="only validate the vocabulary")
    args = p.parse_args(argv)

    folder = Path(args.folder)
    words = V.load(folder)
    problems = V.validate(words)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    if args.check:
        print(f"{len(words)} words in {len({w['cat'] for w in words})} categories: OK", file=sys.stderr)
        return 0
    if args.enrich:
        print(f"etymology found for {enrich(folder, words)} words", file=sys.stderr)
        words = V.load(folder)

    import conjugate as cj
    import english_roots
    import examples as exm

    ranks = bg.load_frequency_ranks()
    verbs = cj.load_verbs(cj.CACHE / "kaikki.org-dictionary-Italian.jsonl.gz")
    verb_forms = {v: [f for f, _ in e["forms"] if " " not in f] for v, e in verbs.items()}
    index, derived = english_roots.load_index(), english_roots.load_latin_derived()
    graph = build(
        words,
        bg.make_embedder(args.model),
        ranks,
        verb_forms,
        english=lambda root: english_roots.english_for(root, index, derived),
        conjugate=lambda v: cj.conjugations(verbs[v], v) if v in verbs else None,
        example=exm.Examples(exm.load_pairs(), ranks).pick,
    )
    graph["params"]["model"] = args.model
    bg.validate_graph(graph)
    Path(args.out).write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    vias: dict[str, int] = {}
    for e in graph["edges"]:
        vias[e["via"]] = vias.get(e["via"], 0) + 1
    print(
        f"{len(graph['nodes'])} words, {len(graph['edges'])} links {vias}, {len(graph['regions'])} categories, "
        f"{len(graph['roots'])} root hubs, {sum(bool(nd.get('example')) for nd in graph['nodes'])} examples -> {args.out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
