"""A vocabulary in another language, translated from the Italian one, and checked.

Usage:
    python pipeline/translate_vocab.py --lang es TRANSLATIONS data/vocab data/vocab/es
    python pipeline/translate_vocab.py --lang es --check data/vocab/es

TRANSLATIONS holds one <category>.txt per category file, one line per Italian
word in the same order:

    la mano                     the word (with its article, as in the Italian files)
    la calle | street / road    ... with its own English where the senses differ
    -                           no word for this concept (la merenda): left out
    + estar | to be (state) | verb    an extra word (a concept that splits in two)

Each line becomes `{es: la mano, en: hand, pos: noun, level: A1, concept: la-mano}`:
the English, part of speech and level come from the Italian word, `concept` is
its id (for linking the languages later). Nouns that list a plural in Italian
get theirs from Wiktionary.

Every word is then checked against Wiktionary (kaikki.org) and what doesn't fit
goes into REVIEW.md next to the files: not found, another part of speech, an
article that doesn't match the gender, or no sense that matches the English.
A flag is a question for someone fluent, not necessarily a mistake.
"""

from __future__ import annotations

import argparse
import difflib
import gzip
import json
import pickle
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import languages as L  # noqa: E402
import vocab as V  # noqa: E402

CACHE = Path.home() / ".cache" / "sprawl"
POS = {"noun", "verb", "adj", "adv", "pron", "conj", "prep", "num", "intj", "det", "article", "phrase", "particle"}
# Wiktionary's names where they differ from the vocabulary's.
POS_ALIASES = {"interj": {"intj"}, "pron": {"pron", "det"}, "num": {"num", "adj", "noun"}, "adj": {"adj", "det"}}

# Article -> (genders it fits, as Wiktionary's first letter: m, f, n, p = plural only).
ARTICLES = {
    "es": {
        "el": "m", "un": "m", "la": "f", "una": "f",
        "los": "mp", "unos": "mp", "las": "fp", "unas": "fp",
    },
    "de": {"der": "m", "das": "n", "die": "fp", "ein": "mn", "eine": "f"},
}
PLURAL_ARTICLE = {
    "es": {"el": "los", "la": "las", "un": "unos", "una": "unas"},
    "de": {"der": "die", "die": "die", "das": "die"},
}
# Plural forms Wiktionary lists but nobody should learn (Hünde, Mädchens).
ODD_FORM = {"nonstandard", "archaic", "obsolete", "dated", "regional", "dialectal", "uncommon", "rare", "error-unknown-tag", "diminutive", "feminine"}


def plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def lexicon(lang: L.Lang) -> dict[str, list[dict]]:
    """Word -> its entries: {pos, gender, plurals, glosses} (cached)."""
    path = CACHE / lang.kaikki
    cache = path.with_suffix(".lex.pkl")
    if cache.exists() and cache.stat().st_mtime > path.stat().st_mtime:
        return pickle.loads(cache.read_bytes())
    lex: dict[str, list[dict]] = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            word, pos = e.get("word", ""), e.get("pos", "")
            if not word or pos not in POS:
                continue
            head = (e.get("head_templates") or [{}])[0].get("args", {})
            glosses = [g for s in e.get("senses", []) for g in s.get("glosses", [])[:1]]
            plurals = [
                x["form"]
                for x in e.get("forms", [])
                if "plural" in x.get("tags", []) and not ODD_FORM & set(x.get("tags", []))
            ]
            lex.setdefault(word.lower(), []).append(
                {"pos": pos, "gender": str(head.get("1", "")), "plurals": plurals, "glosses": glosses}
            )
    cache.write_bytes(pickle.dumps(lex))
    return lex


def split_article(word: str, lang: L.Lang) -> tuple[str, str]:
    m = lang.article_re.match(word)
    return (m.group(0).strip().lower(), word[m.end() :]) if m else ("", word)


STOP = {"to", "the", "a", "an", "of", "be", "one", "s", "something", "someone", "up", "out", "for", "with", "on", "in"}


def gloss_stems(en: str) -> set[str]:
    words = re.findall(r"[a-z]+", re.sub(r"\([^)]*\)", "", en.lower()))
    return {w[:5] for w in words if w not in STOP and len(w) > 2}


# Wiktionary entries that only point at another word: follow them.
POINTER = re.compile(r"^(?:infinitive of (\S+) combined with \w+|(?:[\w/]+ )?plural of (\S+?))(?:\s|$|[,;.(])")


