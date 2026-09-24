"""Build the Sprawl word graph from a CSV word list.

Usage:
    python pipeline/build_graph.py data/words.csv -o data/graph.json [--seed "il cane"]

Edge score = weighted sum of semantic (embedding cosine), morphological (shared
stem of the Italian lemma) and thematic (same `theme`) similarity. A maximum
spanning tree guarantees connectivity; top-k bonus edges per node add loops.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections.abc import Callable
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

DEFAULT_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
WEIGHTS = {"semantic": 0.6, "morphological": 0.25, "thematic": 0.15}
MIN_STEM = 3  # shortest stem that counts as a morphological link
STRONG_SEMANTIC = 0.6  # cosine above which meaning, not theme, explains an edge

ARTICLE_RE = re.compile(r"^(il|lo|la|i|gli|le|un|uno|una)\s+|^(l'|un')", re.IGNORECASE)
# Infinitive and past-participle endings, else a single final vowel.
ENDING_RE = re.compile(r"(are|ere|ire|at[oaie]|ut[oaie]|it[oaie]|[aeiou])$")

Embedder = Callable[[list[str]], np.ndarray]


def load_words(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    df.columns = [c.strip().lower() for c in df.columns]
    missing = {"italian", "english"} - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing required columns: {sorted(missing)}")
    for col in ("pos", "theme"):
        if col not in df.columns:
            df[col] = ""
    df = df[["italian", "english", "pos", "theme"]].apply(lambda s: s.str.strip())
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


def score_components(df: pd.DataFrame, embed: Embedder) -> dict[str, np.ndarray]:
    texts = [f"{it} ({en})" for it, en in zip(df["italian"], df["english"])]
    emb = np.asarray(embed(texts), dtype=float)
    emb = emb / np.linalg.norm(emb, axis=1, keepdims=True)
    semantic = np.clip(emb @ emb.T, 0.0, 1.0)

    words = df["italian"].tolist()
    n = len(words)
    morph = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            morph[i, j] = morph[j, i] = morph_similarity(words[i], words[j])

    themes = df["theme"].to_numpy()
    thematic = ((themes[:, None] == themes[None, :]) & (themes[:, None] != "")).astype(float)

    return {"semantic": semantic, "morphological": morph, "thematic": thematic}


def edge_reason(semantic: float, morphological: float, thematic: float) -> str:
    """Most informative explanation for an edge, shown to the user on hover.

    A shared root is the most specific reason, then a strong meaning link, then a
    shared theme. Semantic similarity is the fallback since it drives most scores.
    """
    if morphological > 0:
        return "morphological"
    if semantic >= STRONG_SEMANTIC or thematic == 0:
        return "semantic"
    return "thematic"


def build_graph(
    df: pd.DataFrame,
    embed: Embedder,
    bonus_k: int = 2,
    bonus_threshold: float = 0.45,
    seed: str | None = None,
) -> dict:
    ids = [f"n{i + 1}" for i in range(len(df))]
    comps = score_components(df, embed)
    weighted = {k: WEIGHTS[k] * m for k, m in comps.items()}
    total = sum(weighted.values())

    n = len(ids)
    complete = nx.Graph()
    for i in range(n):
        for j in range(i + 1, n):
            complete.add_edge(i, j, weight=float(total[i, j]))
    tree = nx.maximum_spanning_tree(complete)
    chosen = {tuple(sorted(e)) for e in tree.edges()}

    for i in range(n):
        ranked = sorted((j for j in range(n) if j != i), key=lambda j: -total[i, j])
        for j in ranked[:bonus_k]:
            if total[i, j] >= bonus_threshold:
                chosen.add(tuple(sorted((i, j))))

    edges = [
        {
            "source": ids[i],
            "target": ids[j],
            "weight": round(float(total[i, j]), 4),
            "reason": edge_reason(*(float(comps[k][i, j]) for k in ("semantic", "morphological", "thematic"))),
        }
        for i, j in sorted(chosen)
    ]

    words = df["italian"].tolist()
    if seed is None:
        degree = np.zeros(n, dtype=int)
        for i, j in chosen:
            degree[i] += 1
            degree[j] += 1
        seed = words[int(np.argmax(degree))]
    elif seed not in words:
        raise ValueError(f"Seed {seed!r} is not in the word list")

    nodes = [
        {"id": ids[i], "it": r.italian, "en": r.english, "pos": r.pos or None, "theme": r.theme or None}
        for i, r in enumerate(df.itertuples(index=False))
    ]
    return {"seed": ids[words.index(seed)], "nodes": nodes, "edges": edges}


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
    p.add_argument("-k", "--bonus-k", type=int, default=2)
    p.add_argument("-t", "--bonus-threshold", type=float, default=0.45)
    args = p.parse_args(argv)

    df = load_words(args.csv)
    graph = build_graph(df, sentence_transformer_embedder(args.model), args.bonus_k, args.bonus_threshold, args.seed)
    validate_graph(graph)
    Path(args.out).write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    reasons = pd.Series([e["reason"] for e in graph["edges"]]).value_counts().to_dict()
    seed_word = next(n["it"] for n in graph["nodes"] if n["id"] == graph["seed"])
    print(f"{len(graph['nodes'])} nodes, {len(graph['edges'])} edges {reasons}, seed={seed_word!r} -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
