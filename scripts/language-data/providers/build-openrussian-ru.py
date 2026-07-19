#!/usr/bin/env python3

import argparse
import csv
import gzip
import json
import os
import sqlite3
import ssl
import tempfile
import urllib.request
import unicodedata
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SOURCE_COMMIT = "50e210c4803237779cb562bc1abcea529066031c"
SOURCE_BASE_URL = f"https://raw.githubusercontent.com/Badestrand/russian-dictionary/{SOURCE_COMMIT}"
SCHEMA_VERSION = "1"
SOURCE_FILES = {
    "nouns": ("NOUN", 10),
    "verbs": ("VERB", 6),
    "adjectives": ("ADJ", 4),
    "others": ("X", 4),
}
ROOT_OF_APP_DIR = Path(os.environ.get(
    "MLEARN_ROOT_OF_APP",
    Path(__file__).resolve().parents[1] / "source" / "root-of-app",
))
PRONUNCIATION_PATH = ROOT_OF_APP_DIR / "languages" / "ru.pronunciation.json.gz"
FREQUENCY_PATH = ROOT_OF_APP_DIR / "languages" / "ru.freq.json"


def _log(message: str) -> None:
    print(message, flush=True)


def _ssl_context():
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl._create_unverified_context()


def _download(url: str, destination: Path) -> None:
    _log(f"Downloading {url}")
    with urllib.request.urlopen(url, context=_ssl_context()) as response, destination.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)


def _normalize(value: Any) -> str:
    if isinstance(value, list):
        value = " ".join(str(part) for part in value if part)
    return " ".join(str(value or "").replace("*", "").split()).strip()


def _stressed(value: str | None) -> str:
    return unicodedata.normalize("NFC", _normalize(value).replace("'", "\u0301"))


def _unstressed(value: str | None) -> str:
    decomposed = unicodedata.normalize("NFD", _normalize(value).replace("'", ""))
    return unicodedata.normalize("NFC", "".join(char for char in decomposed if char != "\u0301"))


def _definitions(value: str | None) -> list[str]:
    return [part.strip() for part in _normalize(value).split(";") if part.strip()]


def _forms(row: dict[str, str], form_columns: list[str]) -> list[tuple[str, str]]:
    forms: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    candidates = [row.get("accented") or row.get("bare") or ""]
    for column in form_columns:
        candidates.extend((row.get(column) or "").split(","))
    for candidate in candidates:
        reading = _stressed(candidate)
        surface = _unstressed(candidate)
        key = (surface.casefold(), reading.casefold())
        if surface and key not in seen:
            seen.add(key)
            forms.append((surface, reading or surface))
    return forms


def _read_records(temp_dir: Path) -> list[dict]:
    records: list[dict] = []
    for source_name, (part_of_speech, first_form_index) in SOURCE_FILES.items():
        csv_path = temp_dir / f"{source_name}.csv"
        _download(f"{SOURCE_BASE_URL}/{source_name}.csv", csv_path)
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            fieldnames = list(reader.fieldnames or [])
            form_columns = fieldnames[first_form_index:]
            for rank, row in enumerate(reader):
                lemma = _unstressed(row.get("bare"))
                if not lemma:
                    continue
                excluded_columns = {"bare", "accented", "translations_en", "translations_de", *form_columns}
                attributes: dict[str, str] = {}
                for key, raw_value in row.items():
                    if key is None:
                        continue
                    normalized_value = _normalize(raw_value)
                    if key not in excluded_columns and normalized_value:
                        attributes[key] = normalized_value
                records.append({
                    "lemma": lemma,
                    "reading": _stressed(row.get("accented") or lemma),
                    "partOfSpeech": part_of_speech,
                    "rank": rank,
                    "forms": _forms(row, form_columns),
                    "definitions": {
                        "en": _definitions(row.get("translations_en")),
                        "de": _definitions(row.get("translations_de")),
                    },
                    "attributes": attributes,
                })
    return records


def _compress(payload: dict) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return zlib.compress(raw)


