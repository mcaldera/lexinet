"""Correct a built graph (and its word list) in place, without a rebuild.

Usage:
    python pipeline/fix_vocab.py data/graph_oic.json --csv data/words_oic.csv \
        --fixes data/fixes_oic.csv data/review_oic.csv

Rebuilds move regions and home categories (see CLAUDE.md), so corrections are
applied to the existing graph: node ids stay the same, so progress is kept
(a removed word's progress is simply ignored by the app).

A fixes file has the columns italian, field, value, note. `field` is one of
italian, english, pos, root, root_lang, root_meaning, cognate, or remove
(value "yes"). An empty value means "not decided yet" and is skipped; "-"
clears the field. Rows match a word by its Italian as it was first written,
so rerunning is harmless.

Afterwards every generated English cousin (hint) is picked again with the
meaning check (build_graph.add_cognates), and root hubs are rebuilt from the
words' roots with their English examples filtered the same way. Curated
cousins (from the word list or a fixes file) are left alone.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_graph as bg  # noqa: E402

FIELDS = {"italian", "english", "pos", "root", "root_lang", "root_meaning", "cognate", "remove"}
NODE_KEY = {"italian": "it", "english": "en"}


def load_fixes(paths: list[str]) -> list[dict]:
    rows = []
    for p in paths:
        if not Path(p).exists():
            continue
        for r in csv.DictReader(open(p, encoding="utf-8")):
            if (r.get("value") or "").strip() == "":
                continue  # not decided yet
            if r["field"] not in FIELDS:
                raise ValueError(f"{p}: unknown field {r['field']!r}")
            rows.append({k: (v or "").strip() for k, v in r.items()})
    return rows


def generated(node: dict) -> bool:
    """A cousin picked by the pipeline (not curated), or none yet."""
    return not node.get("cognate") or (node.get("cognate_note") or "").startswith("shares the")


def apply_to_nodes(graph: dict, fixes: list[dict]) -> tuple[set[str], set[str]]:
    """Returns the ids removed and the ids whose cousin was curated here."""
    by_it = {n["it"].lower(): n for n in graph["nodes"]}
    by_id = {n["id"]: n for n in graph["nodes"]}
    removed: set[str] = set()
    curated: set[str] = set()
    for f in fixes:
        node = by_it.get(f["italian"].lower()) or by_id.get(bg.slug(f["italian"]))
        if node is None:
            continue
        value = None if f["value"] == "-" else f["value"]
        if f["field"] == "remove":
            removed.add(node["id"])
        elif f["field"] == "cognate":
            node["cognate"], node["cognate_note"] = value, None
            curated.add(node["id"])
        else:
            node[NODE_KEY.get(f["field"], f["field"])] = value
    return removed, curated


def remove_nodes(graph: dict, removed: set[str]) -> None:
    """Drop words, their links and mentions; reconnect what they held together
    with the strongest remaining candidate link."""
    graph["nodes"] = [n for n in graph["nodes"] if n["id"] not in removed]
    graph["edges"] = [e for e in graph["edges"] if e["source"] not in removed and e["target"] not in removed]
    cands = graph.get("candidates") or {}
    for k in list(cands):
        if k in removed:
            del cands[k]
        else:
            cands[k] = [c for c in cands[k] if c["id"] not in removed]
    for r in graph.get("regions") or []:
        r["words"] = [w for w in r["words"] if w not in removed]
    if graph["seed"] in removed:
        graph["seed"] = graph["nodes"][0]["id"]

    import networkx as nx

    while True:
        g = nx.Graph()
        g.add_nodes_from(n["id"] for n in graph["nodes"])
        g.add_edges_from((e["source"], e["target"]) for e in graph["edges"])
        parts = sorted(nx.connected_components(g), key=len)
        if len(parts) <= 1:
            return
        part = parts[0]
        best = max(
            ((a, c) for a in part for c in cands.get(a, []) if c["id"] not in part),
            key=lambda ac: ac[1]["weight"],
            default=None,
        )
        if best is None:
            raise ValueError(f"cannot reconnect {sorted(part)}")
        a, c = best
        comps = c.get("components") or {"semantic": c["weight"]}
        graph["edges"].append(
            {
                "source": a,
                "target": c["id"],
                "weight": c["weight"],
                "reason": max(comps, key=lambda k: bg.WEIGHTS[k] * comps[k]),
                "components": comps,
                "via": "tree",
            }
        )
        c["linked"] = True


def apply_to_csv(path: str, fixes: list[dict]) -> int:
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    fields = list(rows[0].keys())
    by_it = {r["italian"].lower(): r for r in rows}
    changed = 0
    for f in fixes:
        r = by_it.get(f["italian"].lower())
        if r is None:
            continue
        value = "" if f["value"] == "-" else f["value"]
        if f["field"] == "remove":
            r["_remove"] = "yes"
        elif f["field"] == "cognate":
            r["cognate"], r["cognate_note"] = value, ""
        else:
            r[f["field"]] = value
        changed += 1
    rows = [r for r in rows if not r.pop("_remove", None)]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return changed


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("graph")
    p.add_argument("--csv", help="word list to correct as well, so a rebuild keeps the fixes")
    p.add_argument("--fixes", nargs="*", default=[])
    p.add_argument("--model", default=bg.DEFAULT_MODEL)
    args = p.parse_args(argv)

    graph = json.loads(Path(args.graph).read_text(encoding="utf-8"))
    fixes = load_fixes(args.fixes)
    removed, curated = apply_to_nodes(graph, fixes)
    remove_nodes(graph, removed)
    if args.csv:
        apply_to_csv(args.csv, fixes)

    import english_roots

    index, derived = english_roots.load_index(), english_roots.load_latin_derived()
    english = lambda root: english_roots.english_for(root, index, derived)  # noqa: E731
    embed = bg.make_embedder(args.model)
    before = {n["id"]: n.get("cognate") for n in graph["nodes"]}
    bg.add_cognates(graph["nodes"], english, embed, only=lambda n: n["id"] not in curated and generated(n))
    graph["roots"] = bg.root_hubs(graph["nodes"], english, embed)
    bg.validate_graph(graph)
    Path(args.graph).write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    changed = [n for n in graph["nodes"] if n.get("cognate") != before[n["id"]]]
    print(
        f"{len(fixes)} fixes, {len(removed)} words removed, {len(changed)} cousins changed "
        f"({sum(bool(n.get('cognate')) for n in graph['nodes'])} words have one), "
        f"{len(graph['roots'])} root hubs -> {args.graph}",
        file=sys.stderr,
    )
    for n in changed:
        print(f"  {n['it']}: {before[n['id']] or '—'} -> {n.get('cognate') or '—'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
