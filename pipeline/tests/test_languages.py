import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_graph as bg  # noqa: E402
import conjugate as cj  # noqa: E402
import examples as exm  # noqa: E402
import languages as L  # noqa: E402
import translate_vocab as tv  # noqa: E402
import vocab as V  # noqa: E402


@pytest.fixture
def spanish():
    L.use("es")
    yield L.current
    L.use("it")


def test_italian_is_the_default():
    assert L.current.code == "it"
    assert V.lemma("l'occhio") == "occhio"
    assert bg.stem("la cucina") == "cucin"


def test_spanish_articles_and_stems(spanish):
    assert V.lemma("las manos") == "manos"
    assert V.lemma("il cane") == "il cane"  # an Italian article is no article here
    assert exm.lemma("el perro") == "perro"
    assert bg.stem("la cocina") == bg.stem("cocinar") == "cocin"


def test_spanish_words_load_under_their_code(tmp_path, spanish):
    (tmp_path / "body.yaml").write_text(
        "name: Body\nwords:\n- {es: la mano, en: hand, pos: noun, concept: la-mano}\n", encoding="utf-8"
    )
    words = V.load(tmp_path)
    assert words[0]["it"] == "la mano" and words[0]["concept"] == "la-mano"
    V.dump_category(tmp_path / "body.yaml", "body", words)
    assert "{es: la mano," in (tmp_path / "body.yaml").read_text(encoding="utf-8")


def spanish_verb(prefix: str = "habl") -> dict:
    tags = {
        "presente": ("indicative", "present"),
        "pretérito indefinido": ("indicative", "preterite"),
        "imperfecto": ("indicative", "imperfect"),
        "futuro": ("indicative", "future"),
        "condicional": ("conditional", "indicative"),
        "subjuntivo": ("subjunctive", "present"),
    }
    forms = [(f"{prefix}ado", ("participle", "past")), (f"{prefix}ás", ("indicative", "present", "second-person", "singular", "vos-form"))]
    for tense, t in tags.items():
        for i, (person, number) in enumerate(cj.PERSONS):
            forms.append((f"{tense[:3]}{i}", (*t, person, number)))
    return {"aux": "avere", "forms": forms}


def test_spanish_tables_build_the_perfecto_and_skip_voseo(spanish):
    table = cj.table({"hablar": spanish_verb()}, "hablar")
    assert list(table) == cj.ES_TENSES
    assert table["presente"][1] == "pre1"  # tú, not vos
    assert table["pretérito perfecto"] == ["he hablado", "has hablado", "ha hablado", "hemos hablado", "habéis hablado", "han hablado"]


def test_spanish_reflexives_come_from_their_base_verb(spanish):
    table = cj.table({"lavar": spanish_verb("lav")}, "lavarse")
    assert table["presente"][0] == "me pre0"
    assert table["pretérito perfecto"][4] == "os habéis lavado"
    assert cj.table({}, "lavarse") is None


LEX = {
    "mano": [{"pos": "noun", "gender": "f", "plurals": ["manos"], "glosses": ["hand"]}],
    "agua": [{"pos": "noun", "gender": "f", "plurals": ["aguas"], "glosses": ["water"]}],
    "gafas": [{"pos": "noun", "gender": "f-p", "plurals": [], "glosses": ["eyeglasses"]}],
    "patillas": [{"pos": "noun", "gender": "", "plurals": [], "glosses": ["plural of patilla"]}],
    "patilla": [{"pos": "noun", "gender": "f", "plurals": ["patillas"], "glosses": ["sideburn"]}],
    "lavarse": [{"pos": "verb", "gender": "", "plurals": [], "glosses": ["infinitive of lavar combined with se"]}],
    "lavar": [{"pos": "verb", "gender": "", "plurals": [], "glosses": ["to wash"]}],
}


def test_review_flags_what_does_not_fit_wiktionary(spanish):
    check = lambda it, en, pos="noun": tv.problems({"it": it, "en": en, "pos": pos}, LEX, spanish)  # noqa: E731
    assert check("la mano", "hand") == []
    assert check("el agua", "water") == []  # feminine, but "el" before a stressed a
    assert check("las patillas", "sideburns") == []  # followed to the singular
    assert check("lavarse", "to wash", "verb") == []  # followed to the base verb
    assert check("el mano", "hand") == ["article 'el' but Wiktionary says f"]
    assert check("la mano", "foot")[0].startswith("meaning")
    assert check("la mesa", "table") == ["not in Wiktionary"]


def test_plurals_take_the_right_article(spanish):
    assert tv.plural_of("la mano", LEX, spanish) == "las manos"
    assert tv.plural_of("el agua", LEX, spanish) == "las aguas"
