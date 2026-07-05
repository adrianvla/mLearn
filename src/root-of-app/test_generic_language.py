import json
import inspect
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
import zlib
import builtins
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import generic_language
from generic_language import (
    GenericLanguageModule,
    dictionary_target_language_override,
    _matches_any_script,
    _normalize_script_codes,
    _normalize_token_reading,
)


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def _zjson(value) -> bytes:
    return zlib.compress(json.dumps(value).encode("utf-8"))


def _write_simple_dictionary_db(path: Path, entries: list[tuple[str, str, str, dict]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    for headword, headword_lower, pos, payload in entries:
        conn.execute(
            "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
            (headword, headword_lower, pos, _zjson(payload)),
        )
    conn.commit()
    conn.close()


def test_runtime_script_detection_ignores_legacy_top_level_script_metadata():
    legacy_key = "supported" + "Scripts"

    assert legacy_key not in inspect.getsource(generic_language._metadata_language_scripts)


def test_script_matching_does_not_fail_open_for_package_declared_scripts_outside_builtin_table():
    scripts = _normalize_script_codes(["Syrc"])

    assert _matches_any_script("ܫܠܡܐ", scripts) is True
    assert _matches_any_script("hello", scripts) is False


def test_unknown_script_tokenization_fails_closed_without_package_ranges(tmp_path):
    data_root = tmp_path / "language-data"
    osage_word = chr(0x104B0) + chr(0x104D8)
    _write_json(
        data_root / "languages" / "osg.json",
        {
            "name": "Osage without ranges",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Osge"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                },
            },
        },
    )

    module = GenericLanguageModule("osg")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE(osage_word) == []


def test_package_declared_script_ranges_enable_unknown_script_tokenization(tmp_path):
    data_root = tmp_path / "language-data"
    osage_word = chr(0x104B0) + chr(0x104D8)
    _write_json(
        data_root / "languages" / "osg.json",
        {
            "name": "Osage",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Osge"],
                    "scriptRanges": {
                        "Osge": [[0x104B0, 0x104FF]],
                    },
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                },
            },
        },
    )

    module = GenericLanguageModule("osg")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE(osage_word) == [
        {"word": osage_word, "actual_word": osage_word, "type": "WORD"}
    ]


def test_generic_unicode_word_tokenizer_and_simple_dictionary(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Test Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "lowercaseLemma": True,
                        "innerTokenCharacters": ["'"],
                    },
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/zz/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "zz" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("Haus", "haus", "NOUN", _zjson({"glosses": ["house"], "notes": ["building"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config()["type"] == "unicode-word"
    assert module.LANGUAGE_TOKENIZE("Haus!") == [
        {"word": "Haus", "actual_word": "haus", "type": "WORD"}
    ]
    assert module.LANGUAGE_TOKENIZE("don't") == [
        {"word": "don't", "actual_word": "don't", "type": "WORD"}
    ]
    translation = module.LANGUAGE_TRANSLATE("haus")
    assert translation["data"][0]["definitions"] == "house"
    assert "building" in translation["data"][1]["definitions"]


class _FakeSpacyToken:
    def __init__(self, text: str, lemma: str):
        self.text = text
        self.lemma_ = lemma
        self.pos_ = "VERB"
        self.is_space = False


class _FakeSpacyNlp:
    def __init__(self, lemmas: dict[str, str]):
        self.lemmas = lemmas

    def __call__(self, text: str):
        return [_FakeSpacyToken(text, self.lemmas.get(text, text))]


def test_generic_dictionary_lookup_uses_tokenizer_lemma_seeds_for_linguistic_tokenizers(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Lemma Lookup Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "fake_model",
                    },
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/zz/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                    },
                }
            },
        },
    )
    _write_simple_dictionary_db(
        data_root / "dictionaries" / "zz" / "dictionary.db",
        [("run", "run", "VERB", {"glosses": ["move quickly"]})],
    )

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    module._spacy_nlp = _FakeSpacyNlp({"running": "run"})

    translation = module.LANGUAGE_TRANSLATE("running")

    assert translation["data"][0]["definitions"] == "move quickly"


def test_generic_dictionary_lookup_can_disable_tokenizer_lemma_seeds(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Surface Only Lookup Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "fake_model",
                    },
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/zz/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "lookup": {
                            "seedForms": ["surface"],
                        },
                    },
                }
            },
        },
    )
    _write_simple_dictionary_db(
        data_root / "dictionaries" / "zz" / "dictionary.db",
        [("run", "run", "VERB", {"glosses": ["move quickly"]})],
    )

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    module._spacy_nlp = _FakeSpacyNlp({"running": "run"})

    assert module.LANGUAGE_TRANSLATE("running") == {"data": []}


def test_generic_dictionary_lookup_can_use_configured_rough_token_lemma_seeds(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Configured Rough Lookup Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "lemmaNormalizers": ["lowercase-strip-diacritics"],
                    },
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/zz/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "lookup": {
                            "seedForms": ["surface", "tokenizer-lemma"],
                        },
                    },
                }
            },
        },
    )
    _write_simple_dictionary_db(
        data_root / "dictionaries" / "zz" / "dictionary.db",
        [("cafe", "cafe", "NOUN", {"glosses": ["coffee shop"]})],
    )

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("Café")

    assert translation["data"][0]["definitions"] == "coffee shop"


def test_generic_unicode_word_tokenizer_does_not_assume_apostrophes(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Plain Rough Tokenizer Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word", "lowercaseLemma": True},
                }
            },
        },
    )

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("'don't'") == [
        {"word": "don", "actual_word": "don", "type": "WORD"},
        {"word": "t", "actual_word": "t", "type": "WORD"},
    ]


