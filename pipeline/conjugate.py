"""Verb conjugations from Wiktionary (kaikki.org extract): Italian, Spanish, German.

Tenses are drilled in the order courses teach them; each becomes a verb level
(the app's core/language.ts lists the same names):
  Italian: presente, passato prossimo, imperfetto, futuro, condizionale, congiuntivo.
    Passato prossimo is built from the auxiliary (essere/avere) + past participle.
  Spanish (Spain: vosotros): presente, pretérito perfecto, pretérito indefinido,
    imperfecto, futuro, condicional, subjuntivo (present). The perfecto is built
    from haber + the participle; reflexive verbs (lavarse) from their base verb.
  German: Präsens, Perfekt, Präteritum, Futur I, Konjunktiv II (see `german`).
"""

from __future__ import annotations

import gzip
import json
import pickle
import re
import unicodedata
from pathlib import Path

import languages as L

CACHE = Path.home() / ".cache" / "sprawl"
PERSONS = [
    ("first-person", "singular"),
    ("second-person", "singular"),
    ("third-person", "singular"),
    ("first-person", "plural"),
    ("second-person", "plural"),
    ("third-person", "plural"),
]
SIMPLE_TENSES = {
    "presente": {"indicative", "present"},
    "imperfetto": {"indicative", "imperfect"},
    "futuro": {"indicative", "future"},
    "condizionale": {"conditional"},
    "congiuntivo": {"subjunctive", "present"},
}
TENSES = ["presente", "passato prossimo", "imperfetto", "futuro", "condizionale", "congiuntivo"]
AUX = {
    "essere": ["sono", "sei", "è", "siamo", "siete", "sono"],
    "avere": ["ho", "hai", "ha", "abbiamo", "avete", "hanno"],
}
# Monosyllables that keep a written accent; all others lose it (Wiktionary marks stress).
ACCENTED_MONOSYLLABLES = {"è", "dà", "dì", "può", "più", "già", "ciò", "giù", "là", "lì", "sì", "né", "sé", "tè"}
VOWELS = "aeiouàèéìòóù"


def standard_spelling(form: str) -> str:
    """Drop Wiktionary's stress marks, keeping only the written final accent:
    "vàdo" -> "vado", "andrémo" -> "andremo", "andrò" -> "andrò", "và" -> "va"."""
    decomposed = unicodedata.normalize("NFD", form)
    plain = unicodedata.normalize("NFC", "".join(c for c in decomposed if not unicodedata.combining(c)))
    if not form or form[-1] not in "àèéìòóù":
        return plain
    syllables = len(re.findall(f"[{VOWELS}]+", plain))
    if syllables <= 1 and form not in ACCENTED_MONOSYLLABLES:
        return plain
    # Standard orthography writes a grave accent on final à ì ò ù and è/é on e.
    last = {"ó": "ò"}.get(form[-1], form[-1])
    return plain[:-1] + last


def load_verbs(path: Path) -> dict[str, dict]:
    """Infinitive -> {"aux": ..., "forms": [(form, tags), ...]} for Italian verbs (cached)."""
    cache = path.with_suffix(".verbs.pkl")
    if cache.exists() and cache.stat().st_mtime > path.stat().st_mtime:
        return pickle.loads(cache.read_bytes())
    verbs: dict[str, dict] = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if '"pos": "verb"' not in line or '"forms"' not in line:
                continue
            e = json.loads(line)
            word = e.get("word", "")
            if e.get("pos") != "verb" or word in verbs or not e.get("forms"):
                continue
            head = (e.get("head_templates") or [{}])[0].get("args", {}).get("1", "")
            forms = [(f["form"], tuple(f.get("tags", []))) for f in e["forms"] if f.get("form")]
            if len(forms) > 20:
                verbs[word] = {"aux": "essere" if head.startswith("e") else "avere", "forms": forms}
    cache.write_bytes(pickle.dumps(verbs))
    return verbs


REFLEXIVE = ["mi", "ti", "si", "ci", "vi", "si"]


