import os
import sys
import tempfile
import types
from pathlib import Path


ROOT_OF_APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_OF_APP))

_fake_sudachipy = types.ModuleType("sudachipy")
_fake_tokenizer = types.ModuleType("sudachipy.tokenizer")
_fake_dictionary = types.ModuleType("sudachipy.dictionary")
_fake_tokenizer.Tokenizer = types.SimpleNamespace(
    SplitMode=types.SimpleNamespace(C="C"),
)
_fake_sudachipy.tokenizer = _fake_tokenizer
_fake_sudachipy.dictionary = _fake_dictionary
sys.modules.setdefault("sudachipy", _fake_sudachipy)
sys.modules.setdefault("sudachipy.tokenizer", _fake_tokenizer)
sys.modules.setdefault("sudachipy.dictionary", _fake_dictionary)

from languages import ja  # noqa: E402


def _with_env(value):
    old = os.environ.get(ja.DICTIONARY_TARGET_ENV)
    if value is None:
        os.environ.pop(ja.DICTIONARY_TARGET_ENV, None)
    else:
        os.environ[ja.DICTIONARY_TARGET_ENV] = value
    return old


def _restore_env(value):
    if value is None:
        os.environ.pop(ja.DICTIONARY_TARGET_ENV, None)
    else:
        os.environ[ja.DICTIONARY_TARGET_ENV] = value


def test_japanese_dictionary_path_uses_selected_target_language():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        target_db = root / "dictionaries" / "ja" / "fr" / "dictionary.db"
        target_db.parent.mkdir(parents=True)
        target_db.write_text("", encoding="utf-8")

        old = _with_env("fr")
        try:
            assert ja._db_path(root) == target_db
        finally:
            _restore_env(old)


def test_japanese_dictionary_path_keeps_legacy_english_fallback():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        legacy_db = root / "dictionaries" / "ja" / "dictionary.db"
        legacy_db.parent.mkdir(parents=True)
        legacy_db.write_text("", encoding="utf-8")

        old = _with_env(None)
        try:
            assert ja._db_path(root) == legacy_db
        finally:
            _restore_env(old)


def test_japanese_dictionary_target_is_sanitized():
    old = _with_env("../FR!!")
    try:
        assert ja._dictionary_target_language() == "fr"
    finally:
        _restore_env(old)


if __name__ == "__main__":
    test_japanese_dictionary_path_uses_selected_target_language()
    test_japanese_dictionary_path_keeps_legacy_english_fallback()
    test_japanese_dictionary_target_is_sanitized()
    print("Japanese dictionary target tests passed.")