def _build_dictionary(records: list[dict], target_language: str, built_at: str) -> int:
    output_dir = ROOT_OF_APP_DIR / "dictionaries" / "ru" / target_language
    output_dir.mkdir(parents=True, exist_ok=True)
    db_path = output_dir / "dictionary.db"
    temp_path = output_dir / "dictionary.tmp"
    if temp_path.exists():
        temp_path.unlink()

    conn = sqlite3.connect(temp_path)
    conn.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (headword TEXT NOT NULL, reading TEXT, data BLOB NOT NULL);
    """)
    batch: list[tuple[str, str, bytes]] = []
    count = 0
    for record in records:
        definitions = record["definitions"][target_language]
        if not definitions:
            continue
        for surface, reading in record["forms"]:
            payload = {
                "word": surface,
                "lemma": record["lemma"],
                "reading": reading,
                "definitions": definitions,
                "partOfSpeech": [record["partOfSpeech"]],
                "attributes": record["attributes"],
                "common": record["rank"] < 5000,
                "score": max(0, 50000 - record["rank"]),
            }
            batch.append((surface, surface.casefold(), sqlite3.Binary(_compress(payload))))
            count += 1
            if len(batch) >= 5000:
                conn.executemany("INSERT INTO entries VALUES (?, ?, ?)", batch)
                batch.clear()
    if batch:
        conn.executemany("INSERT INTO entries VALUES (?, ?, ?)", batch)
    conn.executescript("""
        CREATE INDEX idx_entries_headword ON entries(headword);
        CREATE INDEX idx_entries_reading ON entries(reading);
    """)
    conn.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("version", f"{SCHEMA_VERSION}:openrussian-{SOURCE_COMMIT}"),
        ("source", "OpenRussian"),
        ("source_commit", SOURCE_COMMIT),
        ("built_at", built_at),
    ])
    conn.commit()
    conn.execute("PRAGMA optimize")
    conn.close()
    temp_path.replace(db_path)

    metadata = {
        "version": f"openrussian-{SOURCE_COMMIT[:12]}",
        "source_url": "https://github.com/Badestrand/russian-dictionary",
        "source_commit": SOURCE_COMMIT,
        "license": "CC-BY-SA-4.0",
        "target_language": target_language,
        "entries": count,
        "built_at": built_at,
    }
    (output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_dir / "LICENSE").write_text(
        "OpenRussian dictionary data\nCopyright OpenRussian contributors\nLicensed under CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/\n",
        encoding="utf-8",
    )
    (output_dir / "README.md").write_text(
        f"# OpenRussian Russian to {target_language}\n\nDerived from https://github.com/Badestrand/russian-dictionary at `{SOURCE_COMMIT}`.\n\nLicense: CC BY-SA 4.0.\n",
        encoding="utf-8",
    )
    return count


def _write_core_assets(records: list[dict]) -> tuple[int, int]:
    pronunciations: dict[str, str] = {}
    frequency_rows: list[list[str]] = []
    seen_frequency: set[str] = set()
    for record in sorted(records, key=lambda item: (item["rank"], item["partOfSpeech"], item["lemma"])):
        for surface, reading in record["forms"]:
            pronunciations.setdefault(surface.casefold(), reading)
        key = record["lemma"].casefold()
        if key not in seen_frequency:
            seen_frequency.add(key)
            frequency_rows.append([record["lemma"], record["reading"]])

    PRONUNCIATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    encoded_pronunciations = json.dumps(
        pronunciations,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    with PRONUNCIATION_PATH.open("wb") as raw_handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_handle, compresslevel=9, mtime=0) as handle:
            handle.write(encoded_pronunciations)
    FREQUENCY_PATH.write_text(
        json.dumps(frequency_rows, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return len(pronunciations), len(frequency_rows)


def _write_source_license() -> None:
    output_dir = ROOT_OF_APP_DIR / "licenses"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "openrussian-LICENSE").write_text(
        "OpenRussian dictionary data\nCopyright OpenRussian contributors\n"
        "Licensed under CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/\n",
        encoding="utf-8",
    )
    (output_dir / "openrussian-README.md").write_text(
        f"OpenRussian stress, frequency, inflection, and dictionary data\n\n"
        f"Source commit: https://github.com/Badestrand/russian-dictionary/commit/{SOURCE_COMMIT}\n"
        "License: CC BY-SA 4.0.\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Reserved for parity with the other providers")
    parser.parse_args()

    built_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    with tempfile.TemporaryDirectory(prefix="openrussian-") as temp_dir_name:
        records = _read_records(Path(temp_dir_name))
    pronunciation_count, frequency_count = _write_core_assets(records)
    _write_source_license()
    en_count = _build_dictionary(records, "en", built_at)
    de_count = _build_dictionary(records, "de", built_at)
    _log(
        f"Built Russian packages: {len(records)} lemmas, {pronunciation_count} stressed forms, "
        f"{frequency_count} frequency rows, {en_count} EN rows, {de_count} DE rows"
    )


if __name__ == "__main__":
    main()
