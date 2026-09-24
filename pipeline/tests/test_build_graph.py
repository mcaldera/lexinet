import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_graph as bg  # noqa: E402


def fake_embedder(texts):
    """Deterministic embeddings: words sharing an English token land close together."""
    vocab = sorted({tok for t in texts for tok in t.lower().replace("(", " ").replace(")", " ").split()})
    m = np.array([[1.0 if tok in t.lower() else 0.0 for tok in vocab] for t in texts]) + 0.01
    return m


@pytest.fixture
def df():
    return pd.DataFrame(
        {
            "italian": ["il cane", "abbaiare", "parlare", "parlato", "la parola", "il gatto"],
            "english": ["dog", "to bark", "to speak", "spoken", "word", "cat"],
            "pos": ["noun", "verb", "verb", "verb", "noun", "noun"],
            "theme": ["animals", "animals", "comm", "comm", "comm", "animals"],
            "root": ["canis", "", "parabola", "parabola", "parabola", "cattus"],
            "cognate": ["canine", "", "parley", "", "parable", "cat"],
            "root_lang": ["Latin", "", "Late Latin", "Late Latin", "Late Latin", "Late Latin"],
            "root_meaning": ["dog", "", "speech", "speech", "speech", "cat"],
            "cognate_note": [""] * 6,
            "tier": [""] * 6,
        }
    )


def test_lemma_strips_articles_and_accents():
    assert bg.lemma("il cane") == "cane"
    assert bg.lemma("l'Uccello") == "uccello"
    assert bg.lemma("la città") == "citta"


def test_morph_similarity():
    assert bg.morph_similarity("parlare", "parlato") == 1.0
    assert bg.morph_similarity("cucinare", "la cucina") == 1.0
    assert bg.morph_similarity("parlare", "la parola") == 0.0
    assert bg.morph_similarity("il cane", "il gatto") == 0.0
    assert bg.morph_similarity("la domanda", "domani") == 0.0  # shared prefix is not a stem
    assert bg.morph_similarity("la cena", "cenare") == 1.0


def test_load_words_fills_optional_columns_and_dedupes(tmp_path):
    p = tmp_path / "w.csv"
    p.write_text("Italian,English\nil cane,dog\nil cane,dog again\nil gatto,cat\n")
    df = bg.load_words(p)
    assert list(df.columns) == [
        "italian", "english", "pos", "theme", "root", "root_lang", "root_meaning", "cognate", "cognate_note", "tier", "level"
    ]
    assert len(df) == 2


def test_load_words_requires_columns(tmp_path):
    p = tmp_path / "w.csv"
    p.write_text("italian\nil cane\n")
    with pytest.raises(ValueError):
        bg.load_words(p)


def test_build_graph_is_connected_and_labelled(df):
    graph = bg.build_graph(df, fake_embedder, bonus_k=2, bonus_threshold=0.3)
    bg.validate_graph(graph)
    assert len(graph["nodes"]) == 6
    assert len(graph["edges"]) >= 5  # at least the spanning tree
    assert [n["id"] for n in graph["nodes"]] == ["il-cane", "abbaiare", "parlare", "parlato", "la-parola", "il-gatto"]
    pairs = {(e["source"], e["target"]): e for e in graph["edges"]}
    assert pairs[("parlare", "parlato")]["reason"] == "morphological"
    assert all(0 <= e["weight"] <= 1 for e in graph["edges"])
    assert set(graph["edges"][0]["components"]) == set(bg.WEIGHTS)
    assert sum(e["via"] == "tree" for e in graph["edges"]) == 5
    assert graph["nodes"][0]["cognate"] == "canine"


def test_shared_root_is_an_etymological_component(df):
    comps = bg.score_components(df, fake_embedder)
    assert comps["etymological"][2, 4] == 1.0  # parlare / la parola: Latin parabola
    assert comps["etymological"][0, 5] == 0.0
    assert comps["etymological"][2, 2] == 0.0  # no self-links
    assert bg.edge_reason(0.9, 0.0, 1.0, 1.0) == "etymological"


def test_candidates_list_strongest_partners_with_link_flag(df):
    graph = bg.build_graph(df, fake_embedder)
    linked = {tuple(sorted((e["source"], e["target"]))) for e in graph["edges"]}
    for nid, cands in graph["candidates"].items():
        assert [c["rank"] for c in cands] == list(range(1, len(cands) + 1))
        weights = [c["weight"] for c in cands]
        assert weights == sorted(weights, reverse=True)
        for c in cands:
            assert c["linked"] == (tuple(sorted((nid, c["id"]))) in linked)