def conjugations(entry: dict, infinitive: str = "") -> dict[str, list[str]] | None:
    """Six persons for each tense, in TENSES order; None if any tense is incomplete.
    Reflexive verbs (lavarsi) take essere and their pronoun: "mi sono lavato"."""
    if re.search(r"(sene|sela|cela|rci)$", infinitive):
        return None  # pronominal verbs like andarsene: too irregular to drill reliably
    table: dict[str, list[str]] = {}
    usable = [(f, set(t)) for f, t in entry["forms"] if not {"archaic", "rare", "obsolete", "poetic"} & set(t)]
    for tense, want in SIMPLE_TENSES.items():
        row = []
        for person, number in PERSONS:
            match = next((f for f, t in usable if want <= t and person in t and number in t), None)
            if not match:
                return None
            row.append(standard_spelling(match))
        table[tense] = row
    participle = next((f for f, t in usable if {"participle", "past"} <= t), None)
    if not participle:
        return None
    pp = standard_spelling(participle)
    reflexive = infinitive.endswith("rsi")
    if reflexive:
        pp = re.sub(r"si$", "", pp)  # Wiktionary lists "lavatosi"
    aux = "essere" if reflexive else entry["aux"]
    plural = re.sub(r"o$", "i", pp) if aux == "essere" else pp  # siamo andati
    table["passato prossimo"] = [
        (f"{REFLEXIVE[i]} " if reflexive else "") + f"{a} {plural if aux == 'essere' and i >= 3 else pp}"
        for i, a in enumerate(AUX[aux])
    ]
    return {t: table[t] for t in TENSES}


ES_SIMPLE = {
    "presente": {"indicative", "present"},
    "pretérito indefinido": {"indicative", "preterite"},
    "imperfecto": {"indicative", "imperfect"},
    "futuro": {"indicative", "future"},
    "condicional": {"conditional"},
    "subjuntivo": {"subjunctive", "present"},
}
ES_TENSES = [
    "presente",
    "pretérito perfecto",
    "pretérito indefinido",
    "imperfecto",
    "futuro",
    "condicional",
    "subjuntivo",
]
HABER = ["he", "has", "ha", "hemos", "habéis", "han"]
ES_REFLEXIVE = ["me", "te", "se", "nos", "os", "se"]
# Latin American voseo forms (hablás) are not the Spain Spanish being taught.
ES_SKIP = {"archaic", "rare", "obsolete", "poetic", "vos-form"}


def spanish(verbs: dict[str, dict], infinitive: str) -> dict[str, list[str]] | None:
    """Six persons (yo .. ellos) for each tense in ES_TENSES, or None.
    A reflexive verb takes its base verb's forms with its pronoun ("me lavo",
    "me he lavado"): Wiktionary has full tables for only some of them."""
    reflexive = infinitive.endswith("se") and infinitive[:-2] in verbs
    entry = verbs.get(infinitive[:-2] if reflexive else infinitive)
    if not entry:
        return None
    usable = [(f, set(t)) for f, t in entry["forms"] if not ES_SKIP & set(t)]
    table: dict[str, list[str]] = {}
    for tense, want in ES_SIMPLE.items():
        row = []
        for person, number in PERSONS:
            match = next((f for f, t in usable if want <= t and person in t and number in t), None)
            if not match:
                return None
            row.append(match)
        table[tense] = row
    participle = next((f for f, t in usable if t == {"participle", "past"}), None) or next(
        (f for f, t in usable if {"participle", "past", "masculine", "singular"} <= t), None
    )
    if not participle:
        return None
    table["pretérito perfecto"] = [f"{h} {participle}" for h in HABER]
    if reflexive:
        table = {t: [f"{ES_REFLEXIVE[i]} {f}" for i, f in enumerate(row)] for t, row in table.items()}
    return {t: table[t] for t in ES_TENSES}


def table(verbs: dict[str, dict], infinitive: str) -> dict[str, list[str]] | None:
    """The conjugation table of a verb in the current language, or None."""
    if L.current.code == "es":
        return spanish(verbs, infinitive)
    if L.current.code == "de":
        return german(verbs, infinitive)
    return conjugations(verbs[infinitive], infinitive) if infinitive in verbs else None


