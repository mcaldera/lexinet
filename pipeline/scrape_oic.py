"""Build a word list from the vocabulary lessons on onlineitalianclub.com.

Usage:
    python pipeline/scrape_oic.py -o data/words_oic.csv

Pages are fetched politely (robots.txt allows it; 1 request/second) and cached
in ~/.cache/sprawl/oic/. The site's lessons become themes/regions. Levels
(A1..C1) come from the site's course pages; each word gets the easier of its
lesson's level and its frequency level, so common words come early, and
split_levels.py then splits them into ~10 even sub-levels. The output
is the site's content: keep it for personal study (it is git-ignored).
"""

from __future__ import annotations

import argparse
import csv
import html
import pickle
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

INDEX = "https://onlineitalianclub.com/italian-vocabulary-lists-and-exercises/"
CACHE = Path.home() / ".cache" / "sprawl"
LEVELS = ["A1", "A2", "B1", "B2", "C1"]
# Frequency rank thresholds per level (OpenSubtitles list): common words come first.
FREQ_LEVELS = [(1_000, "A1"), (3_000, "A2"), (8_000, "B1"), (20_000, "B2")]
# "contrari" lists opposites (dolce - amaro): Italian on both sides, not a gloss.
SKIP_TOPIC = re.compile(r"espressioni|modi di dire|^nomi comuni|^verbi:|parole difficili|sistema politico|^contrari", re.I)
# Lessons that are grammar lists, not themes: their words join the closest theme later.
GENERIC_TOPIC = re.compile(r"^(nomi|verbi|aggettivi|contrari|parole utili|quantit|frequenza|preposizion)", re.I)
# Near-duplicate lessons share one region; tiny lessons join a related one.
THEME_MERGE = {
    "Cooking and Baking": "Cooking",
    "Describing Food": "Food",
    "Tastes of Italy": "Food",
    "Health & illnesses": "Health",
    "Hands": "Body parts",
    "Festivals and Holidays": "Holidays",
    "Invitations": "Holidays",
    "Hotels": "Travelling",
    "Objects in the house": "Home",
    "Geographical terms": "Geography",
    "City vs. Countryside": "Geography",
    "Mafia": "Crime",
    "Bicycle": "Transport",
    "Means of transport": "Transport",
    "Workplaces": "Work",
    "Jobs and labour market": "Work",
    "Professions": "Work",
    "Literary Genres": "Books",
    "Types of people": "Character",
    "Days": "Time and calendar",
    "Months": "Time and calendar",
    "Seasons": "Time and calendar",
    "Time": "Time and calendar",
    "Natural disasters": "Weather",
    "Numbers": "",
    "Colors": "Appearance",
    "Directions": "Geography",
    "Expressing opinions": "",
    "Television": "Cinema",
    "Cinema": "Cinema and TV",
    "Games: Cards and Chess": "Games",
    "Environment and Recycling": "Environment",
    "School & studying": "School",
}
ARTICLE = re.compile(r"^(il|lo|la|i|gli|le|un|uno|una)\s+|^(l'|un')", re.I)
USER_AGENT = "Mozilla/5.0 (personal study app; polite single-threaded fetch)"


