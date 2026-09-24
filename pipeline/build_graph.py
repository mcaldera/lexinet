"""Build the Sprawl word graph from a CSV word list.

Usage:
    python pipeline/build_graph.py data/words.csv -o data/graph.json [--seed "il cane"]

Every pair of words gets a score, the weighted sum of four components (each 0..1):

  semantic       meaning association: cosine of ConceptNet Numberbatch vectors of the
                 English gloss ("to" / articles removed), rescaled so a median pair
                 is 0 and the most associated pair is 1. Numberbatch captures
                 association (dog -> bark, bird -> fly); sentence-embedding models
                 like bge-m3 (still available via --model) only capture likeness
                 (dog ~ cat) and scored dog/bark below an average pair.
  morphological  same stem after stripping one ending (parlare/parlato)
  etymological   same `root` column, e.g. Latin coquere (cucina/cuoco)
  thematic       same `theme` column

Tiers: words are ranked by corpus frequency (OpenSubtitles list) and split into
up to 10 tiers of equal size; tier 1 = most common. A `tier` column overrides this.
The app only reveals tier k+1 once most of tiers 1..k are conquered.

Edges: a tier-respecting maximum spanning tree (Kruskal over edges ordered by the
higher tier of their two ends, then strength, so tiers 1..k are always connected
on their own), plus each word's top-k partners scoring above a threshold (adds
loops and clusters). Everything else stays unlinked on purpose: linking every
same-theme pair would turn each theme into a clique.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import unicodedata
from collections.abc import Callable
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

DEFAULT_MODEL = "numberbatch"  # or any sentence-transformers model id, e.g. BAAI/bge-m3
NUMBERBATCH_URL = "https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-en-19.08.txt.gz"
NUMBERBATCH_PATH = Path.home() / ".cache" / "sprawl" / "numberbatch-en-19.08.txt.gz"
WEIGHTS = {"semantic": 0.6, "morphological": 0.25, "etymological": 0.25, "thematic": 0.15}
MIN_STEM = 3  # shortest stem that counts as a morphological link
STRONG_SEMANTIC = 0.45  # rescaled similarity above which meaning, not theme, explains an edge
CANDIDATES = 8  # strongest partners per word exported for the in-app inspector

ARTICLE_RE = re.compile(r"^(il|lo|la|i|gli|le|un|uno|una)\s+|^(l'|un')", re.IGNORECASE)
EN_PREFIX_RE = re.compile(r"^(to|the|a|an)\s+", re.IGNORECASE)
# Infinitive and past-participle endings, else a single final vowel.
ENDING_RE = re.compile(r"(are|ere|ire|at[oaie]|ut[oaie]|it[oaie]|[aeiou])$")

OPTIONAL_COLUMNS = ("pos", "theme", "root", "root_lang", "root_meaning", "cognate", "cognate_note", "tier")
FREQUENCY_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/it/it_50k.txt"
FREQUENCY_PATH = Path.home() / ".cache" / "sprawl" / "it_50k.txt"
MAX_TIERS = 10
MIN_TIER_SIZE = 15

Embedder = Callable[[list[str]], np.ndarray]


def load_words(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    df.columns = [c.strip().lower() for c in df.columns]
    missing = {"italian", "english"} - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing required columns: {sorted(missing)}")
    for col in OPTIONAL_COLUMNS:
        if col not in df.columns:
            df[col] = ""
    df = df[["italian", "english", *OPTIONAL_COLUMNS]].apply(lambda s: s.str.strip())
    df = df[df["italian"] != ""]
    df = df.drop_duplicates(subset="italian", keep="first").reset_index(drop=True)
    if len(df) < 2:
        raise ValueError("Need at least two words to build a graph")
    return df


def lemma(word: str) -> str:
    """Lowercase, strip the article and accents: "l'Uccello" -> "uccello"."""
    word = ARTICLE_RE.sub("", word.strip().lower())
    word = unicodedata.normalize("NFKD", word)
    return "".join(ch for ch in word if not unicodedata.combining(ch))


def root_key(root: str) -> str:
    """Grouping key for roots: "*Pānis" and "panis" are the same root."""
    root = unicodedata.normalize("NFKD", root.strip().lower().lstrip("*"))
    return "".join(ch for ch in root if not unicodedata.combining(ch))


def stem(word: str) -> str:
    """Strip one inflectional ending: "parlato" -> "parl", "la cucina" -> "cucin"."""
    return ENDING_RE.sub("", lemma(word))


def morph_similarity(a: str, b: str) -> float:
    """1.0 when two lemmas share a stem (parlare/parlato, la cena/cenare), else 0.

    Exact stem equality rather than prefix overlap: prefixes give false friends
    like domanda/domani, which share "doman" but no meaning.
    """
    sa, sb = stem(a), stem(b)
    return 1.0 if len(sa) >= MIN_STEM and sa == sb else 0.0


def sentence_transformer_embedder(model_name: str = DEFAULT_MODEL) -> Embedder:
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(model_name)
    return lambda texts: model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


def slug(word: str) -> str:
    """Stable node id from the Italian word: "l'Uccello" -> "l-uccello"."""
    word = unicodedata.normalize("NFKD", word.strip().lower())
    word = "".join(ch for ch in word if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", word).strip("-")


def cosine_matrix(embed: Embedder, texts: list[str]) -> np.ndarray:
    emb = np.asarray(embed(texts), dtype=float)
    emb = emb / np.maximum(np.linalg.norm(emb, axis=1, keepdims=True), 1e-12)
    return emb @ emb.T


def rescale(sim: np.ndarray) -> np.ndarray:
    """Map similarities so the median pair is 0 and the most similar pair is 1.

    Raw cosines of single words sit in a narrow model-specific band; rescaling
    makes weights and thresholds mean the same thing across models and lists.
    """
    off = sim[np.triu_indices(len(sim), 1)]
    lo, hi = np.median(off), off.max()
    return np.clip((sim - lo) / max(hi - lo, 1e-9), 0.0, 1.0)


def numberbatch_embedder(path: Path = NUMBERBATCH_PATH) -> Embedder:
    """ConceptNet Numberbatch (CC BY-SA 4.0) vectors; multi-word glosses use the
    phrase vector if it exists ("look_at"), else the mean of the word vectors."""
    if not path.exists():
        import urllib.request

        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading Numberbatch (~325 MB) to {path} ...", file=sys.stderr)
        urllib.request.urlretrieve(NUMBERBATCH_URL, path)

    def embed(texts: list[str]) -> np.ndarray:
        keys = [t.lower().strip().replace(" ", "_") for t in texts]
        need = set(keys) | {w for t in keys for w in t.split("_")}
        vec: dict[str, np.ndarray] = {}
        with gzip.open(path, "rt", encoding="utf-8") as f:
            next(f)  # header: rows, dims
            for line in f:
                key = line[: line.index(" ")]
                if key in need:
                    vec[key] = np.array(line.split()[1:], dtype=float)
        dims = len(next(iter(vec.values()))) if vec else 300
        out = []
        for text, key in zip(texts, keys):
            parts = [vec[w] for w in key.split("_") if w in vec]
            if key in vec:
                out.append(vec[key])
            elif parts:
                out.append(np.mean(parts, axis=0))
            else:
                print(f"warning: no Numberbatch vector for {text!r}; its meaning score will be 0", file=sys.stderr)
                out.append(np.zeros(dims))
        return np.array(out)

    return embed


def make_embedder(model: str) -> Embedder:
    return numberbatch_embedder() if model == "numberbatch" else sentence_transformer_embedder(model)


def load_frequency_ranks(path: Path = FREQUENCY_PATH) -> dict[str, int]:
    """Word -> rank (1 = most frequent) from a "word count" per line list."""
    if not path.exists():
        import urllib.request

        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(FREQUENCY_URL, path)
    ranks: dict[str, int] = {}
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            word = line.split(" ", 1)[0].strip().lower()
            ranks.setdefault(word, i)
    return ranks


def assign_tiers(df: pd.DataFrame, ranks: dict[str, int], n_tiers: int | None = None) -> list[int]:
    """Tier per word: explicit `tier` column wins, else frequency rank split into equal groups."""
    explicit = [int(t) if str(t).strip().isdigit() else None for t in df["tier"]]
    if all(t is not None for t in explicit):
        return explicit  # type: ignore[return-value]
    n = len(df)
    n_tiers = n_tiers or max(1, min(MAX_TIERS, n // MIN_TIER_SIZE))
    key = [ranks.get(ARTICLE_RE.sub("", w.strip().lower()), 10**9) for w in df["italian"]]
    order = sorted(range(n), key=lambda i: (key[i], i))  # unknown words last, CSV order breaks ties
    size = -(-n // n_tiers)  # ceil
    tiers = [0] * n
    for pos, i in enumerate(order):
        tiers[i] = explicit[i] or pos // size + 1
    return tiers


def tiered_spanning_tree(total: np.ndarray, tiers: list[int]) -> set[tuple[int, int]]:
    """Maximum spanning tree in which the words of tiers 1..k are connected among
    themselves for every k (Kruskal, edges ordered by higher tier, then strength)."""
    n = len(tiers)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    pairs.sort(key=lambda p: (max(tiers[p[0]], tiers[p[1]]), -total[p]))
    tree: set[tuple[int, int]] = set()
    for i, j in pairs:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj
            tree.add((i, j))
            if len(tree) == n - 1:
                break
    return tree


def score_components(df: pd.DataFrame, embed: Embedder) -> dict[str, np.ndarray]:
    # Bare glosses: embedding "mangiare (to eat)" made every "to X" verb look alike.
    en_core = [EN_PREFIX_RE.sub("", w.strip()) for w in df["english"]]
    semantic = rescale(cosine_matrix(embed, en_core))

    words = df["italian"].tolist()
    n = len(words)
    morph = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            morph[i, j] = morph[j, i] = morph_similarity(words[i], words[j])

    def same(col: str) -> np.ndarray:
        v = df[col].map(root_key if col == "root" else str.lower).to_numpy()
        m = ((v[:, None] == v[None, :]) & (v[:, None] != "")).astype(float)
        np.fill_diagonal(m, 0.0)
        return m

    np.fill_diagonal(semantic, 0.0)
    return {
        "semantic": semantic,
        "morphological": morph,
        "etymological": same("root"),
        "thematic": same("theme"),
    }


def edge_reason(semantic: float, morphological: float, etymological: float, thematic: float) -> str:
    """Most informative explanation for an edge, shown to the user on hover.

    Same stem is the most specific reason, then a shared (e.g. Latin) root, then
    a strong meaning link, then a shared theme. Semantic is the fallback.
    """
    if morphological > 0:
        return "morphological"
    if etymological > 0:
        return "etymological"
    if semantic >= STRONG_SEMANTIC or thematic == 0:
        return "semantic"
    return "thematic"


def build_graph(
    df: pd.DataFrame,
    embed: Embedder,
    bonus_k: int = 3,
    bonus_threshold: float = 0.25,
    seed: str | None = None,
    ranks: dict[str, int] | None = None,
) -> dict:
    ids: list[str] = []
    for w in df["italian"]:
        base = slug(w) or "word"
        ids.append(base if base not in ids else f"{base}-{len(ids)}")
    comps = score_components(df, embed)
    total = sum(WEIGHTS[k] * m for k, m in comps.items())

    n = len(ids)
    words = df["italian"].tolist()
    if seed is not None and seed not in words:
        raise ValueError(f"Seed {seed!r} is not in the word list")
    tiers = assign_tiers(df, ranks or {})
    if seed is not None:
        tiers[words.index(seed)] = 1  # the start must be visible from the beginning
    tree = tiered_spanning_tree(total, tiers)
    chosen = set(tree)

    ranked = [sorted((j for j in range(n) if j != i), key=lambda j: -total[i, j]) for i in range(n)]
    for i in range(n):
        for j in ranked[i][:bonus_k]:
            if total[i, j] >= bonus_threshold:
                chosen.add(tuple(sorted((i, j))))

    def breakdown(i: int, j: int) -> dict:
        return {k: round(float(m[i, j]), 3) for k, m in comps.items()}

    def strength(i: int, j: int) -> float:
        return round(min(1.0, float(total[i, j])), 3)

    edges = [
        {
            "source": ids[i],
            "target": ids[j],
            "weight": strength(i, j),
            "reason": edge_reason(*(float(comps[k][i, j]) for k in WEIGHTS)),
            "components": breakdown(i, j),
            "via": "tree" if (i, j) in tree else "bonus",
        }
        for i, j in sorted(chosen)
    ]

    # Each word's strongest partners, linked or not, so the app can show why
    # two plausible words did not get an edge.
    candidates = {
        ids[i]: [
            {
                "id": ids[j],
                "weight": strength(i, j),
                "rank": r + 1,
                "components": breakdown(i, j),
                "linked": tuple(sorted((i, j))) in chosen,
            }
            for r, j in enumerate(ranked[i][:CANDIDATES])
        ]
        for i in range(n)
    }

    if seed is None:  # best-connected tier-1 word, preferring nouns (a concrete start)
        degree = np.zeros(n, dtype=float)
        for i, j in chosen:
            if tiers[i] == 1 and tiers[j] == 1:
                degree[i] += 1
                degree[j] += 1
        nouns = (df["pos"].str.lower() == "noun").to_numpy()
        if (degree * nouns).max() > 0:
            degree = degree * nouns
        seed = words[int(np.argmax(degree))]

    nodes = [
        {
            "id": ids[i],
            "it": r.italian,
            "en": r.english,
            **{col: getattr(r, col) or None for col in OPTIONAL_COLUMNS},
            "tier": tiers[i],
        }
        for i, r in enumerate(df.itertuples(index=False))
    ]
    # Roots shared by 2+ words become hub nodes in the app ("descends from" links).
    by_root: dict[str, list[int]] = {}
    for i, r in enumerate(df["root"]):
        if r:
            by_root.setdefault(root_key(r), []).append(i)
    roots = [
        {
            "id": f"root:{slug(df['root'][members[0]])}",
            "root": df["root"][members[0]],
            "lang": df["root_lang"][members[0]] or None,
            "meaning": df["root_meaning"][members[0]] or None,
            "words": [ids[i] for i in members],
        }
        for members in by_root.values()
        if len(members) >= 2
    ]

    return {
        "seed": ids[words.index(seed)],
        "params": {
            "model": None,
            "weights": WEIGHTS,
            "bonus_k": bonus_k,
            "bonus_threshold": bonus_threshold,
            "tiers": max(tiers),
        },
        "nodes": nodes,
        "edges": edges,
        "roots": roots,
        "candidates": candidates,
    }


def validate_graph(graph: dict) -> None:
    node_ids = {n["id"] for n in graph["nodes"]}
    if graph["seed"] not in node_ids:
        raise ValueError("Seed is not a node")
    g = nx.Graph()
    g.add_nodes_from(node_ids)
    for e in graph["edges"]:
        if e["source"] not in node_ids or e["target"] not in node_ids:
            raise ValueError(f"Edge references unknown node: {e}")
        if e["reason"] not in WEIGHTS:
            raise ValueError(f"Unknown edge reason: {e['reason']}")
        g.add_edge(e["source"], e["target"])
    if not nx.is_connected(g):
        raise ValueError("Graph is not connected")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv")
    p.add_argument("-o", "--out", default="data/graph.json")
    p.add_argument("--seed", help="Italian word to start from (default: highest degree)")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("-k", "--bonus-k", type=int, default=3)
    p.add_argument("-t", "--bonus-threshold", type=float, default=0.25)
    args = p.parse_args(argv)

    df = load_words(args.csv)
    graph = build_graph(
        df, make_embedder(args.model), args.bonus_k, args.bonus_threshold, args.seed, load_frequency_ranks()
    )
    graph["params"]["model"] = args.model
    validate_graph(graph)
    Path(args.out).write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    reasons = pd.Series([e["reason"] for e in graph["edges"]]).value_counts().to_dict()
    seed_word = next(n["it"] for n in graph["nodes"] if n["id"] == graph["seed"])
    n, m = len(graph["nodes"]), len(graph["edges"])
    tiers = pd.Series([nd["tier"] for nd in graph["nodes"]]).value_counts().sort_index().to_dict()
    print(f"{n} nodes, {m} edges (avg degree {2 * m / n:.1f}) {reasons}, seed={seed_word!r} -> {args.out}")
    print(f"tiers (tier: words): {tiers}; {len(graph['roots'])} shared roots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