def lookup(word: str, lex: dict[str, list[dict]], depth: int = 0) -> list[dict]:
    """A word's entries, with those that only point elsewhere ("plural of
    patilla", "infinitive of lavar combined with se") replaced by the target's."""
    out = []
    for e in lex.get(word.lower(), []):
        m = POINTER.match(e["glosses"][0].lower()) if e["glosses"] else None
        target = m and (m.group(1) or m.group(2))
        if target and depth < 2:
            out += [{**t, "plural_only": bool(m.group(2))} for t in lookup(target, lex, depth + 1) if t["pos"] == e["pos"]] or [e]
        else:
            out.append(e)
    return out


def problems(w: dict, lex: dict[str, list[dict]], lang: L.Lang) -> list[str]:
    """What doesn't fit Wiktionary (empty: fine)."""
    article, base = split_article(w["it"], lang)
    if lang.code == "de" and base.startswith("sich "):
        base = base[5:]  # sich freuen: Wiktionary has freuen
    entries = lookup(base, lex)
    if not entries:
        return ["not in Wiktionary"]
    accepted = POS_ALIASES.get(w["pos"], {w["pos"]})
    same = [e for e in entries if e["pos"] in accepted]
    # Adjectives that are past participles (afeitado "shaved") are often only listed as such.
    if not same and w["pos"] == "adj":
        same = [e for e in entries if any("participle of" in g for g in e["glosses"])]
    if not same:
        return [f"Wiktionary has it as {'/'.join(sorted({e['pos'] for e in entries}))}, not {w['pos']}"]
    out = []
    if w["pos"] == "noun" and article in ARTICLES.get(lang.code, {}):
        gender = ARTICLES[lang.code][article]
        # "m,(e)s,e" -> "m"; "((<m,s,en>" -> "m"; "+" marks German adjectival nouns
        # (der/die Verwandte), which take any article.
        genders = {e["gender"].lstrip("(<") for e in same}
        if any(g.startswith("+") for g in genders):
            genders = set()
        fits = any(g[:1] in gender or g.startswith("mf") or "m" in g and "f" in g for g in genders)
        # A plural (die Haare, las gafas) takes the plural article whatever its gender.
        fits = fits or ("p" in gender and any(e.get("plural_only") for e in same))
        # Feminine nouns starting with a stressed a take "el": el agua, el alma.
        if not fits and lang.code == "es" and article in ("el", "un") and any(g.startswith("f") for g in genders):
            fits = plain(base)[:1] == "a" or plain(base)[:2] == "ha"
        if not fits and genders - {""}:
            out.append(f"article {article!r} but Wiktionary says {'/'.join(sorted(genders - {''}))}")
    want = gloss_stems(w["en"])
    have = " ".join(g.lower() for e in same for g in e["glosses"])
    squeezed = re.sub(r"[\s-]", "", have)  # "hairdryer" / "hair dryer"
    if want and not any(s in have or s in squeezed for s in want):
        first = next((g for e in same for g in e["glosses"]), "")
        out.append(f"meaning: Wiktionary says {first[:80]!r}")
    return out


def plural_of(word: str, lex: dict[str, list[dict]], lang: L.Lang) -> str | None:
    """The plural with its article, from Wiktionary ("la mano" -> "las manos")."""
    article, base = split_article(word, lang)
    nouns = [e for e in lex.get(base.lower(), []) if e["pos"] == "noun" and e["plurals"]]
    if not nouns or article not in PLURAL_ARTICLE.get(lang.code, {}):
        return None
    form = nouns[0]["plurals"][0]
    if base[:1].isupper():
        form = form[:1].upper() + form[1:]
    plural_article = PLURAL_ARTICLE[lang.code][article]
    # El ala, el hada: feminine words take "el" only in the singular (las alas).
    if lang.code == "es" and article in ("el", "un") and nouns[0]["gender"].startswith("f"):
        plural_article = "las" if article == "el" else "unas"
    return f"{plural_article} {form}"


def shares_root(word: str, italian: dict) -> bool:
    """Whether a translation clearly continues the Italian word's (curated) root:
    the two look alike and the root starts as they do (casa / casa < casa,
    la noche / la notte < nox). Then it inherits the Italian etymology and cousin;
    hijo / figlio or perro / cane don't."""
    root = italian.get("root")
    if not root or root == "-":
        return False
    a, b = plain(V.lemma(word)), plain(re.sub(r"^(il|lo|la|i|gli|le|l')\s*", "", italian["it"].lower()))
    r = plain(root).lstrip("*")
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.6 and a[:2] == r[:2]


