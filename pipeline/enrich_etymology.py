"""Fill empty root / root_lang / root_meaning columns of a word list from Wiktionary.

Usage:
    python pipeline/enrich_etymology.py data/words_oic.csv

Uses the same kaikki.org extracts and conservative root-family rules as
make_wordlist.py. Rows that already have a root are left untouched.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys

import make_wordlist as mw

COLUMNS = ["root", "root_lang", "root_meaning", "cognate", "cognate_note"]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv")
    args = p.parse_args(argv)

    rows = list(csv.DictReader(open(args.csv, encoding="utf-8")))
    fields = list(rows[0].keys()) + [c for c in COLUMNS if c not in rows[0]]
    lemmas, _ = mw.load_italian(mw.fetch(mw.KAIKKI.format(lang="Italian"), mw.CACHE / "kaikki.org-dictionary-Italian.jsonl.gz"))
    meanings, parent = mw.latin_index(mw.fetch(mw.KAIKKI.format(lang="Latin"), mw.CACHE / "kaikki.org-dictionary-Latin.jsonl.gz"))

    filled = 0
    for r in rows:
        for c in COLUMNS:
            r.setdefault(c, "")
        if r["root"]:
            continue
        lemma = re.sub(r"^(il|lo|la|i|gli|le) |^l'", "", r["italian"]).split(" ")[0]
        entries = lemmas.get(lemma)
        if not entries or " " in r["italian"].replace("l'", "").split(" ", 1)[-1]:
            continue  # unknown word, or a multi-word phrase whose root would be misleading
        ety = mw.etymon(max(entries, key=lambda e: len(e["senses"])), lemmas)
        if not ety:
            continue
        root, lang, gloss = ety
        gloss = mw.short_gloss(gloss, "") if gloss else ""
        if "Latin" in lang:
            head = mw.latin_ancestor(root, parent, meanings)
            if head != root:
                root, gloss = head, ""
            gloss = gloss or meanings.get(mw.plain(root).lstrip("*"), "")
        r.update(root=root, root_lang=lang, root_meaning=gloss)
        filled += 1

    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"filled roots for {filled} of {len(rows)} words -> {args.csv}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
    sys.exit(main())
