import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from examples import Examples, find, gloss_stems, lemma, mentions  # noqa: E402

PAIRS = [
    ("Cosa la porta qui?", "What brings you here?"),
    ("Qualcuno è sulla porta.", "Someone is at the door."),
    ("Chiudi la porta.", "Close the door."),
    ("Il cane dorme sempre sotto il tavolo della cucina.", "The dog always sleeps under the kitchen table."),
    ("Il cane abbaia.", "The dog is barking."),
    ("Non mi minacciare.", "Don't threaten me."),
]
RANKS = {"il": 1, "la": 2, "non": 3, "mi": 4, "cane": 50, "porta": 60, "chiudi": 70, "abbaia": 900}


def test_lemma_strips_articles():
    assert lemma("il cane") == "cane"
    assert lemma("l'acqua") == "acqua"
    assert lemma("un'amica") == "amica"
    assert lemma("girare a destra") == "girare a destra"


def test_find_whole_words_only():
    assert find("cane", "Il cane abbaia.") == (3, 7)
    assert find("cane", "I cani abbaiano.") is None
    assert find("acqua", "Voglio l'acqua.") is None  # after an apostrophe it's part of l'acqua
    assert find("a destra", "Gira a destra.") == (5, 13)


def test_gloss_must_appear_in_the_translation():
    assert gloss_stems("to threaten") == ["threa"]
    assert gloss_stems("door (of a house); gate") == ["door", "gate"]
    assert mentions("Don't threaten me.", ["threa"])
    assert not mentions("What brings you here?", ["door"])


def test_pick_prefers_simple_sentences_that_mean_the_word():
    ex = Examples(PAIRS, RANKS)
    # The homograph (la porta = "brings you") is ruled out by the gloss; the
    # simplest remaining sentence wins.
    assert ex.pick("la porta", "door") == {"it": "Chiudi la porta.", "en": "Close the door.", "blank": "porta"}
    # Simpler beats shorter, but the long sentence has words missing from the
    # frequency list (they count as rarest), so the short one wins here.
    assert ex.pick("il cane", "dog")["it"] == "Il cane abbaia."
    assert ex.pick("minacciare", "to threaten")["blank"] == "minacciare"
    assert ex.pick("il gatto", "cat") is None
