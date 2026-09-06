"""Build FreeDict-derived bilingual dictionary packs for mLearn.

Generalized multi-pack builder: each entry in FREE_DICT_PACKS describes one
learning-language -> display-language dictionary pack built from a FreeDict
TEI source release. The output SQLite schema matches the target language's
declared runtime dictionary contract:

- ``simple-headword-zlib-json``: entries(id, headword, headword_lower, pos,
  data) with payloads ``{"glosses", "examples", "pos", "notes"}``.
- ``headword-reading-zlib-json``: entries(headword, reading, data) with
  structured-glosses payloads ``{"word", "reading", "definitions",
  "partOfSpeech", "attributes"}``.

Licenses are read from each FreeDict archive's TEI header/COPYING file and
written verbatim next to the built dictionary.
"""

import argparse
import json
import os
import shutil
import sqlite3
import ssl
import tarfile
import tempfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

DATABASE_INDEX_URL = "https://freedict.org/freedict-database.json"
SCHEMA_VERSION = "1"
SIMPLE_SCHEMA = "simple-headword-zlib-json"
HEADWORD_READING_SCHEMA = "headword-reading-zlib-json"
FREQUENCY_LIMIT = 50_000
FREQUENCY_MIN_ROWS = 40_000
FREQUENCY_SOURCE_COMMIT = "525f9b560de45753a5ea01069454e72e9aa541c6"
NS = {"tei": "http://www.tei-c.org/ns/1.0"}
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
ROOT_OF_APP_DIR = Path(os.environ.get(
    "MLEARN_ROOT_OF_APP",
    Path(__file__).resolve().parents[1] / "source" / "root-of-app",
))


@dataclass(frozen=True)
class FreeDictPack:
    learning_language: str
    language_name: str
    freedict_name: str
    frequency_code: str
    target_language: str = "en"
    # xml:lang of translation quotes inside the FreeDict TEI source. Defaults
    # to target_language (direct packs); inverted packs select the source-side
    # gloss language instead (e.g. eng-spa inverted into es->en selects "es").
    tei_translation_language: str | None = None
    invert_dictionary: bool = False
    output_schema: str = SIMPLE_SCHEMA
    # False when the learning language's frequency asset is owned by another
    # provider (e.g. zh HSK ranks, ru OpenRussian ranks) — the pack must not
    # clobber it with a generic FrequencyWords list.
    build_frequency: bool = True
    # Optional mapping-table asset (languages/ relative path, MappingTable JSON)
    # used to insert additional headword rows in the converted script — e.g.
    # zho-rus headwords are Traditional; the zh.t2s table adds Simplified rows
    # pointing at the same payload so both script forms are lookable.
    headword_mapping_table: str | None = None

    @property
    def pack_id(self) -> str:
        return f"{self.learning_language}-{self.target_language}"

    @property
    def resolved_tei_translation_language(self) -> str:
        return self.tei_translation_language or self.target_language

    @property
    def output_dir(self) -> Path:
        return ROOT_OF_APP_DIR / "dictionaries" / self.learning_language / self.target_language

    @property
    def database_path(self) -> Path:
        return self.output_dir / "dictionary.db"

    @property
    def metadata_path(self) -> Path:
        return self.output_dir / "metadata.json"

    @property
    def license_path(self) -> Path:
        return self.output_dir / "LICENSE"

    @property
    def readme_path(self) -> Path:
        return self.output_dir / "README.md"

    @property
    def frequency_path(self) -> Path:
        return ROOT_OF_APP_DIR / "languages" / f"{self.learning_language}.freq.json"

    @property
    def frequency_source_url(self) -> str:
        return (
            "https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
            f"{FREQUENCY_SOURCE_COMMIT}/content/2018/{self.frequency_code}/{self.frequency_code}_50k.txt"
        )


