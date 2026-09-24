import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import conjugate as cj  # noqa: E402


def test_standard_spelling_drops_stress_marks():
    assert cj.standard_spelling("vàdo") == "vado"
    assert cj.standard_spelling("andiàmo") == "andiamo"
    assert cj.standard_spelling("andrémo") == "andremo"
    assert cj.standard_spelling("andrò") == "andrò"
    assert cj.standard_spelling("và") == "va"
    assert cj.standard_spelling("è") == "è"
    assert cj.standard_spelling("può") == "può"


def test_conjugations_build_passato_prossimo_with_agreement():
    tags = {
        "presente": ("indicative", "present"),
        "imperfetto": ("indicative", "imperfect"),
        "futuro": ("indicative", "future"),
        "condizionale": ("conditional",),
        "congiuntivo": ("subjunctive", "present"),
    }
    forms = [("andàto", ("participle", "past"))]
    for tense, t in tags.items():
        for i, (person, number) in enumerate(cj.PERSONS):
            forms.append((f"{tense[:3]}{i}", (*t, person, number)))
    table = cj.conjugations({"aux": "essere", "forms": forms})
    assert list(table) == cj.TENSES
    assert table["presente"][0] == "pre0"
    assert table["passato prossimo"] == [
        "sono andato", "sei andato", "è andato", "siamo andati", "siete andati", "sono andati"
    ]
    assert cj.conjugations({"aux": "avere", "forms": forms[:3]}) is None  # incomplete


def test_reflexive_verbs_take_essere_and_pronoun():
    forms = [("lavàtosi", ("participle", "past"))]
    for tense, t in {"presente": ("indicative", "present"), "imperfetto": ("indicative", "imperfect"),
                     "futuro": ("indicative", "future"), "condizionale": ("conditional",),
                     "congiuntivo": ("subjunctive", "present")}.items():
        for person, number in cj.PERSONS:
            forms.append(("x", (*t, person, number)))
    table = cj.conjugations({"aux": "avere", "forms": forms}, "lavarsi")
    assert table["passato prossimo"][0] == "mi sono lavato"
    assert table["passato prossimo"][3] == "ci siamo lavati"
    assert cj.conjugations({"aux": "avere", "forms": forms}, "andarsene") is None
