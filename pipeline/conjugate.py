"""Italian verb conjugations from Wiktionary (kaikki.org extract).

Tenses are drilled in the order courses teach them; each becomes a verb level:
presente, passato prossimo, imperfetto, futuro, condizionale, congiuntivo.
Passato prossimo is built from the auxiliary (essere/avere) + past participle.
"""

from __future__ import annotations

import gzip
import json
import pickle
import re
import unicodedata
from pathlib import Path

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
