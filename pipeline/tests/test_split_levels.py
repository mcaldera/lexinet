import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import split_levels as sl  # noqa: E402


def test_shares_are_proportional_with_one_per_level():
    assert sl.shares([668, 276, 368, 239], 10) == [4, 2, 2, 2]
    assert sum(sl.shares([1000, 5, 5], 10)) == 10
    assert min(sl.shares([1000, 5, 5], 10)) == 1
    assert sl.shares([3, 3], 1) == [1, 1]  # never fewer tiers than levels


def test_split_deals_common_words_first_and_is_idempotent():
    rows = [{"italian": w, "level": "A1"} for w in ["il raro", "la casa", "il cane", "strano"]]
    rows.append({"italian": "difficile", "level": "B2"})
    ranks = {"casa": 1, "cane": 2, "strano": 3, "raro": 4}
    out = sl.split_rows(rows, 3, ranks)
    assert [(r["italian"], r["tier"], r["level"]) for r in out] == [
        ("la casa", "1", "A1.1"),
        ("il cane", "1", "A1.1"),
        ("strano", "2", "A1.2"),
        ("il raro", "2", "A1.2"),
        ("difficile", "3", "B2"),
    ]
    assert sl.split_rows(out, 3, ranks) == out
