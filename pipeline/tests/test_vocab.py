import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_vocab as bv  # noqa: E402
import vocab as V  # noqa: E402


def fake_embedder(texts):
    """Words sharing a token land close together; everything else is apart."""
    vocab = sorted({tok for t in texts for tok in t.lower().split()})
    return np.array([[1.0 if tok in t.lower().split() else 0.0 for tok in vocab] for t in texts]) + 0.01


WORDS = [
    {"it": "la cucina", "en": "kitchen", "pos": "noun", "cat": "home", "level": "A1"},
    {"it": "la casa", "en": "house / home", "pos": "noun", "cat": "home", "level": "A1"},
    {"it": "il forno", "en": "oven kitchen", "pos": "noun", "cat": "home", "level": "A2"},
    {"it": "cucinare", "en": "to cook kitchen", "pos": "verb", "cat": "cooking", "level": "A1"},
    {"it": "friggere", "en": "to fry", "pos": "verb", "cat": "cooking", "level": "A2"},
    {"it": "il diritto", "en": "right", "pos": "noun", "cat": "society", "level": "A1"},
    {"it": "la destra", "en": "right", "pos": "noun", "cat": "where", "level": "A1"},
    {"it": "la legge", "en": "law", "pos": "noun", "cat": "society", "level": "A1"},
    {"it": "sinistra", "en": "left side", "pos": "noun", "cat": "where", "level": "A1"},
]


def test_roundtrip_and_validation(tmp_path):
    words = [dict(w) for w in WORDS]
    words[0]["pl"] = "le cucine"
    for cat in {w["cat"] for w in words}:
        V.dump_category(tmp_path / f"{cat}.yaml", cat, [w for w in words if w["cat"] == cat])
    loaded = V.load(tmp_path)
    assert len(loaded) == len(words)
    assert next(w for w in loaded if w["it"] == "la cucina")["pl"] == "le cucine"
    assert V.validate(loaded) == []
    bad = loaded + [
        {"it": "la casa", "en": "home", "pos": "thing", "cat": "home", "colour": "x"},
        {"it": "la casa", "en": "home", "pos": "noun", "cat": "home"},
    ]
    problems = V.validate(bad)
    assert any("listed twice" in p for p in problems)
    # The same word as another part of speech is another word (German sein "to be" / "his").
    assert not any("listed twice" in p for p in V.validate(loaded + [{"it": "la casa", "en": "x", "pos": "verb", "cat": "home", "id": "casa-v"}]))
    assert any("pos 'thing'" in p for p in problems)
    assert any("unknown fields" in p for p in problems)


def test_unknown_category_file_is_an_error(tmp_path):
    (tmp_path / "gadgets.yaml").write_text("name: Gadgets\nwords: []\n")
    with pytest.raises(ValueError, match="gadgets"):
        V.load(tmp_path)


def test_word_rank_uses_the_most_common_form():
    ranks = {"fa": 10, "fare": 900, "occhi": 50, "occhio": 400}
    assert V.word_rank({"it": "fare", "pos": "verb"}, ranks, {"fare": ["fa", "faccio"]}) == 10
    assert V.word_rank({"it": "l'occhio", "pos": "noun", "pl": "gli occhi"}, ranks) == 50
    assert V.cefr_for_rank(10) == "A1" and V.cefr_for_rank(10**9) == "C1"


def graph():
    words = [dict(w) for w in WORDS]
    return bv.build(words, fake_embedder, {}, {})


def pairs(g, via=None):
    return {frozenset((e["source"], e["target"])) for e in g["edges"] if via is None or e["via"] == via}


def test_every_category_is_a_region_and_the_map_is_connected():
    g = graph()
    assert sorted(r["name"] for r in g["regions"]) == sorted(V.CATEGORIES[c] for c in {w["cat"] for w in WORDS})
    import networkx as nx

    G = nx.Graph([(e["source"], e["target"]) for e in g["edges"]])
    G.add_nodes_from(n["id"] for n in g["nodes"])
    assert nx.is_connected(G)


