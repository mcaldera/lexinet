import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scrape_oic as so  # noqa: E402


def test_article_alternatives_keep_the_noun():
    assert so.clean_italian("il/la responsabile") == "il responsabile"
    assert so.clean_italian("la / il disfattista") == "la disfattista"
    assert so.clean_italian("il pomodoro, i pomodori") == "il pomodoro"
    assert so.clean_italian("felice/infelice") == "felice"


def test_a_bare_article_is_not_an_entry():
    assert not so.looks_like_entry("il", "person in charge")
    assert so.looks_like_entry("il responsabile", "person in charge")