def fetch(url: str) -> str:
    name = re.sub(r"[^a-z0-9]+", "-", url.lower().split("//", 1)[-1]).strip("-")[:120]
    path = CACHE / "oic" / f"{name}.html"
    if path.exists():
        return path.read_text(encoding="utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    text = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
    path.write_text(text, encoding="utf-8")
    time.sleep(1.0)
    return text


def article_body(page: str) -> str:
    start, end = page.find("<article"), page.find("</article>")
    return page[start:end] if start >= 0 < end else page


def links(page: str) -> list[tuple[str, str]]:
    body = article_body(page)
    out = []
    for url, text in re.findall(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', body, re.S):
        out.append((html.unescape(re.sub(r"<[^>]+>", "", text)).strip(), url.rstrip("/")))
    return out


def text_lines(page: str) -> tuple[list[str], list[list[str]]]:
    """Plain lines of the lesson, plus table rows as lists of cells."""
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", article_body(page), flags=re.S)
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        cells = [clean(re.sub(r"<[^>]+>", " ", c)) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        rows.append([c for c in cells if c])
    body = re.sub(r"<table.*?</table>", "\n", body, flags=re.S)
    body = re.sub(r"<(br|/p|/li|/h\d|/div)[^>]*>", "\n", body)
    lines = [clean(re.sub(r"<[^>]+>", "", line)) for line in html.unescape(body).splitlines()]
    return [line for line in lines if line], rows


def clean(s: str) -> str:
    s = html.unescape(s).replace("’", "'").replace("‘", "'").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def clean_english(en: str) -> str:
    en = re.sub(r"\((s|es|ies|en)\)", "", en)  # "tomato(es)" -> "tomato"
    en = re.split(r"[‘']?FALSE FRIEND|\bNB\b|\s[-–]\s", en)[0]
    en = re.sub(r"\([^)]*\)", "", en).strip(" .;,[]")
    en = " / ".join(p.strip() for p in en.split("/") if p.strip())
    return re.sub(r"\s+", " ", en)


ARTICLES = r"(?:il|lo|la|i|gli|le|l'|un|uno|una|un')"


def clean_italian(it: str) -> str:
    # "il/la responsabile" -> "il responsabile": the slash is between articles only.
    it = re.sub(rf"^\s*({ARTICLES})\s*/\s*{ARTICLES}\s*", r"\1 ", it.strip(), flags=re.I)
    it = it.split("/")[0].split(",")[0]  # first alternative / singular form
    it = re.sub(r"\([^)]*\)", "", it)
    return re.sub(r"\s+", " ", it).strip(" .;:-–").lower()


ITALIAN_ONLY = {"il", "lo", "la", "gli", "le", "di", "del", "della", "dei", "delle", "che", "un", "una", "uno", "sono", "è"}


def looks_like_entry(it: str, en: str) -> bool:
    en_words = re.findall(r"[a-zà-ù']+", en.lower())
    return (
        0 < len(it.split()) <= 4
        and not re.fullmatch(ARTICLES, it)  # a bare article: the noun got lost
        and 0 < len(en.split()) <= 5
        and re.fullmatch(r"[a-zà-ùèéìòù' ]+", it) is not None
        and not re.search(r"\d|…|\.\.\.", en)
        # Reversed or Italian-on-both-sides rows ("aglio – tre spicchi d'aglio").
        and not ITALIAN_ONLY & set(en_words)
        and not re.search(r"\b[dl]'", en.lower())
    )


def parse_entries(page: str) -> list[tuple[str, str]]:
    lines, rows = text_lines(page)
    pairs: list[tuple[str, str]] = []
    for line in lines:
        m = re.match(r"^(.+?)\s*\[([^\]]+)\]?$", line)  # "il cane [dog]"
        if not m:
            m = re.match(r"^(.+?)\s+[–-]\s+(.+)$", line)  # "il pomodoro, i pomodori – tomato(es)"
        if m:
            pairs.append((clean_italian(m.group(1)), clean_english(m.group(2))))
    for cells in rows:
        english = [c for c in cells if c.startswith("[")]
        italian = [c for c in cells if not c.startswith("[")]
        if english and italian:  # "[homicide] | l'omicidio | l'omicida | uccidere"
            pairs.append((clean_italian(italian[0]), clean_english(english[0])))
        elif len(cells) == 2:
            pairs.append((clean_italian(cells[0]), clean_english(cells[1])))
    return [(it, en) for it, en in pairs if looks_like_entry(it, en)]


def topic_name(title: str) -> str:
    """"Animali 2 / Animals" -> "Animals"; "Crime" -> "Crime"."""
    name = title.split("/")[-1] if "/" in title else title
    name = re.sub(r"\s*\(?\d+\)?", "", name).strip()
    name = name[:1].upper() + name[1:]
    name = THEME_MERGE.get(name, name)
    return THEME_MERGE.get(name, name)  # two hops: "Television" -> "Cinema" -> "Cinema and TV"


def freq_level(word: str, ranks: dict[str, int]) -> str:
    rank = ranks.get(ARTICLE.sub("", word).split(" ")[0], 10**9)
    return next((lvl for limit, lvl in FREQ_LEVELS if rank <= limit), "C1")


def guess_pos(it: str, known: dict[str, str]) -> str:
    bare = ARTICLE.sub("", it)
    if bare != it:
        return "noun"
    head = bare.split(" ")[0]
    if " " in bare and (known.get(head) == "verb" or re.search(r"(are|ere|ire|arsi|ersi|irsi)$", head)):
        return "verb"  # verb phrase: "tornare a casa"
    if bare in known:
        return known[bare]
    if re.search(r"(are|ere|ire|arsi|ersi|irsi|urre|orre)$", bare):
        return "verb"
    if bare.endswith("mente"):
        return "adv"
    return "adj"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-o", "--out", default="data/words_oic.csv")
    args = p.parse_args(argv)

    index = links(fetch(INDEX))
    course = {t: u for t, u in index if t in ("A1", "A2", "B1", "B2", "C1", "C2")}
    lessons = [(t, u) for t, u in index if t not in course and "onlineitalianclub.com" in u]
    lesson_level: dict[str, str] = {}
    for lvl, url in course.items():
        for _, u in links(fetch(url)):
            lesson_level.setdefault(u, min(lvl, "C1"))

    ranks: dict[str, int] = {}
    with open(CACHE / "it_50k.txt", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            ranks.setdefault(line.split(" ", 1)[0], i)
    known_pos: dict[str, str] = {}
    idx_path = CACHE / "kaikki.org-dictionary-Italian.jsonl.index.pkl"
    if idx_path.exists():  # built by make_wordlist.py
        lemmas, _ = pickle.loads(idx_path.read_bytes())
        known_pos = {w: es[0]["pos"] for w, es in lemmas.items()}

    rows: dict[str, dict] = {}
    for title, url in lessons:
        if SKIP_TOPIC.search(title):
            continue
        try:
            entries = parse_entries(fetch(url + "/"))
        except Exception as e:  # one broken page shouldn't stop the list
            print(f"skip {title}: {e}", file=sys.stderr)
            continue
        topic = topic_name(title)
        generic = bool(GENERIC_TOPIC.search(title))
        lvl = lesson_level.get(url) or next((l.upper() for l in re.findall(r"-(a1|a2|b1|b2|c1)", url)), "B2")
        print(f"{len(entries):3d}  {lvl}  {title}", file=sys.stderr)
        for it, en in entries:
            key = unicodedata.normalize("NFC", it)
            level = min(lvl, freq_level(it, ranks))
            if key in rows:  # seen in another lesson: keep the easier level, prefer a real theme
                r = rows[key]
                r["level"] = min(r["level"], level)
                if r["generic"] and not generic:
                    r.update(theme=topic, generic=False)
                continue
            rows[key] = {"italian": it, "english": en, "pos": guess_pos(it, known_pos), "theme": "" if generic else topic, "generic": generic, "level": level}

    out = sorted(rows.values(), key=lambda r: (LEVELS.index(r["level"]), r["theme"] or "~", r["italian"]))
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["italian", "english", "pos", "theme", "tier", "level"], lineterminator="\n")
        w.writeheader()
        for r in out:
            w.writerow({**{k: r[k] for k in ("italian", "english", "pos", "theme", "level")}, "tier": LEVELS.index(r["level"]) + 1})
    by_level = {lvl: sum(r["level"] == lvl for r in out) for lvl in LEVELS}
    themes = len({r["theme"] for r in out if r["theme"]})
    print(f"{len(out)} words, {themes} themes, levels {by_level} -> {args.out}", file=sys.stderr)
    # Mostly A1: deal the levels out into ~10 evenly sized sub-levels (A1.1, A1.2, ...).
    import split_levels

    return split_levels.main([str(args.out)])


if __name__ == "__main__":
    sys.exit(main())
