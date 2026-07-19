#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import re
import sqlite3
import ssl
import tempfile
import unicodedata
import urllib.request
import zlib
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


KAIKKI_URL = "https://kaikki.org/dictionary/Old%20Church%20Slavonic/kaikki.org-dictionary-OldChurchSlavonic.jsonl"
KAIKKI_SHA256 = "5bd61e747aa7aeb677af92b4e32c65476e5c6ee74bff146269460c962be5456c"
KAIKKI_EXTRACTED_AT = "2026-07-16"
KAIKKI_WIKTIONARY_DUMP = "2026-07-06"
BIBLE_COMMIT = "e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c"
BIBLE_URL = (
    "https://raw.githubusercontent.com/scrollmapper/bible_databases/"
    f"{BIBLE_COMMIT}/formats/txt/CSlElizabeth.txt"
)
PONOMAR_COMMIT = "467b94ec5a9e9f942308f16c519eac92c0ed4b86"
PONOMAR_BASE_URL = f"https://raw.githubusercontent.com/slavonic/Ponomar/{PONOMAR_COMMIT}"
PONOMAR_FONT_SHA256 = "5b36814f0cf948c93e21f7b4ee4237b9a0f9008c5c49f5553102ea861496a242"
FREQUENCY_LIMIT = 30000
SCHEMA_VERSION = "1"
ROOT_OF_APP_DIR = Path(os.environ.get(
    "MLEARN_ROOT_OF_APP",
    Path(__file__).resolve().parents[1] / "source" / "root-of-app",
))
DICTIONARY_DIR = ROOT_OF_APP_DIR / "dictionaries" / "cu" / "en"
DICTIONARY_PATH = DICTIONARY_DIR / "dictionary.db"
FREQUENCY_PATH = ROOT_OF_APP_DIR / "languages" / "cu.freq.json"
FONT_PATH = ROOT_OF_APP_DIR / "fonts" / "cu" / "Ponomar-Regular.woff2"
LICENSES_DIR = ROOT_OF_APP_DIR / "licenses"
VERSE_PREFIX = re.compile(r"^\[[^]]+]\s*")
IGNORED_FORM_TAGS = {
    "class",
    "error-unrecognized-form",
    "inflection-template",
    "romanization",
    "table-tags",
}
POS_TAGS = {
    "adj": "ADJ",
    "adv": "ADV",
    "character": "CHAR",
    "conj": "CCONJ",
    "contraction": "X",
    "det": "DET",
    "intj": "INTJ",
    "name": "PROPN",
    "noun": "NOUN",
    "num": "NUM",
    "particle": "PART",
    "prep": "ADP",
    "prefix": "X",
    "pron": "PRON",
    "punct": "PUNCT",
    "suffix": "X",
    "verb": "VERB",
}


def _log(message: str) -> None:
    print(message, flush=True)


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _download(url: str, destination: Path) -> None:
    _log(f"Downloading {url}")
    with urllib.request.urlopen(url, context=_ssl_context()) as response, destination.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _require_sha256(path: Path, expected: str) -> None:
    actual = _sha256(path)
    if actual != expected:
        raise RuntimeError(f"Checksum mismatch for {path.name}: expected {expected}, got {actual}")


def _normalize(value: Any) -> str:
    return unicodedata.normalize("NFC", " ".join(str(value or "").split()))


def _is_church_slavonic_word(value: str) -> bool:
    has_letter = False
    for char in value:
        category = unicodedata.category(char)
        if category.startswith("M"):
            continue
        if not category.startswith("L"):
            return False
        name = unicodedata.name(char, "")
        if "CYRILLIC" not in name and "GLAGOLITIC" not in name:
            return False
        has_letter = True
    return has_letter


def _iter_text_words(text: str):
    current: list[str] = []
    for char in unicodedata.normalize("NFC", text.casefold()):
        category = unicodedata.category(char)
        if category.startswith("L") or (category.startswith("M") and current):
            current.append(char)
            continue
        if current:
            word = "".join(current)
            current.clear()
            if _is_church_slavonic_word(word):
                yield word
    if current:
        word = "".join(current)
        if _is_church_slavonic_word(word):
            yield word