# One entry per shippable learning->display dictionary pack. `invert_dictionary`
# builds lookup rows from an inverted source (target-language headwords with
# learning-language glosses); direct packs keep the FreeDict direction.
FREEDICT_PACKS: dict[str, FreeDictPack] = {
    "de-en": FreeDictPack("de", "German", "deu-eng", "de", "en"),
    "de-ru": FreeDictPack("de", "German", "deu-rus", "de", "ru", "ru"),
    "de-fr": FreeDictPack("de", "German", "deu-fra", "de", "fr", "fr"),
    "de-ja": FreeDictPack("de", "German", "deu-jpn", "de", "ja", "ja"),
    "ru-fr": FreeDictPack("ru", "Russian", "rus-fra", "ru", "fr", "fr", output_schema=HEADWORD_READING_SCHEMA, build_frequency=False),
    "zh-ru": FreeDictPack(
        "zh", "Chinese", "zho-rus", "zh", "ru", "ru",
        output_schema=HEADWORD_READING_SCHEMA,
        build_frequency=False,
        headword_mapping_table="zh.t2s.json",
    ),
    "es-en": FreeDictPack("es", "Spanish", "eng-spa", "es", "en", "es", True),
    "es-ru": FreeDictPack("es", "Spanish", "spa-rus", "es", "ru", "ru"),
    "es-de": FreeDictPack("es", "Spanish", "spa-deu", "es", "de", "de"),
    "es-fr": FreeDictPack("es", "Spanish", "spa-fra", "es", "fr", "fr"),
}

# Legacy per-language alias (one FreeDict pack per language, English target):
# kept for the historical `--language de|es` CLI form.
LEGACY_LANGUAGE_PACKS = {
    "de": "de-en",
    "es": "es-en",
}


class ParsedSense(TypedDict):
    glosses: list[str]
    examples: list[dict[str, Any]]
    pos: str
    notes: list[str]


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


