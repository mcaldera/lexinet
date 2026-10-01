"""The language a vocabulary teaches, for the pipeline's language-specific steps.

One language per build (`build_vocab.py --lang es`), so it is a module-level
setting: articles, stems, gender endings, the Wiktionary extract, the frequency
list and the sentence pairs all follow `current`. Italian is the default, so
everything written before there were other languages keeps working.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Lang:
    code: str
    name: str  # as kaikki.org names its extract ("Italian")
    article_re: re.Pattern  # a word's article at its start
    ending_re: re.Pattern  # one inflectional ending, for stems (parlare / parlato)
    gender: list[tuple[str, str]]  # masculine -> feminine endings (figlio / figlia)
    pairs: str  # manythings.org file stem ("ita": ita-eng.zip, ita.txt)
    older: set[str] = field(default_factory=set)  # Wiktionary codes of older stages to look past
    compounds: bool = False  # a word inside another is family (Handschuh / Hand), meaning permitting
    all_plurals: bool = False  # every noun shows its plural, not only those the Italian list gave one

    @property
    def kaikki(self) -> str:
        return f"kaikki.org-dictionary-{self.name}.jsonl.gz"

    @property
    def frequency(self) -> str:
        return f"{self.code}_50k.txt"


LANGS = {
    "it": Lang(
        code="it",
        name="Italian",
        article_re=re.compile(r"^(il|lo|la|i|gli|le|un|uno|una)\s+|^(l'|un')", re.IGNORECASE),
        ending_re=re.compile(r"(are|ere|ire|at[oaie]|ut[oaie]|it[oaie]|[aeiou])$"),
        # figlio/figlia, signore/signora, attore/attrice, studente/studentessa
        gender=[("o", "a"), ("e", "a"), ("tore", "trice"), ("e", "essa")],
        pairs="ita",
        older={"roa-oit"},
    ),
    "es": Lang(
        code="es",
        name="Spanish",
        article_re=re.compile(r"^(el|la|los|las|un|una|unos|unas)\s+", re.IGNORECASE),
        ending_re=re.compile(r"(ar|er|ir|ad[oa]|id[oa]|[aeo])$"),
        # hijo/hija, profesor/profesora, actor/actriz, presidente/presidenta,
        # alcalde/alcaldesa, campeón/campeona (accents are stripped first)
        gender=[("o", "a"), ("or", "ora"), ("tor", "triz"), ("e", "a"), ("e", "esa"), ("on", "ona")],
        pairs="spa",
        older={"osp"},
    ),
    "de": Lang(
        code="de",
        name="German",
        article_re=re.compile(r"^(der|die|das|ein|eine)\s+", re.IGNORECASE),
        ending_re=re.compile(r"(ung|en|er|e|n)$"),
        # Lehrer/Lehrerin, Kollege/Kollegin, Student/Studentin
        gender=[("", "in"), ("e", "in")],
        pairs="deu",
        # Middle and Old High German, Proto-West Germanic: on to Proto-Germanic or Latin.
        older={"gmh", "goh", "gmw-pro"},
        compounds=True,
        all_plurals=True,
    ),
}

current: Lang = LANGS["it"]


def use(code: str) -> Lang:
    """Switch the pipeline to another language (for the rest of the run)."""
    global current
    current = LANGS[code]
    return current