def test_slug_ids_are_stable_and_ascii():
    assert bg.slug("l'Uccello") == "l-uccello"
    assert bg.slug("la città") == "la-citta"


def test_seed_override(df):
    graph = bg.build_graph(df, fake_embedder, seed="il gatto")
    assert graph["seed"] == "il-gatto"
    with pytest.raises(ValueError):
        bg.build_graph(df, fake_embedder, seed="nope")


def test_validate_rejects_disconnected():
    graph = {
        "seed": "n1",
        "nodes": [{"id": "n1"}, {"id": "n2"}, {"id": "n3"}],
        "edges": [{"source": "n1", "target": "n2", "weight": 1, "reason": "semantic"}],
    }
    with pytest.raises(ValueError, match="connected"):
        bg.validate_graph(graph)


def test_edge_reason_priority():
    assert bg.edge_reason(0.9, 1.0, 1.0, 1.0) == "morphological"
    assert bg.edge_reason(0.7, 0.0, 0.0, 1.0) == "semantic"
    assert bg.edge_reason(0.4, 0.0, 0.0, 1.0) == "thematic"
    assert bg.edge_reason(0.4, 0.0, 0.0, 0.0) == "semantic"


def test_numberbatch_embedder_uses_phrases_then_word_means(tmp_path):
    import gzip

    p = tmp_path / "nb.txt.gz"
    with gzip.open(p, "wt", encoding="utf-8") as f:
        f.write("4 2\ndog 1 0\nbark 0.9 0.1\nlook_at 0 1\nlook 0.5 0.5\n")
    embed = bg.numberbatch_embedder(p)
    out = embed(["dog", "look at", "bark loudly", "zzz"])
    assert out.tolist() == [[1, 0], [0, 1], [0.9, 0.1], [0, 0]]


def test_tiers_follow_frequency_with_explicit_override(df):
    ranks = {"cane": 1, "gatto": 2, "parlare": 3, "parola": 4, "abbaiare": 50}
    assert bg.assign_tiers(df, ranks, n_tiers=3) == [1, 3, 2, 3, 2, 1]  # parlato unknown -> last
    df2 = df.assign(tier=["1", "2", "2", "3", "3", "1"])
    assert bg.assign_tiers(df2, ranks) == [1, 2, 2, 3, 3, 1]


def test_tiered_tree_keeps_every_tier_prefix_connected():
    import networkx as nx

    rng = np.random.default_rng(0)
    n = 30
    total = rng.random((n, n))
    total = (total + total.T) / 2
    tiers = [1 + i % 3 for i in range(n)]
    tree = bg.tiered_spanning_tree(total, tiers)
    assert len(tree) == n - 1
    for k in (1, 2, 3):
        g = nx.Graph()
        g.add_nodes_from(i for i in range(n) if tiers[i] <= k)
        g.add_edges_from((i, j) for i, j in tree if tiers[i] <= k and tiers[j] <= k)
        assert nx.is_connected(g)


def test_seed_is_forced_into_tier_one(df):
    graph = bg.build_graph(df, fake_embedder, seed="parlato", ranks={"cane": 1})
    seed = next(n for n in graph["nodes"] if n["id"] == graph["seed"])
    assert seed["tier"] == 1


def test_shared_roots_become_hub_entries(df):
    graph = bg.build_graph(df, fake_embedder)
    assert graph["roots"] == [
        {
            "id": "root:parabola",
            "root": "parabola",
            "lang": "Late Latin",
            "meaning": "speech",
            "words": ["parlare", "parlato", "la-parola"],
            "english": ["parley", "parable"],
        }
    ]


def test_root_english_examples_merge_cognates_and_lookup(df):
    graph = bg.build_graph(df, fake_embedder, english=lambda root: ["parable", "parole"])
    assert graph["roots"][0]["english"] == ["parley", "parable", "parole"]


def test_every_word_gets_map_position_and_region(df):
    graph = bg.build_graph(df, fake_embedder)
    assert all(np.isfinite([n["x"], n["y"]]).all() for n in graph["nodes"])
    in_regions = sorted(w for r in graph["regions"] for w in r["words"])
    assert in_regions == sorted(n["id"] for n in graph["nodes"])
    assert all(r["name"] for r in graph["regions"])