def merge(src: Path, italian: Path, out: Path, lex: dict[str, list[dict]]) -> list[str]:
    """Write the translated category files; return problems that stop the merge."""
    lang = L.current
    errors: list[str] = []
    out.mkdir(parents=True, exist_ok=True)
    L.use("it")
    all_italian = V.load(italian)
    L.use(lang.code)
    merged: dict[str, list[dict]] = {}
    for cat in V.CATEGORIES:
        txt = src / f"{cat}.txt"
        if not txt.exists():
            continue
        originals = [w for w in all_italian if w["cat"] == cat]
        lines = [ln.strip() for ln in txt.read_text(encoding="utf-8").splitlines() if ln.strip()]
        main = [ln for ln in lines if not ln.startswith("+")]
        if len(main) != len(originals):
            errors.append(f"{cat}: {len(main)} lines for {len(originals)} Italian words")
            continue
        words: list[dict] = []
        k = 0
        for ln in lines:
            parts = [p.strip() for p in ln.lstrip("+").split("|")]
            if ln.startswith("+"):
                prev = originals[max(k - 1, 0)]
                if len(parts) < 3:
                    errors.append(f"{cat}: extra word needs 'word | English | pos': {ln!r}")
                    continue
                words.append({"it": parts[0], "en": parts[1], "pos": parts[2], "level": prev.get("level")})
                continue
            it = originals[k]
            k += 1
            if parts[0] == "-":
                continue
            w = {
                "it": parts[0],
                "en": parts[1] if len(parts) > 1 and parts[1] else it["en"],
                "pos": parts[2] if len(parts) > 2 and parts[2] else it["pos"],
                "level": it.get("level"),
                "concept": V.node_id(it),
            }
            if shares_root(w["it"], it):
                w.update({k: it[k] for k in ("root", "root_lang", "root_meaning", "cousin") if it.get(k)})
            if (it.get("pl") or lang.all_plurals) and w["pos"] == "noun":
                pl = plural_of(w["it"], lex, lang)
                if pl and pl.lower() != w["it"].lower():
                    w["pl"] = pl
            words.append(w)
        merged[cat] = words
    # Words whose ids would clash once accents are dropped (el papa / el papá,
    # si / sí) get the first meaning added to the later one's: el-papa-dad.
    taken: set[str] = set()
    for words in merged.values():
        for w in words:
            i = V.slug(w["it"])
            if i in taken:
                w["id"] = f"{i}-{V.slug(re.split(r'[/(]', w['en'])[0])}"
            taken.add(w.get("id") or i)
    for cat, words in merged.items():
        V.dump_category(out / f"{cat}.yaml", cat, words)
    return errors


def review(folder: Path, lex: dict[str, list[dict]]) -> str:
    lang = L.current
    words = V.load(folder)
    flagged = [(w, problems(w, lex, lang)) for w in words]
    flagged = [(w, p) for w, p in flagged if p]
    lines = [
        f"# {lang.name} vocabulary: words to review",
        "",
        f"{len(flagged)} of {len(words)} words don't fit Wiktionary exactly. Each is a question for "
        "someone fluent, not necessarily a mistake (Wiktionary misses phrases and some senses).",
        "",
    ]
    for cat in V.CATEGORIES:
        rows = [(w, p) for w, p in flagged if w["cat"] == cat]
        if rows:
            lines += [f"## {V.CATEGORIES[cat]}", ""]
            lines += [f"- **{w['it']}** ({w['en']}, {w['pos']}): {'; '.join(p)}" for w, p in rows]
            lines.append("")
    (folder / "REVIEW.md").write_text("\n".join(lines), encoding="utf-8")
    return f"{len(flagged)} of {len(words)} words flagged -> {folder / 'REVIEW.md'}"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lang", required=True, choices=sorted(set(L.LANGS) - {"it"}))
    p.add_argument("--check", action="store_true", help="only check an existing folder against Wiktionary")
    p.add_argument("paths", nargs="+", help="TRANSLATIONS ITALIAN OUT, or with --check: FOLDER")
    args = p.parse_args(argv)
    lang = L.use(args.lang)
    lex = lexicon(lang)
    if args.check:
        folder = Path(args.paths[0])
    else:
        src, italian, folder = (Path(x) for x in args.paths)
        errors = merge(src, italian, folder, lex)
        if errors:
            print("\n".join(errors), file=sys.stderr)
            return 1
    problems_ = V.validate(V.load(folder))
    if problems_:
        print("\n".join(problems_), file=sys.stderr)
    print(review(folder, lex), file=sys.stderr)
    return 1 if problems_ else 0


if __name__ == "__main__":
    sys.exit(main())