def _write_frequency(source_path: Path) -> tuple[list[str], int]:
    counts: Counter[str] = Counter()
    with source_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            counts.update(_iter_text_words(VERSE_PREFIX.sub("", line)))
    ranked = [word for word, _count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
    if len(ranked) < FREQUENCY_LIMIT:
        raise RuntimeError(f"Expected at least {FREQUENCY_LIMIT} Church Slavonic corpus words, found {len(ranked)}")
    selected = ranked[:FREQUENCY_LIMIT]
    FREQUENCY_PATH.parent.mkdir(parents=True, exist_ok=True)
    FREQUENCY_PATH.write_text(
        json.dumps({"freq": [[word, word] for word in selected]}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return selected, sum(counts.values())


def _unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = _normalize(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _entry_definitions(entry: dict[str, Any]) -> list[str]:
    definitions: list[str] = []
    for sense in entry.get("senses") or []:
        if not isinstance(sense, dict):
            continue
        definitions.extend(str(gloss) for gloss in sense.get("glosses") or [] if gloss)
    return _unique_strings(definitions)


def _entry_forms(entry: dict[str, Any]) -> list[tuple[str, str]]:
    headword = _normalize(entry.get("word"))
    forms = entry.get("forms") or []
    headword_reading = next((
        _normalize(form.get("form"))
        for form in forms
        if isinstance(form, dict) and "romanization" in (form.get("tags") or [])
    ), "")
    candidates: list[tuple[str, str]] = [(headword, headword_reading)]
    for form in forms:
        if not isinstance(form, dict):
            continue
        tags = {str(tag) for tag in form.get("tags") or []}
        if tags & IGNORED_FORM_TAGS:
            continue
        candidates.append((_normalize(form.get("form")), _normalize(form.get("roman"))))

    seen: set[str] = set()
    result: list[tuple[str, str]] = []
    for surface, reading in candidates:
        key = surface.casefold()
        if not surface or key in seen or not _is_church_slavonic_word(surface):
            continue
        seen.add(key)
        result.append((surface, reading or headword_reading))
    return result


def _compress(payload: dict[str, Any]) -> bytes:
    return zlib.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _build_dictionary(source_path: Path, frequency_words: list[str], built_at: str) -> tuple[int, int]:
    DICTIONARY_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path = DICTIONARY_DIR / "dictionary.tmp"
    if temporary_path.exists():
        temporary_path.unlink()
    frequency_ranks = {word: rank for rank, word in enumerate(frequency_words)}

    conn = sqlite3.connect(temporary_path)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("CREATE TABLE entries (headword TEXT NOT NULL, reading TEXT, data BLOB NOT NULL)")
    batch: list[tuple[str, str, bytes]] = []
    source_entries = 0
    inserted = 0
    with source_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            entry = json.loads(line)
            definitions = _entry_definitions(entry)
            forms = _entry_forms(entry)
            if not definitions or not forms:
                continue
            source_entries += 1
            lemma = _normalize(entry.get("word"))
            part_of_speech = POS_TAGS.get(str(entry.get("pos") or ""), "X")
            for surface, reading in forms:
                rank = frequency_ranks.get(surface.casefold())
                payload = {
                    "word": surface,
                    "lemma": lemma,
                    "reading": reading,
                    "definitions": definitions,
                    "partOfSpeech": [part_of_speech],
                    "common": rank is not None and rank < 5000,
                    "score": max(0, FREQUENCY_LIMIT - rank) if rank is not None else 0,
                }
                batch.append((surface.casefold(), reading.casefold(), _compress(payload)))
                inserted += 1
                if len(batch) >= 5000:
                    conn.executemany("INSERT INTO entries VALUES (?, ?, ?)", batch)
                    batch.clear()
    if batch:
        conn.executemany("INSERT INTO entries VALUES (?, ?, ?)", batch)
    conn.execute("CREATE INDEX idx_entries_headword ON entries(headword)")
    conn.execute("CREATE INDEX idx_entries_reading ON entries(reading)")
    conn.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("version", f"{SCHEMA_VERSION}:kaikki-{KAIKKI_EXTRACTED_AT}"),
        ("source", "English Wiktionary via kaikki.org"),
        ("source_sha256", KAIKKI_SHA256),
        ("built_at", built_at),
    ])
    conn.commit()
    conn.execute("PRAGMA optimize")
    conn.close()
    temporary_path.replace(DICTIONARY_PATH)
    return source_entries, inserted


def _write_dictionary_notices(built_at: str, source_entries: int, inserted: int) -> None:
    metadata = {
        "version": f"kaikki-{KAIKKI_EXTRACTED_AT}",
        "source_url": KAIKKI_URL,
        "source_sha256": KAIKKI_SHA256,
        "wiktionary_dump": KAIKKI_WIKTIONARY_DUMP,
        "license": "CC-BY-SA-4.0",
        "target_language": "en",
        "source_entries": source_entries,
        "inserted_forms": inserted,
        "built_at": built_at,
    }
    (DICTIONARY_DIR / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (DICTIONARY_DIR / "LICENSE").write_text(
        "Old Church Slavonic dictionary data extracted from English Wiktionary via kaikki.org.\n"
        "Wiktionary contributors license the text under CC BY-SA 4.0.\n"
        "License: https://creativecommons.org/licenses/by-sa/4.0/\n"
        "Attribution history: https://en.wiktionary.org/\n",
        encoding="utf-8",
    )
    (DICTIONARY_DIR / "README.md").write_text(
        "# Old Church Slavonic to English\n\n"
        f"Derived from the kaikki.org extraction dated {KAIKKI_EXTRACTED_AT}, based on the "
        f"English Wiktionary dump dated {KAIKKI_WIKTIONARY_DUMP}. Inflected forms are indexed "
        "for lookup and the source text is not modified beyond normalization and schema conversion.\n\n"
        "License: CC BY-SA 4.0.\n",
        encoding="utf-8",
    )


def _write_core_notices() -> None:
    LICENSES_DIR.mkdir(parents=True, exist_ok=True)
    (LICENSES_DIR / "csl-elizabeth-PUBLIC-DOMAIN.md").write_text(
        "# 1757 Church Slavonic Elizabeth Bible\n\n"
        "The CSlElizabeth text used to derive the frequency list is public domain.\n"
        f"Source snapshot: https://github.com/scrollmapper/bible_databases/tree/{BIBLE_COMMIT}\n"
        "CrossWire module information: https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=CSlElizabeth\n",
        encoding="utf-8",
    )
    (LICENSES_DIR / "ponomar-README.md").write_text(
        "# Ponomar\n\n"
        "Ponomar is a contemporary Church Slavonic typeface from the Slavonic Computing Initiative.\n"
        f"Source commit: https://github.com/slavonic/Ponomar/commit/{PONOMAR_COMMIT}\n"
        "The unmodified webfont is distributed under SIL Open Font License 1.1.\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.parse_args()
    built_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    with tempfile.TemporaryDirectory(prefix="church-slavonic-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        dictionary_source = temp_dir / "kaikki-ocs.jsonl"
        bible_source = temp_dir / "CSlElizabeth.txt"
        font_source = temp_dir / "Ponomar-Regular.woff2"
        font_license_source = temp_dir / "OFL.txt"
        _download(KAIKKI_URL, dictionary_source)
        _require_sha256(dictionary_source, KAIKKI_SHA256)
        _download(BIBLE_URL, bible_source)
        _download(f"{PONOMAR_BASE_URL}/fonts/webfonts/Ponomar-Regular.woff2", font_source)
        _require_sha256(font_source, PONOMAR_FONT_SHA256)
        _download(f"{PONOMAR_BASE_URL}/OFL.txt", font_license_source)

        frequency_words, corpus_token_count = _write_frequency(bible_source)
        source_entries, inserted = _build_dictionary(dictionary_source, frequency_words, built_at)
        _write_dictionary_notices(built_at, source_entries, inserted)
        FONT_PATH.parent.mkdir(parents=True, exist_ok=True)
        FONT_PATH.write_bytes(font_source.read_bytes())
        _write_core_notices()
        (LICENSES_DIR / "ponomar-OFL.txt").write_bytes(font_license_source.read_bytes())
        _log(
            f"Built Church Slavonic: {len(frequency_words)} frequency rows from {corpus_token_count} corpus tokens, "
            f"{source_entries} dictionary entries, {inserted} indexed forms"
        )


if __name__ == "__main__":
    main()
