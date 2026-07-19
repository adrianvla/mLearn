#!/usr/bin/env python3

import argparse
import json
import os
import shutil
import sqlite3
import ssl
import tarfile
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timezone
from pathlib import Path


DATABASE_INDEX_URL = "https://freedict.org/freedict-database.json"
SCHEMA_VERSION = "1"
NS = {"tei": "http://www.tei-c.org/ns/1.0"}
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
ROOT_OF_APP_DIR = Path(os.environ.get(
    "MLEARN_ROOT_OF_APP",
    Path(__file__).resolve().parents[1] / "source" / "root-of-app",
))
OUTPUT_DIR = ROOT_OF_APP_DIR / "dictionaries" / "de" / "en"
DB_PATH = OUTPUT_DIR / "dictionary.db"
METADATA_PATH = OUTPUT_DIR / "metadata.json"
LICENSE_PATH = OUTPUT_DIR / "LICENSE"
README_PATH = OUTPUT_DIR / "README.md"


def _log(message: str) -> None:
    print(message, flush=True)


def _normalize(text: str | None) -> str:
    if not text:
        return ""
    return " ".join(text.split())


def _unique(values: list[str]) -> list[str]:
    seen = set()
    result: list[str] = []
    for value in values:
        normalized = _normalize(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _download(url: str, destination: Path) -> None:
    _log(f"Downloading {url}")
    with urllib.request.urlopen(url, context=_ssl_context()) as response, destination.open("wb") as handle:
        total = int(response.headers.get("Content-Length", "0"))
        downloaded = 0
        last_percent = -1
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            downloaded += len(chunk)
            if total > 0:
                percent = int(downloaded * 100 / total)
                if percent != last_percent and percent % 5 == 0:
                    _log(f"Download progress: {percent}%")
                    last_percent = percent
    _log(f"Downloaded to {destination}")


def _load_database_index() -> list[dict]:
    with urllib.request.urlopen(DATABASE_INDEX_URL, context=_ssl_context()) as response:
        return json.load(response)


def _ssl_context():
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        _log("Warning: falling back to an unverified SSL context for FreeDict download")
        return ssl._create_unverified_context()


def _select_release() -> tuple[dict, dict]:
    dictionaries = _load_database_index()
    entry = next((item for item in dictionaries if item.get("name") == "deu-eng"), None)
    if entry is None:
        raise RuntimeError("Could not find deu-eng in FreeDict database index")

    candidates: list[tuple[str, dict]] = []
    for release in entry.get("releases", []):
        url = str(release.get("URL", ""))
        version = str(release.get("software-version") or release.get("version") or "").strip()
        if not version:
            continue
        if url.endswith(".src.tar.xz"):
            candidates.append((str(release.get("date") or ""), release))

    if not candidates:
        raise RuntimeError("Could not find a usable deu-eng source release")

    candidates.sort(key=lambda item: item[0])
    release = candidates[-1][1]
    return entry, release


def _extract_archive(archive_path: Path, destination: Path) -> tuple[Path, Path]:
    _log("Extracting archive")
    tei_path: Path | None = None
    license_source: Path | None = None

    with tarfile.open(archive_path, "r:xz") as archive:
        members = archive.getmembers()
        for index, member in enumerate(members, start=1):
            if not member.isfile():
                continue
            member_name = Path(member.name).name.lower()
            if tei_path is not None and license_source is not None:
                continue
            if member_name.endswith(".tei") or member_name.endswith(".tei.xml"):
                archive.extract(member, destination)
                tei_path = destination / member.name
            elif member_name in {"copying", "license", "license.txt", "copying.txt"}:
                archive.extract(member, destination)
                license_source = destination / member.name
            if index % 1000 == 0:
                _log(f"Scanned {index} archive members")

    if tei_path is None:
        raise RuntimeError("Could not find a TEI file in the downloaded archive")
    if license_source is None:
        raise RuntimeError("Could not find COPYING/LICENSE in the downloaded archive")

    _log(f"TEI file: {tei_path}")
    _log(f"License file: {license_source}")
    return tei_path, license_source


def _resolve_license_from_header(availability_text: str, fallback_license_path: Path) -> str:
    text = availability_text.lower()
    if "gnu general public license, version 3" in text and "gnu affero general public license, version 3" in text:
        return "GPL-3.0-or-later AND AGPL-3.0-or-later"

    with fallback_license_path.open("r", encoding="utf-8") as handle:
        first_chunk = handle.read(2048).lower()
    if "gnu general public license" in first_chunk and "version 2" in first_chunk:
        return "GPL-2.0-or-later"
    return "UNKNOWN"


def _read_header_metadata(tei_path: Path, fallback_license_path: Path) -> tuple[str, str]:
    version = ""
    availability_parts: list[str] = []
    context = ET.iterparse(str(tei_path), events=("start", "end"))
    for event, elem in context:
        tag = elem.tag.rsplit("}", 1)[-1]
        if event == "end" and tag == "edition" and not version:
            version = _normalize("".join(elem.itertext()))
        elif event == "end" and tag == "availability":
            availability_parts.append(_normalize(" ".join(elem.itertext())))
            break
    availability_text = " ".join(part for part in availability_parts if part)
    license_spdx = _resolve_license_from_header(availability_text, fallback_license_path)
    return version, license_spdx


def _extract_direct_quotes(node: ET.Element) -> list[str]:
    values: list[str] = []
    for quote in node.findall("./tei:quote", NS):
        lang = quote.attrib.get(XML_LANG, "")
        if not lang or lang.startswith("en"):
            values.append(_normalize("".join(quote.itertext())))
    return _unique(values)


def _extract_examples(node: ET.Element) -> list[dict]:
    examples: list[dict] = []
    for child in node.findall("./tei:cit", NS):
        if child.attrib.get("type") != "example":
            continue
        source_text = _normalize("".join((child.find("./tei:quote", NS) or ET.Element("empty")).itertext()))
        translations: list[str] = []
        for nested in child.findall("./tei:cit", NS):
            if nested.attrib.get("type") == "trans":
                translations.extend(_extract_direct_quotes(nested))
        if source_text or translations:
            examples.append({
                "text": source_text,
                "translations": _unique(translations),
            })
    return examples


def _extract_notes(node: ET.Element) -> list[str]:
    notes: list[str] = []
    for usage in node.findall("./tei:usg", NS):
        value = _normalize("".join(usage.itertext()))
        if value:
            notes.append(value)
    for note in node.findall("./tei:note", NS):
        value = _normalize("".join(note.itertext()))
        if value:
            notes.append(value)
    for xr in node.findall("./tei:xr", NS):
        refs = _unique([_normalize("".join(ref.itertext())) for ref in xr.findall("./tei:ref", NS)])
        if refs:
            xr_type = xr.attrib.get("type")
            prefix = f"{xr_type}: " if xr_type else ""
            notes.append(prefix + ", ".join(refs))
    return _unique(notes)


def _parse_senses(node: ET.Element, inherited_pos: str | None) -> list[dict]:
    sense_pos = _normalize(node.findtext("./tei:gramGrp/tei:pos", default="", namespaces=NS)) or inherited_pos or ""
    glosses: list[str] = []
    for cit in node.findall("./tei:cit", NS):
        if cit.attrib.get("type") == "trans":
            glosses.extend(_extract_direct_quotes(cit))
    for definition in node.findall("./tei:def", NS):
        value = _normalize("".join(definition.itertext()))
        if value:
            glosses.append(value)

    parsed: list[dict] = []
    gloss_values = _unique(glosses)
    examples = _extract_examples(node)
    notes = _extract_notes(node)
    if gloss_values or examples or notes:
        parsed.append({
            "glosses": gloss_values,
            "examples": examples,
            "pos": sense_pos,
            "notes": notes,
        })

    for nested in node.findall("./tei:sense", NS):
        parsed.extend(_parse_senses(nested, sense_pos))
    return parsed


def _compress_payload(payload: dict) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return zlib.compress(raw)


def _write_database(tei_path: Path, release_version: str, source_url: str, license_spdx: str, build_date: str) -> tuple[int, int]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()

    _log(f"Building SQLite database at {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.executescript(
        """
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            headword TEXT NOT NULL,
            headword_lower TEXT NOT NULL,
            pos TEXT,
            data BLOB NOT NULL
        );
        CREATE INDEX idx_entries_headword_lower ON entries(headword_lower);
        """
    )

    entry_count = 0
    inserted_count = 0
    batch: list[tuple[str, str, str | None, bytes]] = []
    context = ET.iterparse(str(tei_path), events=("end",))
    for _, elem in context:
        if elem.tag != f"{{{NS['tei']}}}entry":
            continue

        entry_count += 1
        headwords = _unique([
            _normalize("".join(orth.itertext()))
            for orth in elem.findall("./tei:form/tei:orth", NS)
        ])
        entry_pos = _normalize(elem.findtext("./tei:gramGrp/tei:pos", default="", namespaces=NS))
        parsed_senses: list[dict] = []
        for sense in elem.findall("./tei:sense", NS):
            parsed_senses.extend(_parse_senses(sense, entry_pos))

        if headwords and parsed_senses:
            for headword in headwords:
                for parsed_sense in parsed_senses:
                    payload = {
                        "glosses": parsed_sense["glosses"],
                        "examples": parsed_sense["examples"],
                        "pos": parsed_sense.get("pos") or entry_pos,
                        "notes": parsed_sense["notes"],
                    }
                    batch.append((
                        headword,
                        headword.lower(),
                        payload["pos"] or None,
                        _compress_payload(payload),
                    ))
                    inserted_count += 1
        if len(batch) >= 5000:
            conn.executemany(
                "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
                batch,
            )
            conn.commit()
            batch.clear()
            _log(f"Parsed entries: {entry_count} | Inserted rows: {inserted_count}")

        elem.clear()

    if batch:
        conn.executemany(
            "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
            batch,
        )
        conn.commit()

    conn.executemany(
        "INSERT INTO meta (key, value) VALUES (?, ?)",
        [
            ("schema_version", SCHEMA_VERSION),
            ("freedict_version", release_version),
            ("source_url", source_url),
            ("build_date", build_date),
        ],
    )
    conn.commit()
    conn.close()
    _log(f"Finished parsing {entry_count} entries and inserting {inserted_count} rows")
    return entry_count, inserted_count


def _write_metadata(release_version: str, source_url: str, license_spdx: str, build_date: str) -> None:
    payload = {
        "version": release_version,
        "source_url": source_url,
        "license": license_spdx,
        "built_at": build_date,
    }
    METADATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_readme(release_version: str, source_url: str, license_spdx: str, build_date: str) -> None:
    readme = f"""# FreeDict deu-eng

- Source URL: {source_url}
- Version: {release_version}
- License SPDX: {license_spdx}
- Build date: {build_date}

This dictionary is derived from FreeDict (https://freedict.org/).

Upstream attribution and licensing notice for this release:

> This dictionary is free software: you can redistribute it and/or modify it under the terms of both the GNU General Public License, version 3 (GPLv3) and the GNU Affero General Public License, version 3 (AGPLv3), where each of these licenses applies to different parts of this (combined) work.
>
> The "source form", as defined in both the GPLv3 and AGPLv3, of this dictionary is composed of the original Ding dictionary (licensed GPLv2+) and the ding2tei-haskell program (licensed AGPLv3+).
"""
    README_PATH.write_text(readme, encoding="utf-8")


def _database_is_valid(expected_version: str) -> bool:
    if not DB_PATH.exists() or not METADATA_PATH.exists():
        return False
    try:
        with METADATA_PATH.open("r", encoding="utf-8") as handle:
            metadata = json.load(handle)
        if str(metadata.get("version")) != expected_version:
            return False
        conn = sqlite3.connect(DB_PATH)
        rows = dict(conn.execute("SELECT key, value FROM meta").fetchall())
        conn.close()
        return rows.get("schema_version") == SCHEMA_VERSION and rows.get("freedict_version") == expected_version
    except Exception:
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    entry, release = _select_release()
    source_url = str(release["URL"])
    expected_version = str(release.get("software-version") or release.get("version") or entry.get("edition") or "")
    if not expected_version:
        raise RuntimeError("Could not resolve a version for the selected deu-eng release")

    if not args.force and _database_is_valid(expected_version):
        _log(f"Dictionary already built for version {expected_version}; skipping rebuild")
        return

    with tempfile.TemporaryDirectory(prefix="freedict-deu-eng-") as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        archive_path = temp_dir / Path(source_url).name
        _download(source_url, archive_path)
        tei_path, license_source = _extract_archive(archive_path, temp_dir)
        header_version, license_spdx = _read_header_metadata(tei_path, license_source)
        resolved_version = header_version or expected_version
        build_date = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        entry_count, inserted_count = _write_database(tei_path, resolved_version, source_url, license_spdx, build_date)
        shutil.copyfile(license_source, LICENSE_PATH)
        _write_metadata(resolved_version, source_url, license_spdx, build_date)
        _write_readme(resolved_version, source_url, license_spdx, build_date)
        _log(
            f"Built FreeDict deu-eng {resolved_version} | License {license_spdx} | Parsed {entry_count} entries | Inserted {inserted_count} rows"
        )


if __name__ == "__main__":
    main()
