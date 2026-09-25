"""Split CEFR levels into evenly sized sub-levels (tiers) for a word list.

Usage:
    python pipeline/split_levels.py data/words_oic.csv [-n 10]

Scraped lists are mostly A1, so one tier per CEFR level makes the first tier
huge and the last ones thin. This rewrites the `tier` and `level` columns in
place: each CEFR level gets a share of the `n` tiers proportional to its size
(at least one), and its words are dealt out common-first (OpenSubtitles
frequency), so A1.1 holds the most frequent A1 words. Levels become "A1.1",
"A1.2", ... ("B2" when a level keeps a single tier). Running it again re-splits
from the CEFR part of `level`, so it is idempotent.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

CACHE = Path.home() / ".cache" / "sprawl"
CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]
ARTICLE = re.compile(r"^(il|lo|la|i|gli|le|un|uno|una)\s+|^(l'|un')", re.I)


def load_ranks(path: Path = CACHE / "it_50k.txt") -> dict[str, int]:
    ranks: dict[str, int] = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                ranks.setdefault(line.split(" ", 1)[0], i)
    return ranks


def rank_of(word: str, ranks: dict[str, int]) -> int:
    return ranks.get(ARTICLE.sub("", word).split(" ")[0].lower(), 10**9)


def shares(sizes: list[int], n: int) -> list[int]:
    """Tiers per level: proportional to size, at least 1 each, summing to max(n, len(sizes))."""
    n = max(n, len(sizes))
    total = sum(sizes)
    exact = [s * n / total for s in sizes]
    k = [max(1, int(e)) for e in exact]
    # Largest remainder first until the tiers add up; never below one per level.
    order = sorted(range(len(sizes)), key=lambda i: exact[i] - int(exact[i]), reverse=True)
    i = 0
    while sum(k) < n:
        k[order[i % len(order)]] += 1
        i += 1
    while sum(k) > n:
        j = max((i for i in range(len(k)) if k[i] > 1), key=lambda i: k[i] - exact[i])
        k[j] -= 1
    return k


def split_rows(rows: list[dict], n: int, ranks: dict[str, int]) -> list[dict]:
    """Rows with new `tier`/`level`, ordered by tier."""
    by_level: dict[str, list[dict]] = {}
    for r in rows:
        base = (r.get("level") or "").split(".")[0].upper()
        by_level.setdefault(base if base in CEFR else "C1", []).append(r)
    levels = [lvl for lvl in CEFR if lvl in by_level]
    ks = shares([len(by_level[lvl]) for lvl in levels], n)
    out: list[dict] = []
    tier = 0
    for lvl, k in zip(levels, ks):
        words = sorted(by_level[lvl], key=lambda r: (rank_of(r["italian"], ranks), r["italian"]))
        for part in range(k):
            tier += 1
            chunk = words[len(words) * part // k : len(words) * (part + 1) // k]
            name = lvl if k == 1 else f"{lvl}.{part + 1}"
            out.extend({**r, "tier": str(tier), "level": name} for r in chunk)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", type=Path)
    p.add_argument("-n", "--tiers", type=int, default=10)
    args = p.parse_args(argv)

    with open(args.csv, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    for col in ("tier", "level"):
        if col not in fields:
            fields.append(col)
    out = split_rows(rows, args.tiers, load_ranks())
    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    counts: dict[str, int] = {}
    for r in out:
        counts[r["level"]] = counts.get(r["level"], 0) + 1
    print(f"{len(out)} words -> {counts}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
