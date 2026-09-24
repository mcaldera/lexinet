"""English words that descend from a Latin/Greek root, from English Wiktionary.

Builds (once, then cached) an index: plain root spelling -> common English words
whose etymology cites that root, e.g. "viaticum" -> ["voyage", "viaticum"].
Only words in the top 30k of an English frequency list are kept, most frequent
first, so examples are words a native speaker actually knows.
"""

from __future__ import annotations

import gzip
import json
import pickle
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

CACHE = Path.home() / ".cache" / "sprawl"
LATIN_URL = "https://kaikki.org/dictionary/Latin/kaikki.org-dictionary-Latin.jsonl.gz"
ENGLISH_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz"
EN_FREQ_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt"
MAX_RANK = 30_000
TEMPLATES = {"der", "der+", "bor", "bor+", "inh", "inh+", "lbor", "slbor", "uder"}
SOURCE_LANG = re.compile(r"^(la|grc)(-|$)")
WORD = re.compile(r"^[a-z]+$")


def plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.strip().lower().lstrip("*"))
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def _fetch(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {url} ...", file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    return path


def load_latin_derived() -> dict[str, list[str]]:
    """Latin lemma -> Latin words Wiktionary lists as derived from it
    (coquo -> coquus, coquina, concoquo, ...). Curated, so safe to follow."""
    cache = CACHE / "latin_derived.pkl"
    if cache.exists():
        return pickle.loads(cache.read_bytes())
    out: dict[str, list[str]] = {}
    path = _fetch(LATIN_URL, CACHE / "kaikki.org-dictionary-Latin.jsonl.gz")
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if '"derived"' not in line:
                continue
            e = json.loads(line)
            words = [plain(d.get("word", "")) for d in e.get("derived", []) if d.get("word")]
            if words:
                out.setdefault(plain(e.get("word", "")), []).extend(w for w in words if " " not in w)
    cache.write_bytes(pickle.dumps(out))
    return out


def load_index() -> dict[str, dict[str, int]]:
    """Plain Latin/Greek term -> {English word: frequency rank}."""
    cache = CACHE / "english_by_root.pkl"
    if cache.exists():
        return pickle.loads(cache.read_bytes())
    ranks: dict[str, int] = {}
    with open(_fetch(EN_FREQ_URL, CACHE / "en_50k.txt"), encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            ranks.setdefault(line.split(" ", 1)[0], i)
    found: dict[str, dict[str, int]] = {}
    path = _fetch(ENGLISH_URL, CACHE / "kaikki.org-dictionary-English.jsonl.gz")
    print("Indexing English Wiktionary etymologies (one-off, a few minutes) ...", file=sys.stderr)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if '"2": "la' not in line and '"2": "grc' not in line:
                continue  # cheap pre-filter before parsing JSON
            e = json.loads(line)
            word = e.get("word", "")
            rank = ranks.get(word, MAX_RANK + 1)
            if rank > MAX_RANK or not WORD.match(word):
                continue
            for t in e.get("etymology_templates", []):
                a = t.get("args", {})
                if t.get("name") in TEMPLATES and a.get("1") == "en" and SOURCE_LANG.match(a.get("2", "")):
                    term = a.get("3", "")
                    if term:
                        found.setdefault(plain(term), {})[word] = rank
    cache.write_bytes(pickle.dumps(found))
    return found


def lookup_keys(root: str) -> list[str]:
    """Spellings to try: the root itself, and the dictionary form of a Latin
    infinitive (coquere -> coquo), since Wiktionary lists verbs by 1st person."""
    key = plain(root)
    keys = [key]
    m = re.match(r"^(.+)(are|ere|ire)$", key)
    if m:
        keys.append(m.group(1) + "o")
    return keys


def english_for(
    root: str, index: dict[str, dict[str, int]], derived: dict[str, list[str]], limit: int = 5
) -> list[str]:
    """Most common English words citing the root itself or a Latin word derived from it."""
    ranks: dict[str, int] = {}
    for k in lookup_keys(root):
        for term in [k, *derived.get(k, [])]:
            for w, r in index.get(term, {}).items():
                ranks[w] = min(r, ranks.get(w, r))
    return sorted(ranks, key=ranks.get)[:limit]