def test_families_link_across_categories_only_when_meanings_relate():
    g = graph()
    # la cucina / cucinare share a stem and a meaning ("kitchen").
    assert frozenset(("la-cucina", "cucinare")) in pairs(g, "family")
    # la casa has the same stem as nothing here, and its reason is never "morphological".
    assert not any(e["reason"] == "morphological" and "la-casa" in (e["source"], e["target"]) for e in g["edges"])


def test_no_direct_bridge_between_english_homographs():
    g = graph()
    # il diritto "right" (Society) and la destra "right" (Where): same English
    # word, unrelated Italian meanings.
    assert frozenset(("il-diritto", "la-destra")) not in pairs(g, "bridge")


def test_hand_made_links_win(tmp_path):
    words = [dict(w) for w in WORDS]
    words[1]["links"] = ["friggere"]
    words[0]["unlink"] = ["il forno"]
    g = bv.build(words, fake_embedder, {}, {})
    assert frozenset(("la-casa", "friggere")) in pairs(g, "manual")
    assert frozenset(("la-cucina", "il-forno")) not in pairs(g)


def test_plural_and_category_reach_the_nodes():
    words = [dict(w) for w in WORDS]
    words[0]["pl"] = "le cucine"
    g = bv.build(words, fake_embedder, {}, {})
    node = next(n for n in g["nodes"] if n["id"] == "la-cucina")
    assert node["pl"] == "le cucine" and node["theme"] == "Home"
    assert g["params"]["tier_names"]["1"].startswith("A1")


def test_male_and_female_pairs_share_their_links():
    fam = [
        {"it": "la figlia", "en": "daughter child", "pos": "noun", "cat": "family", "level": "A1"},
        {"it": "il figlio", "en": "son child", "pos": "noun", "cat": "family", "level": "A1"},
        {"it": "la figliastra", "en": "stepdaughter child", "pos": "noun", "cat": "family", "level": "A2"},
        {"it": "il figliastro", "en": "stepson child", "pos": "noun", "cat": "family", "level": "A2"},
        {"it": "la famiglia", "en": "family", "pos": "noun", "cat": "family", "level": "A1"},
        {"it": "il cugino", "en": "cousin (male)", "pos": "noun", "cat": "family", "level": "A2"},
        {"it": "la cugina", "en": "cousin (female)", "pos": "noun", "cat": "family", "level": "A2"},
        {"it": "il caso", "en": "case", "pos": "noun", "cat": "home", "level": "A1"},
    ]
    words = [dict(w) for w in WORDS if w["it"] != "la cucina"] + fam
    g = bv.build(words, fake_embedder, {}, {})
    at = {w["it"]: i for i, w in enumerate(words)}
    sem = np.full((len(words), len(words)), 0.5)
    pair = bv.counterparts(words, sem)
    assert pair[at["il figliastro"]] == at["la figliastra"]  # stepson / stepdaughter
    assert pair[at["il cugino"]] == at["la cugina"]  # same English, Italian -o / -a
    assert at["il caso"] not in pair  # la casa is in the list, but "case" isn't "house"
    kids = [
        {"it": "il bambino", "en": "child / little boy", "pos": "noun", "cat": "people", "level": "A1"},
        {"it": "la bambina", "en": "little girl", "pos": "noun", "cat": "people", "level": "A1"},
        {"it": "il ragazzino", "en": "little boy / kid", "pos": "noun", "cat": "people", "level": "A2"},
    ]
    kp = bv.counterparts(kids, np.zeros((3, 3)))
    assert kp[0] == 1  # ending and meaning together beat a meaning alone
    links = pairs(g)
    assert frozenset(("il-figlio", "la-figlia")) in links
    # Whatever la figlia links to in its category, il figlio links to the counterpart.
    for e in g["edges"]:
        if e["via"] == "bridge":
            continue
        ends = {e["source"], e["target"]}
        if "la-figlia" in ends and "il-figlio" not in ends:
            other = (ends - {"la-figlia"}).pop()
            mirror = {"la-figliastra": "il-figliastro", "la-cugina": "il-cugino", "il-cugino": "la-cugina"}.get(other, other)
            assert frozenset(("il-figlio", mirror)) in links
