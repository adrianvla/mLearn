import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

if "sudachipy" not in sys.modules:
    sudachipy = types.ModuleType("sudachipy")
    tokenizer = types.ModuleType("sudachipy.tokenizer")

    class Tokenizer:
        class SplitMode:
            C = object()

    tokenizer.Tokenizer = Tokenizer
    sudachi_dictionary = types.ModuleType("sudachipy.dictionary")
    sudachipy.tokenizer = tokenizer
    sudachipy.dictionary = sudachi_dictionary
    sys.modules["sudachipy"] = sudachipy
    sys.modules["sudachipy.tokenizer"] = tokenizer
    sys.modules["sudachipy.dictionary"] = sudachi_dictionary

from languages import ja


# Minimal mock dictionary: True = headword exists, False = absent
_MOCK_ENTRIES = {
    "見せる": True,
    "読める": True,
    "治す": True,
    "書く": True,
    "泳ぐ": True,
    "待つ": True,
    "死ぬ": True,
    "飛ぶ": True,
    "帰る": True,
    "食べる": True,
    "増える": True,
}


def _mock_lookup(word: str):
    return [object()] if _MOCK_ENTRIES.get(word) else []


# Replace the LRU-cached lookup with the mock
ja._entries_by_headword_cached = _mock_lookup


def test_resolve_potential_form():
    # Godan forms that Sudachi fails to lemmatize → must resolve to base
    assert ja._resolve_potential_form("治せる", "なおせる") == "治す"
    assert ja._resolve_potential_form("書ける", "かける") == "書く"
    assert ja._resolve_potential_form("泳げる", "およげる") == "泳ぐ"
    assert ja._resolve_potential_form("待てる", "まてる") == "待つ"
    assert ja._resolve_potential_form("死ねる", "しねる") == "死ぬ"
    assert ja._resolve_potential_form("飛べる", "とべる") == "飛ぶ"
    assert ja._resolve_potential_form("帰れる", "かえれる") == "帰る"

    # Potential forms that ARE legitimate dictionary entries → must NOT be modified
    assert ja._resolve_potential_form("見せる", "みせる") == "見せる"
    assert ja._resolve_potential_form("読める", "よめる") == "読める"
    assert ja._resolve_potential_form("増える", "ふえる") == "増える"

    # Already-correct dictionary forms → must stay unchanged
    assert ja._resolve_potential_form("治す", "なおす") == "治す"
    assert ja._resolve_potential_form("書く", "かく") == "書く"

    # Unknown potential form with no candidate in dictionary → fallback to surface
    assert ja._resolve_potential_form("unknownせる", "unknownせる") == "unknownせる"

    print("All _resolve_potential_form tests passed.")


def test_language_tokenize_wiring():
    import inspect

    src = inspect.getsource(ja.LANGUAGE_TOKENIZE)
    assert "_resolve_potential_form" in src
    assert 'actual_word == surface' in src
    assert 'pos == "動詞"' in src
    assert "_entries_by_headword_cached" in src
    print("LANGUAGE_TOKENIZE wiring check passed.")


if __name__ == "__main__":
    test_resolve_potential_form()
    test_language_tokenize_wiring()
    print("All tests passed.")