def test_generic_dictionary_metadata_cannot_escape_language_data_root(tmp_path):
    data_root = tmp_path / "language-data"
    outside_db = tmp_path / "outside.db"
    _write_json(
        data_root / "languages" / "xx.json",
        {
            "name": "Unsafe Dictionary Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "../outside.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                    },
                }
            },
        },
    )
    conn = sqlite3.connect(outside_db)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("secret", "secret", "NOUN", _zjson({"glosses": ["outside"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("xx")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("secret") == {"data": []}
    assert module._active_dictionary_path is None


def test_generic_unicode_word_tokenizer_supports_metadata_token_characters(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "fa.json",
        {
            "name": "Persian",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "tokenCharacterClasses": ["letter", "mark", "number"],
                        "extraTokenCharacters": ["\u200c"],
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("fa")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("كِتاب خانه\u200cها ۱۲۳") == [
        {"word": "كِتاب", "actual_word": "كِتاب", "type": "WORD"},
        {"word": "خانه\u200cها", "actual_word": "خانه\u200cها", "type": "WORD"},
        {"word": "۱۲۳", "actual_word": "۱۲۳", "type": "WORD"},
    ]


def test_generic_unicode_word_tokenizer_supports_inner_token_characters(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "fa.json",
        {
            "name": "Persian",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "innerTokenCharacters": ["\u200c", "'", "-"],
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("fa")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("'quoted' می\u200cروم state-of-the-art") == [
        {"word": "quoted", "actual_word": "quoted", "type": "WORD"},
        {"word": "می\u200cروم", "actual_word": "می\u200cروم", "type": "WORD"},
        {"word": "state-of-the-art", "actual_word": "state-of-the-art", "type": "WORD"},
    ]


def test_generic_unicode_word_tokenizer_supports_metadata_lemma_normalizers(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "de.json",
        {
            "name": "German",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "lemmaNormalizers": ["casefold", "strip-diacritics"],
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("de")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("Straße CAFÉ") == [
        {"word": "Straße", "actual_word": "strasse", "type": "WORD"},
        {"word": "CAFÉ", "actual_word": "cafe", "type": "WORD"},
    ]


def test_generic_unicode_word_tokenizer_uses_surface_normalizers_as_default_lemmas(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "fa.json",
        {
            "name": "Persian",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Arab"],
                },
                "lexemeNormalization": {
                    "type": "surface",
                    "surfaceScripts": ["Arab"],
                    "surfaceNormalizers": ["persian-arabic"],
                }
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "tokenCharacterClasses": ["letter", "mark"],
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("fa")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("كِتــاب يار") == [
        {"word": "كِتــاب", "actual_word": "کتاب", "type": "WORD"},
        {"word": "يار", "actual_word": "یار", "type": "WORD"},
    ]


def test_tokenizer_output_reading_normalizer_supports_non_japanese_readings():
    assert _normalize_token_reading("Nǐ Hǎo", "lowercase-strip-diacritics") == "ni hao"
    assert _normalize_token_reading("كِتَابـ", "remove-arabic-diacritics") == "كتابـ"
    assert _normalize_token_reading("كِتَابـ", "remove-tatweel") == "كِتَاب"
    assert _normalize_token_reading("كِتــابـ", ["remove-arabic-diacritics", "remove-tatweel", "persian-arabic"]) == "کتاب"


def test_unknown_tokenizer_type_does_not_fall_back_to_rough_segmenter(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Unsupported Tokenizer Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "wordmagic"},
                }
            },
        },
    )

    module = GenericLanguageModule("zz")

    with pytest.raises(RuntimeError, match="Unsupported tokenizer type"):
        module.LOAD_MODULE(str(tmp_path), str(data_root))


def test_generic_regex_tokenizer_alias_is_rejected(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Published Deprecated Alias Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "regex", "lowercaseLemma": True},
                }
            },
        },
    )

    module = GenericLanguageModule("zz")

    with pytest.raises(RuntimeError, match="Unsupported tokenizer type"):
        module.LOAD_MODULE(str(tmp_path), str(data_root))


def test_generic_basic_tokenizer_alias_is_rejected(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Published Deprecated Alias Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "basic", "lowercaseLemma": True},
                }
            },
        },
    )

    module = GenericLanguageModule("zz")

    with pytest.raises(RuntimeError, match="Unsupported tokenizer type"):
        module.LOAD_MODULE(str(tmp_path), str(data_root))


def test_rough_tokenizer_is_rejected_for_segmentless_scripts_without_explicit_opt_in(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Chinese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                }
            },
        },
    )

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config() == {
        "type": "none",
        "required": True,
        "fallback": "none",
    }
    with pytest.raises(RuntimeError, match="No tokenizer is configured"):
        module.LANGUAGE_TOKENIZE("中文学习")


def test_rough_tokenizer_safety_uses_script_profile_metadata(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Chinese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                }
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                }
            },
        },
    )
    _write_json(
        data_root / "languages" / "zhdegraded.json",
        {
            "name": "Chinese Degraded",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                }
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "allowRoughSegmentationForSegmentlessScripts": True,
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    degraded_module = GenericLanguageModule("zhdegraded")
    degraded_module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config() == {
        "type": "none",
        "required": True,
        "fallback": "none",
    }
    with pytest.raises(RuntimeError, match="No tokenizer is configured"):
        module.LANGUAGE_TOKENIZE("中文学习")
    assert degraded_module.LANGUAGE_TOKENIZE("中文学习") == [
        {"word": "中文学习", "actual_word": "中文学习", "type": "WORD"}
    ]


def test_rough_tokenizer_for_segmentless_scripts_requires_explicit_degradation_flag(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Chinese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "allowRoughSegmentationForSegmentlessScripts": True,
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("中文学习") == [
        {"word": "中文学习", "actual_word": "中文学习", "type": "WORD"}
    ]


def test_rough_tokenizer_restricts_letters_to_language_scripts_by_default(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "de.json",
        {
            "name": "German",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Latn"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word", "lowercaseLemma": True},
                }
            },
        },
    )

    module = GenericLanguageModule("de")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("Haus 中文 Привет") == [
        {"word": "Haus", "actual_word": "haus", "type": "WORD"}
    ]


def test_rough_tokenizer_does_not_treat_script_romanization_as_tokenizer_input(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Chinese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                    "allowsRomanization": True,
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "allowRoughSegmentationForSegmentlessScripts": True,
                    },
                },
            },
        },
    )

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("你好 ni-hao") == [
        {"word": "你好", "actual_word": "你好", "type": "WORD"},
    ]


def test_rough_tokenizer_accepts_romanized_or_explicit_token_scripts(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Chinese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                    "allowsRomanization": True,
                }
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "allowRoughSegmentationForSegmentlessScripts": True,
                        "acceptsRomanizedInput": True,
                        "extraTokenCharacters": [],
                        "innerTokenCharacters": ["-"],
                    },
                }
            },
        },
    )
    _write_json(
        data_root / "languages" / "xx.json",
        {
            "name": "Explicit Token Script Language",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Latn"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "tokenCharacterScripts": ["Cyrl"],
                    },
                }
            },
        },
    )

    zh_module = GenericLanguageModule("zh")
    zh_module.LOAD_MODULE(str(tmp_path), str(data_root))
    explicit_module = GenericLanguageModule("xx")
    explicit_module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert zh_module.LANGUAGE_TOKENIZE("你好 ni-hao سلام") == [
        {"word": "你好", "actual_word": "你好", "type": "WORD"},
        {"word": "ni-hao", "actual_word": "ni-hao", "type": "WORD"},
    ]
    assert explicit_module.LANGUAGE_TOKENIZE("слово word") == [
        {"word": "слово", "actual_word": "слово", "type": "WORD"}
    ]


