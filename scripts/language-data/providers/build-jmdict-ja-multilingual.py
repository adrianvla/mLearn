#!/usr/bin/env python3

import argparse
import gzip
import json
import os
import re
import shutil
import sqlite3
import ssl
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_JMDICT_URL = "http://ftp.edrdg.org/pub/Nihongo/JMdict.gz"
ROOT_OF_APP_DIR = Path(os.environ.get(
    "MLEARN_ROOT_OF_APP",
    Path(__file__).resolve().parents[1] / "source" / "root-of-app",
))
JITENDEX_SOURCE_DIR = ROOT_OF_APP_DIR / "dictionaries" / "jitendex-yomitan"
SCHEMA_VERSION = "1"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
TARGETS = {
    "fr": {"langs": {"fre", "fr"}, "name": "French"},
    "de": {"langs": {"ger", "de"}, "name": "German"},
}


def _log(message: str) -> None:
    print(message, flush=True)


def _ssl_context():
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        _log("Warning: falling back to an unverified SSL context for JMdict download")
        return ssl._create_unverified_context()


def _download(url: str, destination: Path) -> None:
    _log(f"Downloading {url}")
    with urllib.request.urlopen(url, context=_ssl_context()) as response, destination.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    _log(f"Downloaded to {destination}")


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


