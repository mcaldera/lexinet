"""Example sentences for fill-the-gap reviews, from Tatoeba's Italian-English pairs.

Source: manythings.org/anki/ita-eng.zip (Tatoeba sentences, CC-BY 2.0 France;
attribution: tatoeba.org). Each word gets at most one short everyday sentence
in which it appears in its base form, so the gap's answer is the word itself:
    il cane -> {"it": "Il cane abbaia.", "en": "The dog is barking.", "blank": "cane"}
Simpler sentences win (their rarest word is as common as possible), then
shorter ones; a sentence with the word's own article is preferred.
"""

from __future__ import annotations

import pickle
import re
import urllib.request
import zipfile
from pathlib import Path

import languages as L

CACHE = Path.home() / ".cache" / "sprawl"
# Per language: ita-eng.zip, spa-eng.zip, ... (the current language's).
PAIRS_URL = "https://www.manythings.org/anki/{stem}-eng.zip"
MIN_WORDS, MAX_WORDS = 3, 10
TOKEN = re.compile(r"[^\W\d_]+", re.UNICODE)


def lemma(it: str) -> str:
    """The word without its article: "il cane" -> "cane", "l'acqua" -> "acqua"."""
    w = it.strip()
    m = L.current.article_re.match(w)
    return w[m.end() :].strip() if m and m.end() < len(w) else w


def find(word: str, sentence: str) -> tuple[int, int] | None:
    """Where `word` stands as a whole word in `sentence` (case-insensitive)."""
    m = re.search(rf"(?<![\w']){re.escape(word)}(?!\w)", sentence, flags=re.IGNORECASE)
    return m.span() if m else None


def load_pairs(path: Path | None = None) -> list[tuple[str, str]]:
    """(word's language, English) sentence pairs, one per sentence, 3-10 words (cached)."""
    stem = L.current.pairs
    path = path or CACHE / f"{stem}-eng.zip"
    cache = path.with_suffix(".pairs.pkl")
    if cache.exists() and cache.stat().st_mtime > path.stat().st_mtime:
        return pickle.loads(cache.read_bytes())
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        # manythings.org refuses Python's default user agent, and a bare "Mozilla/5.0"
        # gets an HTML error page (saved as the zip) from its firewall.
        agent = "Mozilla/5.0 (X11; Linux x86_64)"
        req = urllib.request.Request(PAIRS_URL.format(stem=stem), headers={"User-Agent": agent})
        path.write_bytes(urllib.request.urlopen(req).read())
    seen: set[str] = set()
    pairs: list[tuple[str, str]] = []
    text = zipfile.ZipFile(path).read(f"{stem}.txt").decode("utf-8")
    for line in text.splitlines():
        cols = line.split("\t")
        if len(cols) < 2:
            continue
        en, it = cols[0].strip(), cols[1].strip()
        n = len(TOKEN.findall(it))
        if it in seen or not MIN_WORDS <= n <= MAX_WORDS:
            continue
        seen.add(it)
        pairs.append((it, en))
    cache.write_bytes(pickle.dumps(pairs))
    return pairs


class Examples:
    """Finds the best example for a word among the pairs (indexed by word)."""

    def __init__(self, pairs: list[tuple[str, str]], ranks: dict[str, int]):
        self.pairs = pairs
        self.ranks = ranks
        self.index: dict[str, list[int]] = {}
        for i, (it, _) in enumerate(pairs):
            for tok in set(t.lower() for t in TOKEN.findall(it)):
                self.index.setdefault(tok, []).append(i)

    def _difficulty(self, it: str) -> int:
        return max((self.ranks.get(t.lower(), 60_000) for t in TOKEN.findall(it)), default=0)

    def pick(self, word: str, gloss: str = "") -> dict | None:
        """
        {it, en, blank} for `word` (e.g. "il cane"), or None if no good sentence.
        With a `gloss`, the English sentence must contain it (or its stem), which
        rules out homographs: "la porta" (door) in "Cosa la porta qui?" (what brings you here?).
        """
        stems = gloss_stems(gloss)
        base = lemma(word)
        toks = [t.lower() for t in TOKEN.findall(base)]
        if not toks:
            return None
        # The rarest token narrows the search most.
        ids = min((self.index.get(t, []) for t in toks), key=len)
        own_article = word.strip().lower() != base.lower()
        best = None
        for i in ids:
            it, en = self.pairs[i]
            span = find(base, it)
            if not span or (stems and not mentions(en, stems)):
                continue
            score = (
                self._difficulty(it),
                not (own_article and find(word.strip(), it)),
                len(it),
            )
            if best is None or score < best[0]:
                best = (score, {"it": it, "en": en, "blank": it[span[0] : span[1]]})
        return best[1] if best else None


EN_SKIP = {"to", "the", "a", "an", "be", "of", "one", "s", "something", "someone", "sb", "sth"}


def gloss_stems(gloss: str) -> list[str]:
    """Content words of each meaning in a gloss, cut to a stem: "to threaten" -> ["threa"]."""
    out = []
    for part in re.split(r"[,;/]", re.sub(r"\(.*?\)", "", gloss.lower())):
        words = [w for w in TOKEN.findall(part) if w not in EN_SKIP]
        if words:
            w = max(words, key=len)  # the head word is usually the longest
            out.append(w[: max(4, len(w) - 3)] if len(w) > 5 else w)
    return out


def mentions(sentence: str, stems: list[str]) -> bool:
    """Whether an English sentence contains a word starting with one of the stems."""
    toks = [t.lower() for t in TOKEN.findall(sentence)]
    return any(t.startswith(s) for s in stems for t in toks)


def add_to_graph(path: Path) -> int:
    """Add example sentences to an existing graph.json in place (nothing else changes)."""
    import json

    from build_graph import load_frequency_ranks

    graph = json.loads(path.read_text(encoding="utf-8"))
    pick = Examples(load_pairs(), load_frequency_ranks()).pick
    count = 0
    for node in graph["nodes"]:
        ex = pick(node["it"], node["en"])
        if ex:
            node["example"] = ex
            count += 1
        else:
            node.pop("example", None)
    path.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return count


if __name__ == "__main__":
    import sys

    for arg in sys.argv[1:]:
        print(f"{arg}: {add_to_graph(Path(arg))} examples")
