"""The vocabulary: one YAML file per category in data/vocab/, one line per word.

Each file looks like:

    name: Body
    words:
    - {it: l'occhio, en: eye, pos: noun, pl: gli occhi, level: A1, root: oculus, root_lang: Latin, root_meaning: eye}

Fields (only `it`, `en` and `pos` are required):

    it          the Italian, with its article for nouns
    en          the meaning; alternatives separated by " / " are all accepted,
                and a note in brackets ("clubs (card suit)") need not be typed
    pos         noun, verb, adj, adv, pron, conj, prep, num or interj
    pl          plural (nouns): accepted as an answer, shown with the word
    level       CEFR level (A1..C1); without it the word's frequency decides
    id          node id, only when it differs from the Italian's slug (a
                renamed word keeps its id, and so the player's progress)
    root, root_lang, root_meaning
                etymology; "-" for none (the build otherwise looks it up)
    cousin      English cousin shown as a hint; "-" for none (otherwise picked
                automatically, see build_graph.pick_cognate)
    links       ids or Italian words this word should be linked to on the map
    unlink      ... and links to remove
    note        free text for editors, not used by the app

`pipeline/build_vocab.py` turns the folder into a graph for the app.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import yaml

import languages as L

# Category file stem -> display name, in map order (related categories near each other).
CATEGORIES: dict[str, str] = {
    "body": "Body",
    "health": "Health",
    "looks": "Looks",
    "clothes": "Clothes",
    "colours": "Colours",
    "family": "Family",
    "people": "People",
    "character": "Character",
    "feelings": "Feelings",
    "mind": "Mind",
    "talking": "Talking",
    "home": "Home",
    "daily": "Daily life",
    "food": "Food",
    "cooking": "Cooking",
    "shopping": "Shopping & money",
    "work": "Work",
    "school": "School",
    "books": "Books",
    "arts": "Arts",
    "media": "Film & media",
    "tech": "Technology",
    "transport": "Transport",
    "travel": "Travel",
    "town": "Town",
    "nature": "Nature",
    "weather": "Weather",
    "environment": "Environment",
    "farm": "Farm",
    "animals": "Animals",
    "time": "Time",
    "numbers": "Numbers",
    "celebrations": "Celebrations",
    "sport": "Sport & games",
    "crime": "Crime & law",
    "society": "Society",
    "religion": "Religion",
    "where": "Where",
    "movement": "Movement",
    "doing": "Doing",
    "describing": "Describing",
    "concepts": "Concepts",
    "little": "Little words",
    "countries": "Countries",
}
POS = {"noun", "verb", "adj", "adv", "pron", "conj", "prep", "num", "interj"}
CEFR = ["A1", "A2", "B1", "B2", "C1"]
FIELDS = ["it", "en", "pos", "pl", "level", "id", "concept", "root", "root_lang", "root_meaning", "cousin", "links", "unlink", "note"]


def slug(word: str) -> str:
    """Node id from the Italian word: "l'Uccello" -> "l-uccello" (as build_graph.slug)."""
    word = unicodedata.normalize("NFKD", word.strip().lower())
    word = "".join(ch for ch in word if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", word).strip("-")


def lemma(it: str) -> str:
    """The word without its article: "l'occhio" -> "occhio"."""
    return L.current.article_re.sub("", it.strip().lower())


def load(folder: str | Path) -> list[dict]:
    """All words, each with its `cat` (file stem), in category then file order."""
    words: list[dict] = []
    folder = Path(folder)
    for cat in CATEGORIES:
        path = folder / f"{cat}.yaml"
        if not path.exists():
            continue
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for w in doc.get("words") or []:
            w = {k: v for k, v in w.items() if v is not None}
            if L.current.code != "it" and L.current.code in w:
                w["it"] = w.pop(L.current.code)  # the word is `it` in code, whatever its language
            words.append({**w, "cat": cat})
    extra = sorted(p.stem for p in folder.glob("*.yaml") if p.stem not in CATEGORIES)
    if extra:
        raise ValueError(f"unknown category files: {extra} (add them to vocab.CATEGORIES)")
    return words


def node_id(w: dict) -> str:
    return str(w.get("id") or slug(w["it"]))


def validate(words: list[dict]) -> list[str]:
    """Problems that would break the build or confuse a player."""
    problems: list[str] = []
    ids: dict[str, str] = {}
    seen: dict[tuple, str] = {}
    for w in words:
        where = f"{w.get('cat')}: {w.get('it')!r}"
        for f in ("it", "en", "pos"):
            if not w.get(f):
                problems.append(f"{where}: missing {f}")
        unknown = set(w) - set(FIELDS) - {"cat"}
        if unknown:
            problems.append(f"{where}: unknown fields {sorted(unknown)}")
        if w.get("pos") and w["pos"] not in POS:
            problems.append(f"{where}: pos {w['pos']!r} is not one of {sorted(POS)}")
        if w.get("level") and str(w["level"]) not in CEFR:
            problems.append(f"{where}: level {w['level']!r} is not one of {CEFR}")
        i = node_id(w)
        if i in ids:
            problems.append(f"{where}: id {i!r} also used by {ids[i]}")
        ids[i] = where
        # The same word may be two words of different parts of speech (German
        # sein "to be" / sein "his"); the card shows the part of speech.
        key = (str(w.get("it", "")).lower(), w.get("pos"))
        if key in seen:
            problems.append(f"{where}: listed twice (also {seen[key]})")
        seen[key] = where
    return problems


def dump_category(path: str | Path, cat: str, words: list[dict]) -> None:
    """Write one category file: a header and one flow mapping per word."""
    lines = [f"name: {CATEGORIES[cat]}", "words:"]
    for w in words:
        entry = {(L.current.code if k == "it" else k): w[k] for k in FIELDS if w.get(k) not in (None, "", [])}
        text = yaml.safe_dump(entry, default_flow_style=True, allow_unicode=True, width=10_000, sort_keys=False)
        lines.append("- " + text.strip())
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


# Frequency rank of a word's most common form -> CEFR level, for words without one.
LEVEL_BY_RANK = [(700, "A1"), (2000, "A2"), (5000, "B1"), (12000, "B2")]


def cefr_for_rank(rank: int) -> str:
    return next((lvl for top, lvl in LEVEL_BY_RANK if rank <= top), "C1")


def word_rank(w: dict, ranks: dict[str, int], verb_forms: dict[str, list[str]] | None = None) -> int:
    """Rank (1 = most common) of the word's most frequent form in subtitles.

    Infinitives are rarer than the forms people actually say ("fare" vs "fa"),
    so verbs use their conjugated forms; nouns and adjectives their plural and
    other endings too.
    """
    base = lemma(w["it"])
    head = base.split(" ")[0]
    forms = {base, head}
    if w.get("pl"):
        forms.add(lemma(str(w["pl"])).split(" ")[0])
    if w.get("pos") in ("noun", "adj") and len(head) > 2:
        stem = head[:-1]
        forms |= {stem + e for e in "aeio"}
    if w.get("pos") == "verb" and verb_forms:
        forms |= set(verb_forms.get(head, []))
    return min((ranks[f] for f in forms if f in ranks), default=10**9)