def _safe_index_key(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _compress_entry(entry) -> bytes:
    data = json.dumps(entry, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return zlib.compress(data)


def _safe_index(path: Path) -> int:
    match = re.search(r"(\d+)$", path.stem)
    return int(match.group(1)) if match else 0


def _text_of(child: ET.Element | None) -> str:
    if child is None:
        return ""
    return _normalize("".join(child.itertext()))


def _entry_forms(entry: ET.Element) -> tuple[list[str], list[str]]:
    kebs = [_text_of(keb) for keb in entry.findall("./k_ele/keb")]
    rebs = [_text_of(reb) for reb in entry.findall("./r_ele/reb")]
    return _unique(kebs), _unique(rebs)


def _sense_glosses(entry: ET.Element, target_langs: set[str]) -> list[list[str]]:
    senses: list[list[str]] = []
    for sense in entry.findall("./sense"):
        glosses = []
        for gloss in sense.findall("./gloss"):
            lang = gloss.attrib.get(XML_LANG, "eng")
            if lang in target_langs:
                glosses.append(_text_of(gloss))
        glosses = _unique(glosses)
        if glosses:
            senses.append(glosses)
    return senses


def _structured_content(gloss_senses: list[list[str]], ent_seq: str, target_language: str) -> list[dict]:
    sense_items = []
    for index, glosses in enumerate(gloss_senses, start=1):
        sense_items.append({
            "tag": "li",
            "style": {"listStyleType": f'"{index}"', "paddingLeft": "0.25em"},
            "data": {"sense-number": str(index)},
            "content": [{
                "tag": "ul",
                "data": {"content": "glossary"},
                "content": [{"tag": "li", "content": gloss} for gloss in glosses],
            }],
        })

    return [{
        "type": "structured-content",
        "content": [{
            "tag": "div",
            "content": [
                {
                    "tag": "ol",
                    "content": sense_items,
                },
                {
                    "tag": "div",
                    "style": {"fontSize": "0.7em", "textAlign": "right"},
                    "data": {"content": "attribution"},
                    "content": {
                        "tag": "a",
                        "href": f"https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&q={ent_seq}",
                        "content": f"JMdict {target_language}",
                    },
                },
            ],
        }],
    }]


def _entries_for_target(entry: ET.Element, target_language: str, target_langs: set[str]):
    ent_seq = _text_of(entry.find("./ent_seq"))
    gloss_senses = _sense_glosses(entry, target_langs)
    if not ent_seq or not gloss_senses:
        return []

    kebs, rebs = _entry_forms(entry)
    headwords = kebs or rebs
    readings = rebs or headwords
    structured = _structured_content(gloss_senses, ent_seq, target_language)
    entries = []
    for headword in headwords:
        for reading in readings:
            entries.append((
                headword,
                reading,
                [headword, reading, "", "", 0, structured, int(ent_seq), ""],
            ))
    return entries


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (
            headword TEXT NOT NULL,
            reading TEXT,
            data BLOB NOT NULL
        );
        CREATE TABLE pitch (
            headword TEXT NOT NULL,
            reading TEXT NOT NULL,
            data BLOB NOT NULL,
            PRIMARY KEY (headword, reading)
        );
        """
    )


def _populate_pitch(conn: sqlite3.Connection) -> int:
    meta_files = sorted(JITENDEX_SOURCE_DIR.glob("term_meta_bank_*.json"), key=_safe_index)
    if not meta_files:
        return 0

    count = 0
    for meta_path in meta_files:
        with meta_path.open("r", encoding="utf-8") as handle:
            bucket = json.load(handle)
        batch = []
        for entry in bucket:
            if not entry:
                continue
            payload = entry[2] if len(entry) > 2 and isinstance(entry[2], dict) else {}
            reading = payload.get("reading")
            if not isinstance(reading, str) or not reading:
                continue
            batch.append((entry[0], reading, sqlite3.Binary(_compress_entry(entry))))
        if batch:
            conn.executemany(
                "INSERT OR REPLACE INTO pitch (headword, reading, data) VALUES (?, ?, ?)",
                batch,
            )
            count += len(batch)
    return count


def _finalize_schema(conn: sqlite3.Connection, version: str, source: str) -> None:
    conn.executescript(
        """
        CREATE INDEX idx_entries_headword ON entries(headword);
        CREATE INDEX idx_entries_reading ON entries(reading);
        """
    )
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)", (version,))
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('source', ?)", (source,))
    conn.commit()
    conn.execute("PRAGMA optimize")


def _write_metadata(output_dir: Path, target_language: str, version: str, entry_count: int, source_url: str) -> None:
    metadata = {
        "schemaVersion": SCHEMA_VERSION,
        "source": "JMdict",
        "sourceUrl": source_url,
        "targetLanguage": target_language,
        "license": "CC-BY-SA-4.0",
        "version": version,
        "entryCount": entry_count,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "attribution": "This package uses JMdict data from the Electronic Dictionary Research and Development Group.",
    }
    (output_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _open_jmdict_xml(source: Path):
    if source.suffix == ".gz":
        return gzip.open(source, "rb")
    return source.open("rb")


def build_dictionaries(source: Path, targets: list[str], source_url: str) -> dict[str, int]:
    requested = {target: TARGETS[target] for target in targets}
    output_dirs = {
        target: ROOT_OF_APP_DIR / "dictionaries" / "ja" / target
        for target in requested
    }
    db_paths = {target: output_dirs[target] / "dictionary.db" for target in requested}
    tmp_paths = {target: output_dirs[target] / "dictionary.tmp" for target in requested}
    conns: dict[str, sqlite3.Connection] = {}
    counts = {target: 0 for target in requested}

    for target, output_dir in output_dirs.items():
        output_dir.mkdir(parents=True, exist_ok=True)
        if tmp_paths[target].exists():
            tmp_paths[target].unlink()
        conns[target] = sqlite3.connect(str(tmp_paths[target]))
        _create_schema(conns[target])

    try:
        with _open_jmdict_xml(source) as handle:
            context = ET.iterparse(handle, events=("end",))
            for _event, elem in context:
                if elem.tag != "entry":
                    continue
                for target, info in requested.items():
                    batch = [
                        (headword, reading, sqlite3.Binary(_compress_entry(data)))
                        for headword, reading, data in _entries_for_target(elem, target, info["langs"])
                    ]
                    if batch:
                        conns[target].executemany(
                            "INSERT INTO entries (headword, reading, data) VALUES (?, ?, ?)",
                            batch,
                        )
                        counts[target] += len(batch)
                elem.clear()
    finally:
        for conn in conns.values():
            conn.commit()

    for target, conn in conns.items():
        pitch_count = _populate_pitch(conn)
        version = f"{SCHEMA_VERSION}:jmdict:{target}:{datetime.now(timezone.utc).date().isoformat()}:pitch-by-reading"
        try:
            _finalize_schema(conn, version, "jmdict")
        finally:
            conn.close()
        tmp_paths[target].replace(db_paths[target])
        _write_metadata(output_dirs[target], target, version, counts[target], source_url)
        _log(
            f"Built Japanese->{target} JMdict dictionary: {db_paths[target]} "
            f"({counts[target]} entries, {pitch_count} pitch rows)"
        )

    return counts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Japanese multilingual SQLite dictionaries from JMdict.")
    parser.add_argument("--source", type=Path, help="Path to JMdict XML or JMdict.gz. Downloads JMdict when omitted.")
    parser.add_argument("--url", default=DEFAULT_JMDICT_URL, help="JMdict download URL used when --source is omitted.")
    parser.add_argument("--targets", nargs="+", choices=sorted(TARGETS), default=["fr", "de"])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.source:
        source = args.source
        build_dictionaries(source, args.targets, args.url)
        return

    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "JMdict.gz"
        _download(args.url, source)
        build_dictionaries(source, args.targets, args.url)


if __name__ == "__main__":
    main()
