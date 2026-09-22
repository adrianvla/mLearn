"""Offline regression tests for the generalized FreeDict pack builder.

Covers: direct target-gloss extraction, gloss-language filtering, inversion,
simple vs headword-reading output schemas, and per-target output paths — all
against a minimal TEI fixture without network access.
"""

import importlib.util
import json
import sqlite3
import zlib
from pathlib import Path

import pytest

_MODULE_PATH = Path(__file__).parent / "build-freedict-deu-eng.py"
_spec = importlib.util.spec_from_file_location("build_freedict", _MODULE_PATH)
build_freedict = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_freedict)


@pytest.fixture(autouse=True)
def isolate_builder_outputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # FreeDictPack resolves outputs through this module-owned root. Tests must
    # never replace the real package dictionaries with their tiny TEI fixtures.
    monkeypatch.setattr(build_freedict, "ROOT_OF_APP_DIR", tmp_path / "root-of-app")


def _tei(entries: str) -> str:
    return (
        '<TEI xmlns="http://www.tei-c.org/ns/1.0">'
        "<teiHeader><fileDesc><editionStmt><edition>test-1.0</edition></editionStmt>"
        '<publicationStmt><availability><p>Distributed under the Creative Commons Attribution-ShareAlike 4.0 International Licence</p>'
        "</availability></publicationStmt></fileDesc></teiHeader>"
        f"<text><body>{entries}</body></text>"
        "</TEI>"
    )


def _entry(orth: str, quotes: list[tuple[str, str]], pos: str = "noun") -> str:
    cit = "".join(f'<cit type="trans"><quote xml:lang="{lang}">{gloss}</quote></cit>' for lang, gloss in quotes)
    return (
        "<entry>"
        f"<form><orth>{orth}</orth></form>"
        f'<gramGrp><pos>{pos}</pos></gramGrp>'
        f"<sense>{cit}</sense>"
        "</entry>"
    )


def _write_tei(path: Path, body: str) -> None:
    path.write_text(_tei(body), encoding="utf-8")


def _rows(db_path: Path) -> list[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM entries ORDER BY headword").fetchall()
    conn.close()
    return rows


def test_direct_headword_reading_pack_targets_requested_gloss_language(tmp_path: Path) -> None:
    pack = build_freedict.FreeDictPack("de", "German", "deu-rus", "de", "ru", output_schema=build_freedict.HEADWORD_READING_SCHEMA)
    tei = tmp_path / "tei.xml"
    _write_tei(tei, _entry("Haus", [("ru", "дом"), ("fr", "maison")]))

    build_freedict._write_database(tei, "test-1.0", "https://example.com", "CC-BY-SA-4.0", "2026-09-06T00:00:00+00:00", pack)

    rows = _rows(pack.database_path)
    assert [(r["headword"], r["reading"]) for r in rows] == [("Haus", "")]
    payload = json.loads(zlib.decompress(rows[0]["data"]))
    assert payload["definitions"] == ["дом"]
    assert payload["partOfSpeech"] == ["noun"]


def test_simple_pack_and_inversion_use_target_paths_and_glosses(tmp_path: Path) -> None:
    de_ru = build_freedict.FreeDictPack("de", "German", "deu-rus", "de", "ru")
    de_fr = build_freedict.FreeDictPack("de", "German", "deu-fra", "de", "fr")
    es_en = build_freedict.FreeDictPack("es", "Spanish", "eng-spa", "es", "en", "es", True)

    assert de_ru.output_dir != de_fr.output_dir

    tei = tmp_path / "tei.xml"
    _write_tei(tei, _entry("Haus", [("ru", "дом")]))
    build_freedict._write_database(tei, "test-1.0", "url", "GPL-2.0-or-later", "date", de_ru)
    # Simple schema: id/headword_lower columns, glosses payload, gender kept for German nouns.
    rows = _rows(de_ru.database_path)
    assert rows[0]["headword"] == "Haus"
    assert json.loads(zlib.decompress(rows[0]["data"]))["glosses"] == ["дом"]

    # Same learning language, different target directory and gloss language.
    tei_fr = tmp_path / "tei-fr.xml"
    _write_tei(tei_fr, _entry("Haus", [("fr", "maison")]))
    build_freedict._write_database(tei_fr, "test-1.0", "url", "GPL-2.0-or-later", "date", de_fr)
    fr_rows = _rows(de_fr.database_path)
    assert json.loads(zlib.decompress(fr_rows[0]["data"]))["glosses"] == ["maison"]

    # Inversion: English headword entries become Spanish lookup rows.
    tei_inv = tmp_path / "tei-inv.xml"
    _write_tei(tei_inv, _entry("house", [("es", "casa")]))
    build_freedict._write_database(tei_inv, "test-1.0", "url", "CC-BY-SA-4.0", "date", es_en)
    inv_rows = _rows(es_en.database_path)
    assert [r["headword"] for r in inv_rows] == ["casa"]
    assert json.loads(zlib.decompress(inv_rows[0]["data"]))["glosses"] == ["house"]


def test_metadata_and_readme_record_direction_schema_and_license(tmp_path: Path) -> None:
    pack = build_freedict.FreeDictPack("zh", "Chinese", "zho-rus", "zh", "ru", output_schema=build_freedict.HEADWORD_READING_SCHEMA)
    tei = tmp_path / "tei.xml"
    _write_tei(tei, _entry("图书馆", [("ru", "библиотека")]))
    build_freedict._write_database(tei, "test-1.0", "url", "CC-BY-SA-4.0", "2026-09-06T00:00:00+00:00", pack)
    build_freedict._write_metadata("test-1.0", "url", "CC-BY-SA-4.0", "date", pack)
    build_freedict._write_readme("test-1.0", "url", "CC-BY-SA-4.0", "date", pack)

    metadata = json.loads(pack.metadata_path.read_text(encoding="utf-8"))
    assert metadata["source_direction"] == "zho-rus"
    assert metadata["target_language"] == "ru"
    assert metadata["output_schema"] == build_freedict.HEADWORD_READING_SCHEMA
    assert "zho-rus" in pack.readme_path.read_text(encoding="utf-8")
