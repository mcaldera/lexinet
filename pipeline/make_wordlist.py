"""Extend a word list with the most frequent Italian words, using Wiktionary data.

Usage:
    python pipeline/make_wordlist.py data/words.csv -n 1000 -o data/words_1000.csv

Existing rows are kept as they are (hand-curated rows win). New rows come from the
OpenSubtitles frequency list, lemmatised and described with the kaikki.org
Wiktionary extract (CC BY-SA): English gloss, part of speech, article from
gender, theme from Wiktionary topic categories, and the etymological root with
its language; root meanings come from the Latin extract. Cognates are left
blank: Wiktionary has no reliable machine-readable English-cousin data.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import pickle
import re
import sys
import unicodedata
import urllib.request
from collections import Counter
from pathlib import Path

import languages as L

CACHE = Path.home() / ".cache" / "sprawl"
KAIKKI = "https://kaikki.org/dictionary/{lang}/kaikki.org-dictionary-{lang}.jsonl.gz"
FREQ_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/it/it_50k.txt"

CONTENT_POS = {"noun": "noun", "verb": "verb", "adj": "adj", "adv": "adv"}
SKIP_TAGS = {"vulgar", "offensive", "derogatory", "slur", "slang", "obsolete", "archaic", "rare", "dated"}
ETY_TEMPLATES = {"inh", "inh+", "der", "der+", "bor", "bor+", "lbor", "slbor"}
AFFIX_TEMPLATES = {"af", "affix", "suffix", "prefix", "compound", "com"}
# Wiktionary's "origin unknown / uncertain": its guesses (zorro "perhaps from Middle
# French sor") are no etymology to show, as a wrong one is worse than none.
UNCERTAIN_TEMPLATES = {"unk", "unc", "unknown", "uncertain"}
LANGS = {
    "la": "Latin",
    "la-lat": "Late Latin",
    "la-vul": "Vulgar Latin",
    "la-med": "Medieval Latin",
    "la-eme": "Early Medieval Latin",
    "la-new": "New Latin",
    "grc": "Ancient Greek",
    "frk": "Frankish",
    "gem-pro": "Proto-Germanic",
    "gmw-pro": "Proto-West Germanic",
    "osx": "Old Saxon",
    "odt": "Old Dutch",
    "lng": "Lombardic",
    "got": "Gothic",
    "fr": "French",
    "fro": "Old French",
    "pro": "Old Occitan",
    "es": "Spanish",
    "en": "English",
    "de": "German",
    "ar": "Arabic",
    "ang": "Old English",
    "enm": "Middle English",
    "dum": "Middle Dutch",
    "nl": "Dutch",
    "gml": "Middle Low German",
    "goh": "Old High German",
    "gmh": "Middle High German",
    "non": "Old Norse",
    "frm": "Middle French",
    "xno": "Anglo-Norman",
    "osp": "Old Spanish",
    "pt": "Portuguese",
    "ca": "Catalan",
    "oc": "Occitan",
    "grc-koi": "Koine Greek",
    "el": "Greek",
    "ine-pro": "Proto-Indo-European",
    "tr": "Turkish",
    "fa": "Persian",
    "he": "Hebrew",
    "sa": "Sanskrit",
    "ru": "Russian",
    "ja": "Japanese",
    "it": "Italian",
    "eu": "Basque",
    "gl": "Galician",
    "xaa": "Andalusian Arabic",
    "la-ecc": "Ecclesiastical Latin",
    "roa-oca": "Old Catalan",
    "nci": "Classical Nahuatl",
    "cel-pro": "Proto-Celtic",
    "xce": "Celtiberian",
    "gkm": "Byzantine Greek",
    "qu": "Quechua",
    "tnq": "Taíno",
    "rmq": "Caló",
    "tt": "Tatar",
    "pl": "Polish",
}
NON_GLOSS = re.compile(r"\b(form|degree|participle|plural|spelling|abbreviation|synonym) of\b", re.I)
FIELDS = ["italian", "english", "pos", "theme", "root", "root_lang", "root_meaning", "cognate", "cognate_note"]


def fetch(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {url} ...", file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    return path


def plain(s: str) -> str:
    """Lowercase without diacritics: "pānis" -> "panis"."""
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def article(word: str, gender: str) -> str:
    """Definite article for a singular Italian noun."""
    w = word.lower()
    if gender.startswith("f"):
        return "l'" if w[0] in "aeiouàèéìòù" else "la "
    if w[0] in "aeiouàèéìòù":
        return "l'"
    if re.match(r"(s[^aeiou]|z|gn|ps|pn|x|y|i[aeiou])", w):
        return "lo "
    return "il "


def short_gloss(gloss: str, pos: str) -> str:
    """"nice, fair, fine; beautiful (of the weather)" -> "nice"; verbs get "to "."""
    g = re.sub(r"\([^)]*\)", "", gloss)
    g = re.split(r"[;,:]", g)[0]
    g = re.sub(r"[()\"“”]", "", g).strip(" .!?")
    g = re.sub(r"\s+", " ", g)
    if not g or NON_GLOSS.search(g):
        return ""
    if pos == "verb" and not g.startswith("to "):
        g = "to " + g
    if pos == "noun":
        g = re.sub(r"^(a|an|the) ", "", g)
    return g


def usable_sense(entry: dict) -> dict | None:
    for s in entry.get("senses", []):
        tags = set(s.get("tags", []))
        if s.get("form_of") or "form-of" in tags or tags & SKIP_TAGS or not s.get("glosses"):
            continue
        if NON_GLOSS.search(s["glosses"][0]):
            continue
        return s
    return None


def affix_base(entry: dict, lang: str) -> str:
    """Base word of an affix/compound etymology: {{af|it|ferire|-ito}} -> "ferire"."""
    for t in entry.get("etymology_templates", []):
        a = t.get("args", {})
        if t.get("name") in AFFIX_TEMPLATES and a.get("1") == lang:
            base = a.get("2") or ""
            # A prefix and its base ({{af|de|an-|bieten}}): the base is the word.
            if base.endswith("-") or t.get("name") == "prefix":
                base = a.get("3") or ""
            if base and not base.startswith("-") and not base.endswith("-"):
                return base
    return ""


def etymon(entry: dict, lemmas: dict | None = None, depth: int = 0) -> tuple[str, str, str] | None:
    """(root, language, gloss) from the first inherited/derived/borrowed template
    that leaves Italian (skipping Old Italian steps). Words formed inside Italian
    ("ferito" = ferire + -ito) inherit the root of their Italian base."""
    if any(t.get("name") in UNCERTAIN_TEMPLATES for t in entry.get("etymology_templates", [])):
        return None
    base = affix_base(entry, L.current.code)
    if base and lemmas and base in lemmas and depth < 3:
        found = etymon(lemmas[base][0], lemmas, depth + 1)
        if found:
            return found
    for t in entry.get("etymology_templates", []):
        a = t.get("args", {})
        if t.get("name") not in ETY_TEMPLATES or a.get("1") != L.current.code:
            continue
        code, term = a.get("2", ""), a.get("3", "")
        if not term or code in {L.current.code, "und", *L.current.older} or term.startswith("-"):
            continue
        gloss = a.get("5") or a.get("t") or a.get("gloss") or ""
        return term, LANGS.get(code, code), gloss
    return None


def compact(e: dict) -> dict:
    """Keep only the fields used here, so the index can be cached."""
    return {
        "pos": e["pos"],
        "senses": [
            {
                "glosses": s.get("glosses", [])[:1],
                "tags": s.get("tags", []),
                "form_of": s.get("form_of"),
                "cats": [c["orig"][3:] for c in s.get("categories", []) if str(c.get("orig", "")).startswith(f"{L.current.code}:")],
            }
            for s in e.get("senses", [])
        ],
        "head_templates": [{"args": h.get("args", {})} for h in e.get("head_templates", [])[:1]],
        "etymology_templates": [
            {"name": t.get("name"), "args": {k: t["args"].get(k) for k in ("1", "2", "3", "5", "t", "gloss")}}
            for t in e.get("etymology_templates", [])
            if t.get("name") in ETY_TEMPLATES | AFFIX_TEMPLATES | UNCERTAIN_TEMPLATES | {"cog"}
        ],
    }


def load_italian(path: Path) -> tuple[dict[str, list[dict]], dict[str, str]]:
    """Lemma entries by word (content POS only), and inflected form -> lemma."""
    cache = path.with_suffix(".index.pkl")
    if cache.exists() and cache.stat().st_mtime > path.stat().st_mtime:
        return pickle.loads(cache.read_bytes())
    lemmas: dict[str, list[dict]] = {}
    form_of: dict[str, str] = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            word, pos = e.get("word", ""), e.get("pos")
            if pos not in CONTENT_POS or not word or word[0].isupper() or " " in word:
                continue
            for s in e.get("senses", []):
                for fo in s.get("form_of") or []:
                    form_of.setdefault(word, fo.get("word", ""))
            if usable_sense(e):
                lemmas.setdefault(word, []).append(compact(e))
    cache.write_bytes(pickle.dumps((lemmas, form_of)))
    return lemmas, form_of


def latin_index(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """From the Latin extract: plain spelling -> first gloss, and plain spelling ->
    parent word (a lemma for inflected forms like factus -> faciō, or the base of
    a derivation like iūstitia -> iūstus)."""
    cache = path.with_suffix(".index.pkl")
    if cache.exists() and cache.stat().st_mtime > path.stat().st_mtime:
        return pickle.loads(cache.read_bytes())
    meaning: dict[str, str] = {}
    parent: dict[str, str] = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            key = plain(e.get("word", ""))
            if not key:
                continue
            s = usable_sense(e)
            gloss = short_gloss(s["glosses"][0], e.get("pos", "")) if s else ""
            if gloss and key not in meaning:
                meaning[key] = gloss
            if key in parent:
                continue
            for sense in e.get("senses", []):
                for fo in sense.get("form_of") or []:
                    if fo.get("word"):
                        parent[key] = fo["word"]
                        break
                if key in parent:
                    break
            else:
                base = affix_base(e, "la")
                if base:
                    parent[key] = base
    cache.write_bytes(pickle.dumps((meaning, parent)))
    return meaning, parent


def latin_ancestor(root: str, parent: dict[str, str], meaning: dict[str, str]) -> str:
    """Climb to the family's head word, but only from words that have no meaning of
    their own (pure inflections like fīnītus -> fīniō). Words with their own entry
    are often homographs (vīta "life" vs the imperative of vītō "avoid"), and a
    wrong etymology is worse than none."""
    for _ in range(3):
        key = plain(root).lstrip("*")
        if key in meaning:
            break
        up = parent.get(key)
        if not up or plain(up) == plain(root):
            break
        root = up
    return root


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", help="existing word list to extend (kept as-is)")
    p.add_argument("-n", "--size", type=int, default=1000)
    p.add_argument("-o", "--out", required=True)
    args = p.parse_args(argv)

    base = list(csv.DictReader(open(args.csv, encoding="utf-8")))
    have_lemma = {plain(re.sub(r"^(il|lo|la|i|gli|le) |^l'", "", r["italian"])) for r in base}
    have_gloss = {r["english"].lower() for r in base}

    it_path = fetch(KAIKKI.format(lang="Italian"), CACHE / "kaikki.org-dictionary-Italian.jsonl.gz")
    la_path = fetch(KAIKKI.format(lang="Latin"), CACHE / "kaikki.org-dictionary-Latin.jsonl.gz")
    freq_path = fetch(FREQ_URL, CACHE / "it_50k.txt")
    print("Reading Italian Wiktionary ...", file=sys.stderr)
    lemmas, form_of = load_italian(it_path)

    picked: list[dict] = []
    for line in open(freq_path, encoding="utf-8"):
        if len(base) + len(picked) >= args.size:
            break
        form = line.split(" ", 1)[0].strip().lower()
        # Frequent forms are usually inflections: "sono" is "I am" (essere), not
        # the rare noun "sono". Prefer the lemma a form belongs to.
        target = form_of.get(form, "")
        lemma = target if target in lemmas else form if form in lemmas else ""
        if len(lemma) < 3 or plain(lemma) in have_lemma:
            continue
        # Most senses = the main reading ("bene": adverb "well", not adjective "upper-class").
        entry = max(lemmas[lemma], key=lambda e: sum(1 for s in e["senses"] if not s.get("form_of")))
        sense = usable_sense(entry)
        pos = CONTENT_POS[entry["pos"]]
        gloss = short_gloss(sense["glosses"][0], pos)
        if not gloss or gloss.lower() == lemma or len(gloss.split()) > 4 or gloss.lower() in have_gloss:
            continue  # unusable or ambiguous in the English -> Italian direction
        italian = lemma
        if pos == "noun":
            heads = entry.get("head_templates", [{}])
            gender = (heads[0].get("args", {}) or {}).get("1", "") if heads else ""
            if not gender or gender.endswith("-p"):
                continue  # unknown gender or plural-only
            italian = article(lemma, gender) + lemma
        cats = sense["cats"]  # only the chosen sense: "stare" is not about mathematics
        picked.append(
            {"entry": entry, "italian": italian, "english": gloss, "pos": pos, "cats": cats, "ety": etymon(entry, lemmas)}
        )
        have_lemma.add(plain(lemma))
        have_gloss.add(gloss.lower())

    # Theme = the word's most widespread topic category, so themes stay broad.
    counts = Counter(c for w in picked for c in set(w["cats"]))
    print("Reading Latin Wiktionary ...", file=sys.stderr)
    meanings, parent = latin_index(la_path)

    rows = [{k: r.get(k, "") for k in FIELDS} for r in base]
    for w in picked:
        best = max(w["cats"], key=lambda c: counts[c]) if w["cats"] else ""
        theme = best.lower() if best and counts[best] >= 3 else ""  # drop one-off categories
        root, lang, gloss = w["ety"] or ("", "", "")
        gloss = short_gloss(gloss, "") if gloss else ""
        if root and "Latin" in lang:
            head = latin_ancestor(root, parent, meanings)
            if head != root:  # group the family under its head word, with its meaning
                root, gloss = head, ""
            gloss = gloss or meanings.get(plain(root).lstrip("*"), "")
        rows.append(
            {
                "italian": w["italian"],
                "english": w["english"],
                "pos": w["pos"],
                "theme": theme,
                "root": root,
                "root_lang": lang if root else "",
                "root_meaning": gloss,
                "cognate": "",
                "cognate_note": "",
            }
        )

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        wr.writeheader()
        wr.writerows(rows)
    new = rows[len(base) :]
    print(
        f"{len(rows)} words ({len(new)} new) -> {args.out}; "
        f"{sum(bool(r['root']) for r in new)} with root, {sum(bool(r['theme']) for r in new)} with theme, "
        f"POS {dict(Counter(r['pos'] for r in new))}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