def test_rough_tokenizer_is_allowed_for_hangul_text_with_word_spaces(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ko.json",
        {
            "name": "Korean",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Hang"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                }
            },
        },
    )

    module = GenericLanguageModule("ko")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config()["type"] == "unicode-word"
    assert module.LANGUAGE_TOKENIZE("한국어 공부") == [
        {"word": "한국어", "actual_word": "한국어", "type": "WORD"},
        {"word": "공부", "actual_word": "공부", "type": "WORD"},
    ]


def test_rough_tokenizer_is_allowed_for_composite_korean_script_metadata(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ko.json",
        {
            "name": "Korean",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Kore"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                }
            },
        },
    )

    module = GenericLanguageModule("ko")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config()["type"] == "unicode-word"
    assert module.LANGUAGE_TOKENIZE("韓國語 공부") == [
        {"word": "韓國語", "actual_word": "韓國語", "type": "WORD"},
        {"word": "공부", "actual_word": "공부", "type": "WORD"},
    ]


def test_script_profile_kana_kanji_metadata_does_not_infer_sudachi(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ja.json",
        {
            "name": "Japanese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Hira", "Kana", "Han"],
                },
            },
        },
    )

    module = GenericLanguageModule("ja")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config() == {
        "type": "none",
        "required": True,
        "fallback": "none",
    }
    with pytest.raises(RuntimeError, match="No tokenizer is configured"):
        module.LANGUAGE_TOKENIZE("日本語")


def test_composite_japanese_script_alias_does_not_infer_sudachi(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ja.json",
        {
            "name": "Japanese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Jpan"],
                },
            },
        },
    )

    module = GenericLanguageModule("ja")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config()["type"] == "none"
    with pytest.raises(RuntimeError, match="No tokenizer is configured"):
        module.LANGUAGE_TOKENIZE("日本語")


def test_unconfigured_segmentless_language_does_not_fall_back_to_rough_segmenter(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Chinese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                },
            },
        },
    )

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config() == {
        "type": "none",
        "required": True,
        "fallback": "none",
    }
    with pytest.raises(RuntimeError, match="No tokenizer is configured"):
        module.LANGUAGE_TOKENIZE("中文学习")