def _write_frequency(source_path: Path, pack: FreeDictPack) -> int:
    rows: list[list[str]] = []
    seen: set[str] = set()
    with source_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            word, separator, _count = line.rstrip("\n").rpartition(" ")
            word = unicodedata.normalize("NFC", word.strip())
            key = word.casefold()
            if not separator or not word.isalpha() or key in seen:
                continue
            seen.add(key)
            rows.append([word, word])
            if len(rows) == FREQUENCY_LIMIT:
                break
    if len(rows) < FREQUENCY_MIN_ROWS:
        raise RuntimeError(
            f"Expected at least {FREQUENCY_MIN_ROWS} {pack.language_name} frequency rows, found {len(rows)}"
        )
    pack.frequency_path.parent.mkdir(parents=True, exist_ok=True)
    pack.frequency_path.write_text(
        json.dumps({"freq": rows}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return len(rows)


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


def _load_database_index() -> list[dict[str, Any]]:
    with urllib.request.urlopen(DATABASE_INDEX_URL, context=_ssl_context()) as response:
        return json.load(response)


def _ssl_context():
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        _log("Warning: falling back to an unverified SSL context for FreeDict download")
        return ssl._create_unverified_context()


def _select_release(pack: FreeDictPack) -> tuple[dict[str, Any], dict[str, Any]]:
    dictionaries = _load_database_index()
    entry = next((item for item in dictionaries if item.get("name") == pack.freedict_name), None)
    if entry is None:
        raise RuntimeError(f"Could not find {pack.freedict_name} in FreeDict database index")

    candidates: list[tuple[str, dict[str, Any]]] = []
    for release in entry.get("releases", []):
        url = str(release.get("URL", ""))
        version = str(release.get("software-version") or release.get("version") or "").strip()
        if not version:
            continue
        if url.endswith(".src.tar.xz"):
            candidates.append((str(release.get("date") or ""), release))

    if not candidates:
        raise RuntimeError(f"Could not find a usable {pack.freedict_name} source release")

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
    if "creative commons attribution-sharealike 3.0 unported" in text:
        return "CC-BY-SA-3.0"
    if "creative commons attribution-sharealike 4.0 international" in text:
        return "CC-BY-SA-4.0"
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


def _extract_direct_quotes(node: ET.Element, translation_language: str) -> list[str]:
    values: list[str] = []
    for quote in node.findall("./tei:quote", NS):
        lang = quote.attrib.get(XML_LANG, "")
        if not lang or lang.startswith(translation_language):
            values.append(_normalize("".join(quote.itertext())))
    return _unique(values)


def _extract_examples(node: ET.Element, translation_language: str) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    for child in node.findall("./tei:cit", NS):
        if child.attrib.get("type") != "example":
            continue
        source_text = _normalize("".join((child.find("./tei:quote", NS) or ET.Element("empty")).itertext()))
        translations: list[str] = []
        for nested in child.findall("./tei:cit", NS):
            if nested.attrib.get("type") == "trans":
                translations.extend(_extract_direct_quotes(nested, translation_language))
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


def _parse_senses(node: ET.Element, inherited_pos: str | None, translation_language: str) -> list[ParsedSense]:
    sense_pos = _normalize(node.findtext("./tei:gramGrp/tei:pos", default="", namespaces=NS)) or inherited_pos or ""
    glosses: list[str] = []
    for cit in node.findall("./tei:cit", NS):
        if cit.attrib.get("type") == "trans":
            glosses.extend(_extract_direct_quotes(cit, translation_language))
    for definition in node.findall("./tei:def", NS):
        value = _normalize("".join(definition.itertext()))
        if value:
            glosses.append(value)

    parsed: list[ParsedSense] = []
    gloss_values = _unique(glosses)
    examples = _extract_examples(node, translation_language)
    notes = _extract_notes(node)
    if gloss_values or examples or notes:
        parsed.append({
            "glosses": gloss_values,
            "examples": examples,
            "pos": sense_pos,
            "notes": notes,
        })

    for nested in node.findall("./tei:sense", NS):
        parsed.extend(_parse_senses(nested, sense_pos, translation_language))
    return parsed


def _compress_payload(payload: dict[str, Any]) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return zlib.compress(raw)



def _load_mapping_table(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    table = json.loads(path.read_text(encoding="utf-8"))
    return table.get("words", {}), table.get("chars", {})


def _map_headword(headword: str, words: dict[str, str], chars: dict[str, str]) -> str:
    if headword in words:
        return words[headword]
    return "".join(chars.get(char, char) for char in headword)


def _augment_headwords_with_mapping(pack: FreeDictPack, conn: sqlite3.Connection) -> int:
    """Insert converted-script headword rows pointing at the same payloads.

    Uses the live write connection owned by _write_database: opening a second
    connection to the same file mid-write deadlocks on its lock.
    """
    if not pack.headword_mapping_table:
        return 0
    table_path = ROOT_OF_APP_DIR / "languages" / pack.headword_mapping_table
    words, chars = _load_mapping_table(table_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT headword, reading, data FROM entries").fetchall()
    added = 0
    batch: list[tuple[str, str, bytes]] = []
    simple_batch: list[tuple[str, str, str | None, bytes]] = []
    for row in rows:
        mapped = _map_headword(row["headword"], words, chars)
        if mapped == row["headword"]:
            continue
        if pack.output_schema == HEADWORD_READING_SCHEMA:
            batch.append((mapped, row["reading"], row["data"]))
        else:
            simple_batch.append((mapped, mapped.casefold(), row["pos"], row["data"]))
        added += 1
    if pack.output_schema == HEADWORD_READING_SCHEMA:
        conn.executemany("INSERT INTO entries (headword, reading, data) VALUES (?, ?, ?)", batch)
    else:
        conn.executemany(
            "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
            simple_batch,
        )
    conn.commit()
    conn.row_factory = None
    return added


def _write_database(
    tei_path: Path,
    release_version: str,
    source_url: str,
    license_spdx: str,
    build_date: str,
    pack: FreeDictPack,
) -> tuple[int, int]:
    pack.output_dir.mkdir(parents=True, exist_ok=True)
    if pack.database_path.exists():
        pack.database_path.unlink()

    _log(f"Building SQLite database at {pack.database_path}")
    conn = sqlite3.connect(pack.database_path)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    if pack.output_schema == HEADWORD_READING_SCHEMA:
        conn.executescript(
            """
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE entries (
                headword TEXT NOT NULL,
                reading TEXT NOT NULL DEFAULT '',
                data BLOB NOT NULL
            );
            CREATE INDEX idx_entries_headword ON entries(headword);
            CREATE INDEX idx_entries_reading ON entries(reading);
            """
        )
    else:
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
    simple_batch: list[tuple[str, str, str | None, bytes]] = []
    reading_batch: list[tuple[str, str, bytes]] = []
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
        entry_gender = _normalize(elem.findtext("./tei:gramGrp/tei:gen", default="", namespaces=NS)).lower()[:1]
        parsed_senses: list[ParsedSense] = []
        for sense in elem.findall("./tei:sense", NS):
            parsed_senses.extend(_parse_senses(sense, entry_pos, pack.resolved_tei_translation_language))

        if headwords and parsed_senses:
            for parsed_sense in parsed_senses:
                row_headwords = parsed_sense["glosses"] if pack.invert_dictionary else headwords
                definitions = headwords if pack.invert_dictionary else parsed_sense["glosses"]
                examples = [] if pack.invert_dictionary else parsed_sense["examples"]
                notes = [] if pack.invert_dictionary else parsed_sense["notes"]
                part_of_speech = parsed_sense["pos"] or entry_pos or None
                for headword in row_headwords:
                    if pack.output_schema == HEADWORD_READING_SCHEMA:
                        payload = {
                            "word": headword,
                            "reading": "",
                            "definitions": definitions,
                            "partOfSpeech": [part_of_speech] if part_of_speech else [],
                            "attributes": [],
                        }
                        reading_batch.append((headword, "", _compress_payload(payload)))
                    else:
                        payload = {
                            "glosses": definitions,
                            "examples": examples,
                            "pos": part_of_speech,
                            "notes": notes,
                        }
                        if pack.learning_language == "de" and entry_gender in {"m", "f", "n"}:
                            payload["gender"] = entry_gender
                        simple_batch.append((
                            headword,
                            headword.casefold(),
                            part_of_speech,
                            _compress_payload(payload),
                        ))
                    inserted_count += 1
        if len(simple_batch) >= 5000:
            conn.executemany(
                "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
                simple_batch,
            )
            conn.commit()
            simple_batch.clear()
            _log(f"Parsed entries: {entry_count} | Inserted rows: {inserted_count}")
        if len(reading_batch) >= 5000:
            conn.executemany(
                "INSERT INTO entries (headword, reading, data) VALUES (?, ?, ?)",
                reading_batch,
            )
            conn.commit()
            reading_batch.clear()
            _log(f"Parsed entries: {entry_count} | Inserted rows: {inserted_count}")

        elem.clear()

    if simple_batch:
        conn.executemany(
            "INSERT INTO entries (headword, headword_lower, pos, data) VALUES (?, ?, ?, ?)",
            simple_batch,
        )
    if reading_batch:
        conn.executemany(
            "INSERT INTO entries (headword, reading, data) VALUES (?, ?, ?)",
            reading_batch,
        )

    if pack.headword_mapping_table:
        added = _augment_headwords_with_mapping(pack, conn)
        _log(f"Mapped-script headword rows added: {added}")

    if pack.output_schema == HEADWORD_READING_SCHEMA:
        version_value = f"{SCHEMA_VERSION}:freedict-{pack.freedict_name}-{release_version}"
        conn.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            [
                ("version", version_value),
                ("source_url", source_url),
                ("build_date", build_date),
            ],
        )
    else:
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


def _write_metadata(
    release_version: str,
    source_url: str,
    license_spdx: str,
    build_date: str,
    pack: FreeDictPack,
) -> None:
    payload = {
        "version": release_version,
        "source_url": source_url,
        "license": license_spdx,
        "source_direction": pack.freedict_name,
        "inverted": pack.invert_dictionary,
        "output_schema": pack.output_schema,
        "target_language": pack.target_language,
        "built_at": build_date,
    }
    pack.metadata_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_readme(
    release_version: str,
    source_url: str,
    license_spdx: str,
    build_date: str,
    pack: FreeDictPack,
) -> None:
    readme = f"""# FreeDict {pack.freedict_name}

- Source URL: {source_url}
- Version: {release_version}
- License SPDX: {license_spdx}
- Build date: {build_date}
- Dictionary direction: {pack.learning_language} -> {pack.target_language}
- Output schema: {pack.output_schema}

This dictionary is derived from FreeDict (https://freedict.org/).{" The English-to-Spanish source entries are inverted into Spanish lookup rows with English glosses." if pack.invert_dictionary else ""}

The complete upstream license file is distributed next to this notice.
"""
    pack.readme_path.write_text(readme, encoding="utf-8")


def _database_is_valid(expected_version: str, pack: FreeDictPack) -> bool:
    if not pack.database_path.exists() or not pack.metadata_path.exists():
        return False
    try:
        with pack.metadata_path.open("r", encoding="utf-8") as handle:
            metadata = json.load(handle)
        if str(metadata.get("version")) != expected_version:
            return False
        conn = sqlite3.connect(pack.database_path)
        rows = dict(conn.execute("SELECT key, value FROM meta").fetchall())
        conn.close()
        if pack.output_schema == HEADWORD_READING_SCHEMA:
            return str(rows.get("version", "")).startswith(f"{SCHEMA_VERSION}:")
        return rows.get("schema_version") == SCHEMA_VERSION and rows.get("freedict_version") == expected_version
    except Exception:
        return False


def build_pack(pack: FreeDictPack, force: bool = False) -> None:
    entry, release = _select_release(pack)
    source_url = str(release["URL"])
    expected_version = str(release.get("software-version") or release.get("version") or entry.get("edition") or "")
    if not expected_version:
        raise RuntimeError(f"Could not resolve a version for the selected {pack.freedict_name} release")

    with tempfile.TemporaryDirectory(prefix=f"freedict-{pack.freedict_name}-") as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        frequency_count = 0
        if pack.build_frequency:
            frequency_source_path = temp_dir / f"{pack.frequency_code}_50k.txt"
            _download(pack.frequency_source_url, frequency_source_path)
            frequency_count = _write_frequency(frequency_source_path, pack)
            _log(f"Built {frequency_count} {pack.language_name} frequency rows")

        if not force and _database_is_valid(expected_version, pack):
            _log(f"Dictionary already built for version {expected_version}; skipping rebuild")
            return

        archive_path = temp_dir / Path(source_url).name
        _download(source_url, archive_path)
        tei_path, license_source = _extract_archive(archive_path, temp_dir)
        header_version, license_spdx = _read_header_metadata(tei_path, license_source)
        resolved_version = header_version or expected_version
        build_date = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        entry_count, inserted_count = _write_database(
            tei_path,
            resolved_version,
            source_url,
            license_spdx,
            build_date,
            pack,
        )
        shutil.copyfile(license_source, pack.license_path)
        _write_metadata(resolved_version, source_url, license_spdx, build_date, pack)
        _write_readme(resolved_version, source_url, license_spdx, build_date, pack)
        _log(
            f"Built FreeDict {pack.freedict_name} {resolved_version} | License {license_spdx} | "
            f"Parsed {entry_count} entries | Inserted {inserted_count} rows | "
            f"{pack.learning_language}->{pack.target_language} ({pack.output_schema})"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build FreeDict-derived bilingual dictionary packs.")
    parser.add_argument("--pack", choices=sorted(FREEDICT_PACKS), help="Pack id (<learning>-<target>).")
    parser.add_argument("--language", choices=sorted(LEGACY_LANGUAGE_PACKS), help="Legacy alias: build the language's English-target pack.")
    parser.add_argument("--all", action="store_true", help="Build every FreeDict pack.")
    parser.add_argument(
        "--headword-mapping-table",
        help="Languages/-relative MappingTable JSON used to add converted-script headword rows.",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if args.pack:
        packs = [FREEDICT_PACKS[args.pack]]
    elif args.language:
        packs = [FREEDICT_PACKS[LEGACY_LANGUAGE_PACKS[args.language]]]
    elif args.all:
        packs = [FREEDICT_PACKS[key] for key in sorted(FREEDICT_PACKS)]
    else:
        parser.error("one of --pack, --language, or --all is required")

    for pack in packs:
        if args.headword_mapping_table:
            pack = replace(pack, headword_mapping_table=args.headword_mapping_table)
        build_pack(pack, force=args.force)


if __name__ == "__main__":
    main()
