"""Grow root families: add common Italian words that share a root with the list.

Usage:
    python pipeline/expand_roots.py data/words_oic.csv [--family 8] [--max-rank 20000]

A root hub is only interesting with several descendants. For every root in the
list, this finds other common Italian words (OpenSubtitles frequency rank up to
--max-rank) whose Wiktionary etymology leads to the same root and that share a
stem with a word already in the family (so prefixes like re- don't count), with the same
conservative rules as make_wordlist.py, and appends the most frequent ones until
the family has --family words. Families that would stay below 3 words get
nothing. New rows get an English gloss, part of speech, a level from frequency
and no category (build_graph.py gives them one only if they clearly fit). Rows
already in the list are kept as they are. Run split_levels.py afterwards.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_wordlist as mw  # noqa: E402
from build_graph import root_key  # noqa: E402
from scrape_oic import freq_level  # noqa: E402

ARTICLE = re.compile(r"^(il|lo|la|i|gli|le) |^l'")
# Glosses that only describe another word ("pejorative of caso") teach nothing.
ABOUT_WORD = re.compile(r"\b(pejorative|diminutive|augmentative|endearing|alternative|synonym|form) of\b", re.I)


def root_of(entry: dict, lemmas: dict, parent: dict, meanings: dict) -> tuple[str, str, str] | None:
    """(root, language, meaning) the way enrich_etymology.py fills them."""
    ety = mw.etymon(entry, lemmas)
    if not ety:
        return None
    root, lang, gloss = ety
    gloss = mw.short_gloss(gloss, "") if gloss else ""
    if "Latin" in lang:
        head = mw.latin_ancestor(root, parent, meanings)
        if head != root:
            root, gloss = head, ""
        gloss = gloss or meanings.get(mw.plain(root).lstrip("*"), "")
    return root, lang, gloss


def candidate(lemma: str, entries: list[dict]) -> dict | None:
    """A usable new row for `lemma` (gloss, POS, article), or None."""
    entry = max(entries, key=lambda e: sum(1 for s in e["senses"] if not s.get("form_of")))
    sense = mw.usable_sense(entry)
    if not sense:
        return None
    pos = mw.CONTENT_POS[entry["pos"]]
    gloss = mw.short_gloss(sense["glosses"][0], pos)
    if not gloss or gloss.lower() == lemma or len(gloss.split()) > 4 or ABOUT_WORD.search(gloss):
        return None
    italian = lemma
    if pos == "noun":
        heads = entry.get("head_templates", [{}])
        gender = (heads[0].get("args", {}) or {}).get("1", "") if heads else ""
        if not gender or gender.endswith("-p"):
            return None  # unknown gender or plural-only
        italian = mw.article(lemma, gender) + lemma
    return {"italian": italian, "english": gloss, "pos": pos, "entry": entry}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", type=Path)
    p.add_argument("--family", type=int, default=8, help="grow each root family up to this many words")
    p.add_argument("--min-family", type=int, default=3, help="skip roots that can't reach this many")
    p.add_argument("--max-rank", type=int, default=50000, help="only words at least this common")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    rows = list(csv.DictReader(open(args.csv, encoding="utf-8")))
    fields = list(rows[0].keys())
    lemmas, _ = mw.load_italian(mw.fetch(mw.KAIKKI.format(lang="Italian"), mw.CACHE / "kaikki.org-dictionary-Italian.jsonl.gz"))
    meanings, parent = mw.latin_index(mw.fetch(mw.KAIKKI.format(lang="Latin"), mw.CACHE / "kaikki.org-dictionary-Latin.jsonl.gz"))
    ranks: dict[str, int] = {}
    for i, line in enumerate(open(mw.CACHE / "it_50k.txt", encoding="utf-8"), 1):
        ranks.setdefault(line.split(" ", 1)[0], i)

    family = Counter(root_key(r["root"]) for r in rows if r.get("root"))
    # Stems of each family's words: a real descendant shares one (fratell-ino).
    stems: dict[str, set[str]] = {}
    for r in rows:
        lemma = mw.plain(ARTICLE.sub("", r["italian"]).split(" ")[0]).lower()
        if r.get("root") and len(lemma) >= 3:
            stems.setdefault(root_key(r["root"]), set()).add(lemma[:3])
    have = {mw.plain(ARTICLE.sub("", r["italian"])) for r in rows}
    glosses = {r["english"].lower() for r in rows}

    # Common Italian words by root, most frequent first.
    by_root: dict[str, list[tuple[int, str, tuple[str, str, str]]]] = {}
    for lemma, entries in lemmas.items():
        rank = ranks.get(lemma)
        if not rank or rank > args.max_rank or len(lemma) < 3 or mw.plain(lemma) in have:
            continue
        found = root_of(max(entries, key=lambda e: len(e["senses"])), lemmas, parent, meanings)
        # Prefix look-alikes (re-cinzione under rēx "king") don't share a stem.
        if found and mw.plain(lemma)[:3] in stems.get(root_key(found[0]), set()):
            by_root.setdefault(root_key(found[0]), []).append((rank, lemma, found))

    added: list[dict] = []
    for key, n in family.items():
        want = args.family - n
        picks = []
        for rank, lemma, (root, lang, meaning) in sorted(by_root.get(key, [])):
            if len(picks) >= want:
                break
            c = candidate(lemma, lemmas[lemma])
            if not c or c["english"].lower() in glosses:
                continue  # unusable, or ambiguous in the English -> Italian direction
            picks.append((c, rank, root, lang, meaning))
            glosses.add(c["english"].lower())
        if n + len(picks) < args.min_family:
            for c, *_ in picks:
                glosses.discard(c["english"].lower())
            continue
        for c, rank, root, lang, meaning in picks:
            level = freq_level(c["italian"], ranks)
            added.append(
                {
                    **{f: "" for f in fields},
                    "italian": c["italian"],
                    "english": c["english"],
                    "pos": c["pos"],
                    "level": level,
                    "root": root,
                    "root_lang": lang,
                    "root_meaning": meaning,
                }
            )

    grown = Counter(root_key(r["root"]) for r in rows + added if r.get("root"))
    hubs = sum(1 for v in grown.values() if v >= 2)
    print(
        f"{len(added)} words added to {len({root_key(r['root']) for r in added})} root families; "
        f"roots with 2+ words: {sum(1 for v in family.values() if v >= 2)} -> {hubs}, with 5+: "
        f"{sum(1 for v in family.values() if v >= 5)} -> {sum(1 for v in grown.values() if v >= 5)}; "
        f"levels {dict(Counter(r['level'] for r in added))}",
        file=sys.stderr,
    )
    if args.dry_run:
        for r in added[:40]:
            print(f"  {r['root']:>12}  {r['italian']} = {r['english']} ({r['pos']}, {r['level']})", file=sys.stderr)
        return 0
    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows + added)
    return 0


if __name__ == "__main__":
    sys.exit(main())
