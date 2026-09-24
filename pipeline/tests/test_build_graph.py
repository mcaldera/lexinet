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
    assert list(df.columns) == ["italian", "english", "pos", "theme"]
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
    pairs = {(e["source"], e["target"]): e for e in graph["edges"]}
    assert pairs[("n3", "n4")]["reason"] in {"morphological", "semantic", "thematic"}
    assert all(0 <= e["weight"] <= 1 for e in graph["edges"])


def test_seed_override(df):
    graph = bg.build_graph(df, fake_embedder, seed="il gatto")
    assert graph["seed"] == "n6"
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
    assert bg.edge_reason(0.9, 0.8, 1.0) == "morphological"
    assert bg.edge_reason(0.7, 0.0, 1.0) == "semantic"
    assert bg.edge_reason(0.4, 0.0, 1.0) == "thematic"
    assert bg.edge_reason(0.4, 0.0, 0.0) == "semantic"