def test_generic_dictionary_lookup_normalizers_are_metadata_driven(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "yy.json",
        {
            "name": "Normalizer Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/yy/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "lookup": {
                            "normalizers": [
                                "unicode-nfkc",
                                "casefold",
                                "strip-diacritics",
                                "remove-tatweel",
                                "remove-arabic-diacritics",
                                {
                                    "type": "replace-characters",
                                    "map": {
                                        "ك": "ک",
                                        "ي": "ی",
                                    },
                                },
                            ]
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "yy" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    for headword, gloss in [
        ("cafe", "coffee shop"),
        ("کتاب", "book"),
        ("کمی", "a little"),
    ]:
        conn.execute(
            "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
            (headword, headword.casefold(), "NOUN", _zjson({"glosses": [gloss]})),
        )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("yy")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("CAFÉ")["data"][0]["definitions"] == "coffee shop"
    assert module.LANGUAGE_TRANSLATE("كِتــاب")["data"][0]["definitions"] == "book"
    assert module.LANGUAGE_TRANSLATE("كمي")["data"][0]["definitions"] == "a little"


def test_generic_simple_dictionary_uses_declared_definitions_path(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "frdict.json",
        {
            "name": "Localized Gloss Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/frdict/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "definitionsPath": ["glosses", "fr"],
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "frdict" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        (
            "maison",
            "maison",
            "NOUN",
            _zjson({"glosses": {"en": ["house"], "fr": ["habitation", "maison"]}}),
        ),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("frdict")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("maison")
    assert translation["data"][0]["definitions"] == "habitation"
    assert "habitation" in translation["data"][1]["definitions"]
    assert "maison" in translation["data"][1]["definitions"]
    assert "house" not in translation["data"][1]["definitions"]


def test_generic_simple_dictionary_uses_wildcard_definitions_path(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "sensedict.json",
        {
            "name": "Nested Sense Dictionary",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/sensedict/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "definitionsPath": ["senses", "*", "glosses"],
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "sensedict" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        (
            "дом",
            "дом",
            "NOUN",
            _zjson({"senses": [{"glosses": ["house", "home"]}, {"glosses": ["building"]}]}),
        ),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("sensedict")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("дом")
    assert translation["data"][0]["definitions"] == "house"
    assert "house" in translation["data"][1]["definitions"]
    assert "building" in translation["data"][1]["definitions"]


def test_generic_simple_dictionary_uses_declared_reading_path(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "pydict.json",
        {
            "name": "Simple Pinyin Dictionary",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/pydict/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "readingPath": ["pinyin", "value"],
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "pydict" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        (
            "你好",
            "你好",
            "INTJ",
            _zjson({"pinyin": {"value": "nǐ hǎo"}, "glosses": ["hello"]}),
        ),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("pydict")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("你好")
    assert translation["data"][0]["reading"] == "nǐ hǎo"
    assert translation["data"][1]["reading"] == "nǐ hǎo"


def test_generic_dictionary_lookup_normalizers_can_branch_across_orthographic_variants(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ar.json",
        {
            "name": "Arabic Variant Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/ar/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "lookup": {
                            "normalizerMode": "branching",
                            "normalizers": [
                                {
                                    "type": "replace-characters",
                                    "map": {
                                        "ك": "ک",
                                        "ي": "ی",
                                    },
                                },
                                "remove-arabic-diacritics",
                                "remove-tatweel",
                            ],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "ar" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("كمي", "كمي", "ADJ", _zjson({"glosses": ["quantitative"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("ar")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("كِمــي")["data"][0]["definitions"] == "quantitative"


def test_generic_dictionary_lookup_supports_metadata_affix_rewrites(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "affix.json",
        {
            "name": "Affix Lookup Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/affix/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "lookup": {
                            "normalizerMode": "branching",
                            "normalizers": [
                                {"type": "replace-prefix", "from": "ال"},
                                {"type": "replace-suffix", "from": "у", "to": "а"},
                            ],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "affix" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    for headword, gloss in [
        ("كتاب", "book"),
        ("книга", "book"),
    ]:
        conn.execute(
            "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
            (headword, headword.casefold(), "NOUN", _zjson({"glosses": [gloss]})),
        )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("affix")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("الكتاب")["data"][0]["definitions"] == "book"
    assert module.LANGUAGE_TRANSLATE("книгу")["data"][0]["definitions"] == "book"


def test_generic_dictionary_lookup_normalizer_presets_are_metadata_driven(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "fa.json",
        {
            "name": "Persian Preset Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/fa/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "lookup": {
                            "normalizers": ["persian-arabic"],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "fa" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("کتاب", "کتاب", "NOUN", _zjson({"glosses": ["book"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("fa")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("كِتــاب")["data"][0]["definitions"] == "book"


def test_generic_dictionary_lookup_uses_language_surface_normalizers_by_default(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "fa.json",
        {
            "name": "Persian Surface Language",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Arab"],
                },
                "lexemeNormalization": {
                    "type": "surface",
                    "surfaceScripts": ["Arab"],
                    "surfaceNormalizers": ["persian-arabic"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/fa-surface/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "fa-surface" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("کتاب", "کتاب", "NOUN", _zjson({"glosses": ["book"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("fa")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("كِتــاب")["data"][0]["definitions"] == "book"


def test_generic_dictionary_lookup_accepts_object_preset_normalizers(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ar.json",
        {
            "name": "Arabic Preset Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/ar/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "lookup": {
                            "normalizers": [{"type": "preset", "name": "arabic-script"}],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "ar" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("كتاب", "كتاب", "NOUN", _zjson({"glosses": ["book"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("ar")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("كِتــاب")["data"][0]["definitions"] == "book"


def test_generic_dictionary_lookup_expands_package_defined_normalizer_presets(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "xx.json",
        {
            "name": "Custom Preset Language",
            "textProcessing": {
                "normalizerPresets": {
                    "latin-display-fold": [
                        "casefold",
                        "strip-diacritics",
                        {"type": "replace-characters", "map": {"ø": "o"}},
                    ],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/xx/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                        "lookup": {
                            "normalizers": [{"type": "preset", "name": "latin-display-fold"}],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "xx" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("cafeo", "cafeo", "NOUN", _zjson({"glosses": ["coffee"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("xx")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("CAFÉØ")["data"][0]["definitions"] == "coffee"


def test_generic_unicode_word_tokenizer_expands_package_defined_normalizer_presets(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "xx.json",
        {
            "name": "Custom Lemma Preset Language",
            "textProcessing": {
                "normalizerPresets": {
                    "latin-display-fold": [
                        "casefold",
                        "strip-diacritics",
                        {"type": "replace-characters", "map": {"ø": "o"}},
                    ],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "lemmaNormalizers": [{"type": "preset", "name": "latin-display-fold"}],
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("xx")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("CAFÉØ") == [
        {"word": "CAFÉØ", "actual_word": "cafeo", "type": "WORD"}
    ]


def test_generic_simple_dictionary_uses_declared_spacy_lemma_before_tokenizer_is_warm(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ru.json",
        {
            "name": "Russian",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "ru_core_news_sm",
                    },
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/ru/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "ru" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("идти", "идти", "VERB", _zjson({"glosses": ["to go"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("ru")
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    module._lemma_spacy = lambda word: "идти" if word == "иду" else ""

    assert module._spacy_nlp is None
    assert module.LANGUAGE_TRANSLATE("иду")["data"][0]["definitions"] == "to go"


def test_generic_spacy_tokenizer_emits_clean_surfaces_without_layout_whitespace(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ru.json",
        {
            "name": "Russian",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "ru_core_news_sm",
                    },
                }
            },
        },
    )

    class FakeToken:
        def __init__(self, text, text_with_ws, pos, lemma, is_space=False):
            self.text = text
            self.text_with_ws = text_with_ws
            self.pos_ = pos
            self.lemma_ = lemma
            self.is_space = is_space

    module = GenericLanguageModule("ru")
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    fake_tokens = [
        FakeToken("иду", "иду ", "VERB", "идти"),
        FakeToken(" ", " ", "SPACE", " ", True),
        FakeToken("домой", "домой", "ADV", ""),
    ]
    module._ensure_spacy = lambda: (lambda _text: fake_tokens)

    assert module.LANGUAGE_TOKENIZE("иду домой") == [
        {"word": "иду", "type": "VERB", "actual_word": "идти"},
        {"word": "домой", "type": "ADV", "actual_word": "домой"},
    ]


def test_generic_spacy_tokenizer_emits_morphology_features(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ru.json",
        {
            "name": "Russian",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "ru_core_news_sm",
                    },
                }
            },
        },
    )

    class FakeMorph:
        def to_dict(self):
            return {"Case": "Acc", "Number": "Sing"}

    class FakeToken:
        text = "школу"
        pos_ = "NOUN"
        lemma_ = "школа"
        is_space = False
        morph = FakeMorph()

    module = GenericLanguageModule("ru")
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    module._ensure_spacy = lambda: (lambda _text: [FakeToken()])

    assert module.LANGUAGE_TOKENIZE("школу") == [
        {
            "word": "школу",
            "type": "NOUN",
            "actual_word": "школа",
            "features": {"Case": "Acc", "Number": "Sing"},
        },
    ]


def test_generic_spacy_tokenizer_honors_ignored_pos_metadata(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ru.json",
        {
            "name": "Russian",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "ru_core_news_sm",
                        "ignoredPos": ["PUNCT"],
                    },
                }
            },
        },
    )

    class FakeToken:
        def __init__(self, text, pos, lemma, is_space=False):
            self.text = text
            self.pos_ = pos
            self.lemma_ = lemma
            self.is_space = is_space

        @property
        def morph(self):
            class EmptyMorph:
                def to_dict(self):
                    return {}
            return EmptyMorph()

    module = GenericLanguageModule("ru")
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    module._ensure_spacy = lambda: (lambda _text: [
        FakeToken("иду", "VERB", "идти"),
        FakeToken(",", "PUNCT", ","),
        FakeToken("домой", "ADV", "домой"),
    ])

    assert module.LANGUAGE_TOKENIZE("иду, домой") == [
        {"word": "иду", "type": "VERB", "actual_word": "идти"},
        {"word": "домой", "type": "ADV", "actual_word": "домой"},
    ]


def test_generic_simple_dictionary_does_not_use_rough_tokenizer_lemma_normalizers_for_lookup(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "de2.json",
        {
            "name": "German Rough Lemma Lookup",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "unicode-word",
                        "lemmaNormalizers": ["casefold", "strip-diacritics"],
                    },
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "simple-headword-zlib-json",
                        "path": "dictionaries/de2/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "simple-glosses",
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "de2" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('schema_version', '1')")
    conn.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB)"
    )
    conn.execute(
        "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
        ("cafe", "cafe", "NOUN", _zjson({"glosses": ["coffee shop"]})),
    )
    conn.commit()
    conn.close()

    module = GenericLanguageModule("de2")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("CAFÉ") == [
        {"word": "CAFÉ", "actual_word": "cafe", "type": "WORD"}
    ]
    assert module.LANGUAGE_TRANSLATE("CAFÉ") == {"data": []}


def test_generic_headword_reading_dictionary_uses_target_template(tmp_path, monkeypatch):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "xx.json",
        {
            "name": "Reading Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "targetPathTemplate": "dictionaries/xx/{target}/dictionary.db",
                        "defaultTargetLanguage": "en",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "xx" / "fr" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["字", "じ", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "letter"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("字", "じ", _zjson(entry)))
    conn.execute("INSERT INTO pitch VALUES (?, ?)", ("字", _zjson({"position": 1})))
    conn.commit()
    conn.close()

    monkeypatch.setenv("MLEARN_DICTIONARY_TARGET_LANGUAGE", "fr")
    module = GenericLanguageModule("xx")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("字")
    assert translation["data"][0]["reading"] == "じ"
    assert translation["data"][0]["definitions"] == "letter"
    assert translation["data"][2] == {}


def test_generic_dictionary_target_map_is_language_scoped(tmp_path, monkeypatch):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "xx.json",
        {
            "name": "Scoped Target Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "targetPathTemplate": "dictionaries/xx/{target}/dictionary.db",
                        "defaultTargetLanguage": "en",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                    },
                }
            },
        },
    )

    for target, gloss in [("en", "english gloss"), ("fr", "french gloss")]:
        db_path = data_root / "dictionaries" / "xx" / target / "dictionary.db"
        db_path.parent.mkdir(parents=True)
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
        conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
        conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
        entry = ["字", "じ", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": gloss}]}], 1, []]
        conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("字", "じ", _zjson(entry)))
        conn.commit()
        conn.close()

    monkeypatch.setenv("MLEARN_DICTIONARY_TARGET_LANGUAGE", "fr")
    monkeypatch.setenv("MLEARN_DICTIONARY_TARGET_LANGUAGES_JSON", json.dumps({"xx": "en"}))
    module = GenericLanguageModule("xx")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("字")
    assert translation["data"][0]["definitions"] == "english gloss"


def test_generic_dictionary_can_switch_target_language_per_lookup(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "xx.json",
        {
            "name": "Per Request Target Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "targetPathTemplate": "dictionaries/xx/{target}/dictionary.db",
                        "defaultTargetLanguage": "en",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                    },
                }
            },
        },
    )

    for target, gloss in [("en", "english gloss"), ("fr", "french gloss")]:
        db_path = data_root / "dictionaries" / "xx" / target / "dictionary.db"
        db_path.parent.mkdir(parents=True)
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
        conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
        conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
        entry = ["字", "じ", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": gloss}]}], 1, []]
        conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("字", "じ", _zjson(entry)))
        conn.commit()
        conn.close()

    module = GenericLanguageModule("xx")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("字")["data"][0]["definitions"] == "english gloss"
    with dictionary_target_language_override("xx", "fr"):
        assert module.LANGUAGE_TRANSLATE("字")["data"][0]["definitions"] == "french gloss"
    assert module.LANGUAGE_TRANSLATE("字")["data"][0]["definitions"] == "english gloss"


def test_requested_dictionary_target_does_not_fall_back_to_default_language(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "xx.json",
        {
            "name": "Explicit Target Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "targetPathTemplate": "dictionaries/xx/{target}/dictionary.db",
                        "path": "dictionaries/xx/en/dictionary.db",
                        "fallbackPath": "dictionaries/xx/en/dictionary.db",
                        "defaultTargetLanguage": "en",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "xx" / "en" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["字", "じ", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "english gloss"}]}], 1, []]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("字", "じ", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("xx")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TRANSLATE("字")["data"][0]["definitions"] == "english gloss"
    with dictionary_target_language_override("xx", "fr"):
        assert module.LANGUAGE_TRANSLATE("字") == {"data": []}


def test_generic_headword_reading_dictionary_can_lookup_non_kana_readings(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "py.json",
        {
            "name": "Reading Index Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/py/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "readingLookup": "always",
                            "normalizers": ["casefold"],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "py" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["字", "zi4", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "character"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("字", "zi4", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("py")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("ZI4")
    assert translation["data"][0]["reading"] == "zi4"
    assert translation["data"][0]["definitions"] == "character"


def test_generic_headword_reading_dictionary_uses_declared_prosody_table(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "tone.json",
        {
            "name": "Tone Language",
            "prosody": {"type": "tone-contour"},
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/tone/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "prosody": {
                            "table": "tones",
                            "headwordColumn": "lexeme",
                            "dataColumn": "payload",
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "tone" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE tones (lexeme TEXT PRIMARY KEY, payload BLOB)")
    entry = ["你好", "ni hao", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "hello"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("你好", "ni hao", _zjson(entry)))
    conn.execute("INSERT INTO tones VALUES (?, ?)", ("你好", _zjson({"toneNumbers": [3, 3], "sandhi": [2, 3]})))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("tone")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("你好")
    assert translation["data"][0]["reading"] == "ni hao"
    assert translation["data"][0]["definitions"] == "hello"
    assert translation["data"][2] == {"toneNumbers": [3, 3], "sandhi": [2, 3]}


def test_generic_headword_reading_dictionary_does_not_attach_mismatched_headword_prosody(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "tone_headword.json",
        {
            "name": "Headword Tone Language",
            "prosody": {"type": "tone-contour"},
            "textProcessing": {
                "lexemeNormalization": {
                    "type": "reading",
                    "readingScripts": ["Latn"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/tone_headword/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "readingLookup": "always",
                            "readingRank": ["score-desc"],
                        },
                        "prosody": {
                            "table": "tones",
                            "headwordColumn": "lexeme",
                            "dataColumn": "payload",
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "tone_headword" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE tones (lexeme TEXT PRIMARY KEY, payload BLOB)")
    high_score_entry = ["開く", "aku", "", "", 20, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "open"}]}], 1, []]
    low_score_entry = ["開く", "hiraku", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "open"}]}], 1, []]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("開く", "aku", _zjson(high_score_entry)))
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("開く", "hiraku", _zjson(low_score_entry)))
    conn.execute("INSERT INTO tones VALUES (?, ?)", ("開く", _zjson(["開く", "tone", {"position": 2, "reading": "hiraku"}])))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("tone_headword")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    by_headword = module.LANGUAGE_TRANSLATE("開く")
    assert by_headword["data"][0]["reading"] == "aku"
    assert by_headword["data"][2] == {}

    by_reading = module.LANGUAGE_TRANSLATE("hiraku")
    assert by_reading["data"][0]["reading"] == "hiraku"
    assert by_reading["data"][2] == ["開く", "tone", {"position": 2, "reading": "hiraku"}]


def test_generic_headword_reading_dictionary_matches_headword_prosody_readings_after_normalization(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "fa_tone.json",
        {
            "name": "Persian Prosody Language",
            "prosody": {"type": "tone-contour"},
            "textProcessing": {
                "lexemeNormalization": {
                    "type": "reading",
                    "surfaceScripts": ["Arab"],
                    "readingScripts": ["Arab"],
                    "readingNormalizer": ["remove-arabic-diacritics", "remove-tatweel", "persian-arabic"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/fa_tone/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "readingLookup": "always",
                        },
                        "prosody": {
                            "table": "tones",
                            "headwordColumn": "lexeme",
                            "dataColumn": "payload",
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "fa_tone" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE tones (lexeme TEXT PRIMARY KEY, payload BLOB)")
    entry = ["کتاب", "کتاب", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "book"}]}], 1, []]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("کتاب", "کتاب", _zjson(entry)))
    conn.execute("INSERT INTO tones VALUES (?, ?)", ("کتاب", _zjson({"position": 1, "reading": "كِتــابـ"})))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("fa_tone")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("كِتــابـ")
    assert translation["data"][0]["reading"] == "کتاب"
    assert translation["data"][2] == {"position": 1, "reading": "كِتــابـ"}


def test_generic_headword_reading_dictionary_can_key_prosody_by_reading(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "tone_reading.json",
        {
            "name": "Reading-Specific Tone Language",
            "prosody": {"type": "tone-contour"},
            "textProcessing": {
                "lexemeNormalization": {
                    "readingScripts": ["Latn"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/tone_reading/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "readingLookup": "always",
                            "readingRank": ["score-desc"],
                        },
                        "prosody": {
                            "table": "tones",
                            "headwordColumn": "lexeme",
                            "readingColumn": "reading",
                            "dataColumn": "payload",
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "tone_reading" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE tones (lexeme TEXT, reading TEXT, payload BLOB, PRIMARY KEY (lexeme, reading))")
    high_score_entry = ["開く", "aku", "", "", 20, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "open"}]}], 1, []]
    low_score_entry = ["開く", "hiraku", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "open"}]}], 1, []]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("開く", "aku", _zjson(high_score_entry)))
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("開く", "hiraku", _zjson(low_score_entry)))
    conn.execute("INSERT INTO tones VALUES (?, ?, ?)", ("開く", "aku", _zjson({"position": 0, "reading": "aku"})))
    conn.execute("INSERT INTO tones VALUES (?, ?, ?)", ("開く", "hiraku", _zjson({"position": 2, "reading": "hiraku"})))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("tone_reading")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    by_headword = module.LANGUAGE_TRANSLATE("開く")
    assert by_headword["data"][0]["reading"] == "aku"
    assert by_headword["data"][2] == {"position": 0, "reading": "aku"}

    by_reading = module.LANGUAGE_TRANSLATE("hiraku")
    assert by_reading["data"][0]["reading"] == "hiraku"
    assert by_reading["data"][2] == {"position": 2, "reading": "hiraku"}


def test_generic_headword_reading_dictionary_requires_declared_prosody_table(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "tone2.json",
        {
            "name": "Broken Tone Language",
            "prosody": {"type": "tone-contour"},
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/tone2/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "prosody": {
                            "headwordColumn": "lexeme",
                            "dataColumn": "payload",
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "tone2" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    entry = ["你好", "ni hao", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "hello"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("你好", "ni hao", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("tone2")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    with pytest.raises(RuntimeError, match="prosody metadata must declare"):
        module.LANGUAGE_TRANSLATE("你好")


def test_generic_headword_reading_dictionary_uses_declared_spacy_lemma_before_tokenizer_is_warm(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "ruhr.json",
        {
            "name": "Russian Headword Reading",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "ru_core_news_sm",
                    },
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/ruhr/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "ruhr" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["идти", "идти", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "to go"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("идти", "идти", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("ruhr")
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    module._lemma_spacy = lambda word: "идти" if word == "иду" else ""

    assert module._spacy_nlp is None
    translation = module.LANGUAGE_TRANSLATE("иду")
    assert translation["data"][0]["reading"] == "идти"
    assert translation["data"][0]["definitions"] == "to go"


def test_generic_headword_reading_dictionary_can_lookup_configured_reading_scripts(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "pin.json",
        {
            "name": "Pinyin Lookup Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/pin/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "readingLookup": {"scripts": ["Latn"]},
                            "normalizers": ["casefold"],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "pin" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["你好", "ni hao", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "hello"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("你好", "ni hao", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("pin")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("NI HAO")
    assert translation["data"][0]["reading"] == "ni hao"
    assert translation["data"][0]["definitions"] == "hello"
    assert module._should_lookup_reading("你好") is False


def test_generic_headword_reading_dictionary_renders_structured_object_entries(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "obj.json",
        {
            "name": "Object Entry Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/obj/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "structured-glosses",
                        "lookup": {
                            "readingLookup": "always",
                            "normalizers": ["casefold"],
                            "readingRank": ["common", "score-desc"],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "obj" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    entry = {
        "word": "你好",
        "reading": "ni hao",
        "definitions": ["hello", "hi"],
        "partOfSpeech": ["greeting"],
        "tags": ["common"],
        "score": 50,
        "notes": ["informal greeting"],
    }
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("你好", "ni hao", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("obj")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("NI HAO")
    assert translation["data"][0] == {"reading": "ni hao", "definitions": "hello"}
    assert translation["data"][1]["reading"] == "ni hao"
    assert "hello" in translation["data"][1]["definitions"]
    assert "hi" in translation["data"][1]["definitions"]
    assert "greeting" in translation["data"][1]["definitions"]
    assert translation["data"][2] == {}


def test_generic_headword_reading_dictionary_uses_declared_reading_path_for_structured_entries(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Structured Pinyin Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/zh/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "structured-glosses",
                        "readingPath": ["pinyin", "value"],
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "zh" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    entry = {
        "word": "你好",
        "pinyin": {"value": "nǐ hǎo"},
        "definitions": ["hello"],
    }
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("你好", "ni hao", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("你好")
    assert translation["data"][0]["reading"] == "nǐ hǎo"
    assert translation["data"][0]["definitions"] == "hello"


def test_generic_headword_reading_dictionary_uses_declared_definitions_path_for_structured_entries(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zhgloss.json",
        {
            "name": "Structured Gloss Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/zhgloss/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "structured-glosses",
                        "readingPath": ["pinyin", "value"],
                        "definitionsPath": ["glosses", "en"],
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "zhgloss" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    entry = {
        "word": "你好",
        "pinyin": {"value": "nǐ hǎo"},
        "glosses": {"en": ["hello", "hi"]},
    }
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("你好", "ni hao", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("zhgloss")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("你好")
    assert translation["data"][0] == {"reading": "nǐ hǎo", "definitions": "hello"}
    assert "hello" in translation["data"][1]["definitions"]
    assert "hi" in translation["data"][1]["definitions"]


def test_generic_headword_reading_dictionary_defaults_to_language_reading_scripts(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "pin2.json",
        {
            "name": "Pinyin Default Lookup Language",
            "textProcessing": {
                "lexemeNormalization": {
                    "type": "reading",
                    "surfaceScripts": ["Han"],
                    "readingScripts": ["Latn"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/pin2/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "normalizers": ["casefold"],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "pin2" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["你好", "ni hao", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "hello"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("你好", "ni hao", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("pin2")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._should_lookup_reading("NI HAO") is True
    assert module._should_lookup_reading("你好") is False
    translation = module.LANGUAGE_TRANSLATE("NI HAO")
    assert translation["data"][0]["reading"] == "ni hao"
    assert translation["data"][0]["definitions"] == "hello"


def test_generic_headword_reading_dictionary_uses_language_reading_normalizer(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "fa2.json",
        {
            "name": "Persian Reading Lookup Language",
            "textProcessing": {
                "lexemeNormalization": {
                    "type": "reading",
                    "surfaceScripts": ["Arab"],
                    "readingScripts": ["Arab"],
                    "readingNormalizer": ["remove-arabic-diacritics", "remove-tatweel", "persian-arabic"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/fa2/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "fa2" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["کتاب", "کتاب", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "book"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("کتاب", "کتاب", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("fa2")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("كِتــاب")
    assert translation["data"][0]["reading"] == "کتاب"
    assert translation["data"][0]["definitions"] == "book"


def test_generic_headword_reading_dictionary_accepts_declared_reading_extra_characters(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "arx.json",
        {
            "name": "Arabic Romanization Lookup Language",
            "textProcessing": {
                "lexemeNormalization": {
                    "type": "reading",
                    "surfaceScripts": ["Arab"],
                    "readingScripts": ["Latn"],
                    "readingExtraCharacters": ["ʿ", "ʾ"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/arx/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "normalizers": ["casefold"],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "arx" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["العربية", "al-ʿarabiyya", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "Arabic"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("العربية", "al-ʿarabiyya", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("arx")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._should_lookup_reading("al-ʿarabiyya") is True
    assert module._should_lookup_reading("ʿʾ") is False
    translation = module.LANGUAGE_TRANSLATE("AL-ʿARABIYYA")
    assert translation["data"][0]["reading"] == "al-ʿarabiyya"
    assert translation["data"][0]["definitions"] == "Arabic"


def test_generic_headword_reading_dictionary_can_lookup_thai_reading_scripts(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "th.json",
        {
            "name": "Thai Reading Lookup Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/th/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "readingLookup": {"scripts": ["Thai"]},
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "th" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    entry = ["ก", "กา", "", "", 10, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "ka"}]}], 1, ["common"]]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("ก", "กา", _zjson(entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("th")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("กา")
    assert translation["data"][0]["reading"] == "กา"
    assert translation["data"][0]["definitions"] == "ka"


def test_generic_headword_reading_ranking_uses_metadata_scripts(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "pr.json",
        {
            "name": "Pronunciation Ranked Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"},
                    "dictionary": {
                        "type": "sqlite-zlib-json",
                        "schema": "headword-reading-zlib-json",
                        "path": "dictionaries/pr/dictionary.db",
                        "schemaVersion": "1",
                        "renderer": "raw-entry",
                        "lookup": {
                            "readingLookup": "always",
                            "normalizers": ["casefold"],
                            "readingRank": [
                                {"type": "script", "scripts": ["Latn"]},
                                "common",
                                "score-desc",
                                "short-reading",
                            ],
                        },
                    },
                }
            },
        },
    )

    db_path = data_root / "dictionaries" / "pr" / "dictionary.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
    conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
    conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
    han_reading_entry = ["字", "字", "", "", 999, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "wrong script"}]}], 1, ["common"]]
    latin_reading_entry = ["字", "zi4", "", "", 1, [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "latin reading"}]}], 1, []]
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("字", "zi4", _zjson(han_reading_entry)))
    conn.execute("INSERT INTO entries VALUES (?, ?, ?)", ("字", "zi4", _zjson(latin_reading_entry)))
    conn.commit()
    conn.close()

    module = GenericLanguageModule("pr")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    translation = module.LANGUAGE_TRANSLATE("ZI4")
    assert translation["data"][0]["reading"] == "zi4"
    assert translation["data"][0]["definitions"] == "latin reading"


def test_generic_headword_reading_ranking_accepts_declared_reading_extra_characters(tmp_path):
    data_root = tmp_path / "language-data"

    for language, reading_extra_characters in (
        ("arxrank", ["ʿ"]),
        ("arxplain", []),
    ):
        _write_json(
            data_root / "languages" / f"{language}.json",
            {
                "name": "Reading Rank Extra Character Language",
                "textProcessing": {
                    "lexemeNormalization": {
                        "type": "reading",
                        "surfaceScripts": ["Arab"],
                        "readingScripts": ["Latn"],
                        "readingExtraCharacters": reading_extra_characters,
                    },
                },
                "runtime": {
                    "nlp": {
                        "tokenizer": {"type": "unicode-word"},
                        "dictionary": {
                            "type": "sqlite-zlib-json",
                            "schema": "headword-reading-zlib-json",
                            "path": f"dictionaries/{language}/dictionary.db",
                            "schemaVersion": "1",
                            "renderer": "raw-entry",
                            "lookup": {
                                "readingRank": [
                                    {"type": "script", "scripts": ["Latn"]},
                                ],
                            },
                        },
                    }
                },
            },
        )

        db_path = data_root / "dictionaries" / language / "dictionary.db"
        db_path.parent.mkdir(parents=True)
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO meta VALUES ('version', '1:test')")
        conn.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
        conn.execute("CREATE TABLE pitch (headword TEXT PRIMARY KEY, data BLOB)")
        conn.commit()
        conn.close()

    ranked_module = GenericLanguageModule("arxrank")
    ranked_module.LOAD_MODULE(str(tmp_path), str(data_root))
    plain_module = GenericLanguageModule("arxplain")
    plain_module.LOAD_MODULE(str(tmp_path), str(data_root))

    entry = ["العربية", "al-ʿarabiyya", "", "", 10, [], 1, []]

    assert ranked_module._rank_headword_reading_entry(entry)[0] == 0
    assert plain_module._rank_headword_reading_entry(entry)[0] == 1


def test_generic_lemma_fallback_rules_are_metadata_driven():
    module = GenericLanguageModule("xx")

    def lookup(word):
        return [word] if word == "治す" else []

    module._entries_by_headword_cached = lookup  # type: ignore[method-assign]
    tokenizer_config = {
        "lemmaFallbackRules": [
            {
                "pos": "VERB",
                "suffix": "せる",
                "replacement": "す",
                "requireDictionaryMatch": True,
            }
        ]
    }

    assert module._apply_lemma_fallback_rules("治せる", "VERB", tokenizer_config) == "治す"
    assert module._apply_lemma_fallback_rules("見せる", "VERB", tokenizer_config) == "見せる"
    assert module._apply_lemma_fallback_rules("治せる", "NOUN", tokenizer_config) == "治せる"


def test_optional_missing_spacy_tokenizer_falls_back_to_rough_when_explicit(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Optional Tokenizer Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "mlearn_missing_model_zz",
                        "lowercaseLemma": True,
                        "fallback": "unicode-word",
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("Haus!") == [
        {"word": "Haus", "actual_word": "haus", "type": "WORD"}
    ]


def test_rough_missing_tokenizer_fallback_is_rejected_for_segmentless_scripts_without_opt_in(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Chinese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "mlearn_missing_model_zh",
                        "fallback": "unicode-word",
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config()["fallback"] == "none"
    with pytest.raises(RuntimeError, match="Required spacy tokenizer"):
        module.LANGUAGE_TOKENIZE("中文学习")


def test_rough_missing_tokenizer_fallback_for_segmentless_scripts_requires_explicit_degradation_flag(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zh.json",
        {
            "name": "Chinese",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Han"],
                },
            },
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "mlearn_missing_model_zh",
                        "fallback": "unicode-word",
                        "allowRoughSegmentationForSegmentlessScripts": True,
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config()["fallback"] == "unicode-word"
    assert module.LANGUAGE_TOKENIZE("中文学习") == [
        {"word": "中文学习", "actual_word": "中文学习", "type": "WORD"}
    ]


def test_optional_missing_spacy_tokenizer_without_explicit_fallback_raises(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Optional Tokenizer Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "mlearn_missing_model_zz",
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    with pytest.raises(RuntimeError, match="spacy tokenizer is not available"):
        module.LANGUAGE_TOKENIZE("Haus!")


def test_unconfigured_latin_language_requires_tokenizer_metadata(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "de.json",
        {
            "name": "German",
            "textProcessing": {
                "scriptProfile": {
                    "acceptedScripts": ["Latn"],
                },
            },
        },
    )

    module = GenericLanguageModule("de")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module._tokenizer_config() == {
        "type": "none",
        "required": True,
        "fallback": "none",
    }
    with pytest.raises(RuntimeError, match="No tokenizer is configured"):
        module.LANGUAGE_TOKENIZE("Haus!")


def test_required_missing_spacy_tokenizer_raises_instead_of_rough_fallback(tmp_path):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Required Tokenizer Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "spacy",
                        "model": "mlearn_missing_model_zz",
                        "required": True,
                    },
                }
            },
        },
    )

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    with pytest.raises(RuntimeError, match="Required spacy tokenizer"):
        module.LANGUAGE_TOKENIZE("Haus!")


def test_optional_missing_sudachi_tokenizer_falls_back_only_when_explicit(tmp_path, monkeypatch):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Optional Sudachi Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "sudachi",
                        "fallback": "unicode-word",
                        "allowRoughSegmentationForSegmentlessScripts": True,
                    },
                }
            },
        },
    )

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name.startswith("sudachipy"):
            raise ImportError("sudachi unavailable")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.LANGUAGE_TOKENIZE("日本語") == [
        {"word": "日本語", "actual_word": "日本語", "type": "WORD"}
    ]


def test_missing_sudachi_tokenizer_without_explicit_fallback_raises(tmp_path, monkeypatch):
    data_root = tmp_path / "language-data"
    _write_json(
        data_root / "languages" / "zz.json",
        {
            "name": "Required Sudachi Language",
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "sudachi",
                    },
                }
            },
        },
    )

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name.startswith("sudachipy"):
            raise ImportError("sudachi unavailable")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    module = GenericLanguageModule("zz")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    with pytest.raises(RuntimeError, match="sudachi tokenizer is not available"):
        module.LANGUAGE_TOKENIZE("日本語")


def test_sudachi_tokenization_is_serialized_for_thread_unsafe_tokenizer():
    class FakeSudachiToken:
        def __init__(self, surface):
            self._surface = surface

        def surface(self):
            return self._surface

        def part_of_speech(self):
            return ["名詞"]

        def dictionary_form(self):
            return self._surface

        def reading_form(self):
            return self._surface

    class ThreadUnsafeSudachiTokenizer:
        def __init__(self):
            self._active = False
            self._entered = threading.Event()
            self._release = threading.Event()

        def tokenize(self, text, _mode):
            if self._active:
                raise RuntimeError("Already borrowed")
            self._active = True
            self._entered.set()
            self._release.wait(timeout=1)
            self._active = False
            return [FakeSudachiToken(text)]

    module = GenericLanguageModule("ja")
    module.metadata = {
        "runtime": {
            "nlp": {
                "tokenizer": {
                    "type": "sudachi",
                },
            },
        },
    }
    tokenizer = ThreadUnsafeSudachiTokenizer()
    module._sudachi_tokenizer = tokenizer
    module._sudachi_mode = object()
    module._entries_by_headword_cached = lambda _word: True

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(module.LANGUAGE_TOKENIZE, "赤い")
        tokenizer._entered.wait(timeout=1)
        second = executor.submit(module.LANGUAGE_TOKENIZE, "青い")
        tokenizer._release.set()

        assert first.result(timeout=1)[0]["word"] == "赤い"
        assert second.result(timeout=1)[0]["word"] == "青い"


def test_sudachi_tokenization_is_serialized_across_language_module_instances():
    class FakeSudachiToken:
        def __init__(self, surface):
            self._surface = surface

        def surface(self):
            return self._surface

        def part_of_speech(self):
            return ["名詞"]

        def dictionary_form(self):
            return self._surface

        def reading_form(self):
            return self._surface

    class ProcessBorrowedSudachiTokenizer:
        _active = False
        _entered = threading.Event()
        _release = threading.Event()

        def tokenize(self, text, _mode):
            if ProcessBorrowedSudachiTokenizer._active:
                raise RuntimeError("Already borrowed")
            ProcessBorrowedSudachiTokenizer._active = True
            ProcessBorrowedSudachiTokenizer._entered.set()
            ProcessBorrowedSudachiTokenizer._release.wait(timeout=1)
            ProcessBorrowedSudachiTokenizer._active = False
            return [FakeSudachiToken(text)]

    def make_module():
        module = GenericLanguageModule("ja")
        module.metadata = {
            "runtime": {
                "nlp": {
                    "tokenizer": {
                        "type": "sudachi",
                    },
                },
            },
        }
        module._sudachi_tokenizer = ProcessBorrowedSudachiTokenizer()
        module._sudachi_mode = object()
        module._entries_by_headword_cached = lambda _word: True
        return module

    first_module = make_module()
    second_module = make_module()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(first_module.LANGUAGE_TOKENIZE, "赤い")
        ProcessBorrowedSudachiTokenizer._entered.wait(timeout=1)
        second = executor.submit(second_module.LANGUAGE_TOKENIZE, "青い")
        ProcessBorrowedSudachiTokenizer._release.set()

        assert first.result(timeout=1)[0]["word"] == "赤い"
        assert second.result(timeout=1)[0]["word"] == "青い"