DE_TENSES = ["Präsens", "Perfekt", "Präteritum", "Futur I", "Konjunktiv II"]
DE_TAGS = {
    "Präsens": {"indicative", "present"},
    "Perfekt": {"indicative", "perfect"},
    "Präteritum": {"indicative", "preterite"},
    "Futur I": {"indicative", "future-i"},
}
DE_REFLEXIVE = ["mich", "dich", "sich", "uns", "euch", "sich"]
SEIN = {"bin", "bist", "ist", "sind", "seid"}
# Verbs whose own Konjunktiv II is what people say (wäre, hätte, könnte); for
# the others "würde + infinitive" is, and a strong verb's own form (ginge) also counts.
DE_OWN_SUBJUNCTIVE = {"sein", "haben", "werden", "wissen", "können", "müssen", "dürfen", "sollen", "wollen", "mögen"}
DE_SKIP = {"archaic", "obsolete", "dated", "nonstandard", "subordinate-clause", "error-unknown-tag", "poetic"}


def german(verbs: dict[str, dict], infinitive: str) -> dict[str, list[str]] | None:
    """Six persons (ich .. sie/Sie) per tense in DE_TENSES, or None. Separable
    verbs come as said ("rufe an", "habe angerufen", "werde anrufen"); a
    reflexive verb (sich freuen) takes its base verb's forms with the pronoun
    after the first word ("freue mich", "habe mich gefreut")."""
    reflexive = infinitive.startswith("sich ")
    base = infinitive[5:] if reflexive else infinitive
    entry = verbs.get(base)
    if not entry:
        return None
    usable = [(f, set(t)) for f, t in entry["forms"] if not DE_SKIP & set(t)]

    def form(want: set[str], person: str, number: str, without: frozenset = frozenset()) -> str | None:
        """The first form with these tags that isn't marked rare or formal."""
        return next(
            (f for f, t in usable if want <= t and person in t and number in t and not ({"rare", "formal"} | without) & t),
            None,
        )

    table: dict[str, list[str]] = {}
    for tense, want in DE_TAGS.items():
        row = [form(want, p, n) for p, n in PERSONS]
        if None in row:
            return None
        table[tense] = row  # type: ignore[assignment]
    # Verbs listed with both auxiliaries (aufstehen, fahren) use sein in the
    # everyday sense; haben belongs to rarer or regional ones.
    sein = [
        next((f for f, t in usable if DE_TAGS["Perfekt"] <= t and p in t and n in t and f.split(" ")[0] in SEIN), None)
        for p, n in PERSONS
    ]
    if None not in sein:
        table["Perfekt"] = sein  # type: ignore[assignment]
    # The verb's own Konjunktiv II (wäre, ginge; weak verbs' are marked rare), the
    # shortest where there are two (gingst, not gingest), and the würde-form
    # (tagged future-i + subjunctive-ii).
    multiword = {"multiword-construction", "future-i", "future-ii", "rare", "formal"}
    own = [
        min((f for f, t in usable if "subjunctive-ii" in t and p in t and n in t and not multiword & t), key=len, default=None)
        for p, n in PERSONS
    ]
    wuerde = [form({"subjunctive-ii", "future-i"}, p, n) for p, n in PERSONS]
    if None in wuerde:
        return None
    if base in DE_OWN_SUBJUNCTIVE and None not in own:
        table["Konjunktiv II"] = own  # type: ignore[assignment]
    elif None not in own:
        table["Konjunktiv II"] = [f"{w} / {o}" for w, o in zip(wuerde, own)]  # type: ignore[misc]
    else:
        table["Konjunktiv II"] = wuerde  # type: ignore[assignment]
    if reflexive:
        def with_pronoun(f: str, i: int) -> str:
            return " / ".join(
                " ".join([o.split(" ")[0], DE_REFLEXIVE[i], *o.split(" ")[1:]]) for o in f.split(" / ")
            )

        table = {t: [with_pronoun(f, i) for i, f in enumerate(row)] for t, row in table.items()}
    return {t: table[t] for t in DE_TENSES}
