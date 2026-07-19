import json
import os
import re
import sqlite3
import zlib
from datetime import datetime, timezone
from pathlib import Path


ROOT_OF_APP_DIR = Path(os.environ.get(
    "MLEARN_ROOT_OF_APP",
    Path(__file__).resolve().parents[1] / "source" / "root-of-app",
))
SOURCE_DIR = ROOT_OF_APP_DIR / "dictionaries" / "jitendex-yomitan"
OUTPUT_DIR = ROOT_OF_APP_DIR / "dictionaries" / "ja" / "en"
DB_PATH = OUTPUT_DIR / "dictionary.db"
METADATA_PATH = OUTPUT_DIR / "metadata.json"
SCHEMA_VERSION = "1"


def _read_revision(path: Path) -> str:
    if not path.exists():
        return "missing"
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return str(payload.get("revision", "unknown"))
    except Exception:
        return "unknown"


def _expected_db_version() -> str:
    dict_revision = _read_revision(SOURCE_DIR / "index.json")
    meta_revision = _read_revision(SOURCE_DIR / "index_.json")
    return f"{SCHEMA_VERSION}:{dict_revision}:{meta_revision}:pitch-by-reading"


def _write_metadata() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source_index = {}
    index_path = SOURCE_DIR / "index.json"
    if index_path.exists():
        with index_path.open("r", encoding="utf-8") as handle:
            source_index = json.load(handle)

    metadata = {
        "schemaVersion": SCHEMA_VERSION,
        "source": "Jitendex",
        "sourceUrl": source_index.get("url", "https://jitendex.org"),
        "targetLanguage": "en",
        "license": "CC-BY-SA-4.0",
        "version": _expected_db_version(),
        "sourceRevision": source_index.get("revision", "unknown"),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "attribution": source_index.get(
            "attribution",
            "Jitendex by Stephen Kraus; includes JMdict data from EDRDG.",
        ),
    }
    METADATA_PATH.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _compress_entry(entry) -> bytes:
    data = json.dumps(entry, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return zlib.compress(data)


def _safe_index(path: Path) -> int:
    match = re.search(r"(\d+)$", path.stem)
    return int(match.group(1)) if match else 0


def _populate_entries(conn: sqlite3.Connection) -> None:
    term_files = sorted(SOURCE_DIR.glob("term_bank_*.json"), key=_safe_index)
    if not term_files:
        raise RuntimeError(f"No term_bank_*.json files found in {SOURCE_DIR}")

    conn.execute("BEGIN")
    try:
        for term_path in term_files:
            with term_path.open("r", encoding="utf-8") as handle:
                bucket = json.load(handle)
            batch = []
            for entry in bucket:
                if not entry:
                    continue
                headword = entry[0]
                reading = entry[1] if len(entry) > 1 else ""
                batch.append((headword, reading, sqlite3.Binary(_compress_entry(entry))))
            if batch:
                conn.executemany(
                    "INSERT INTO entries (headword, reading, data) VALUES (?, ?, ?)",
                    batch,
                )
    finally:
        conn.commit()


def _populate_pitch(conn: sqlite3.Connection) -> None:
    meta_files = sorted(SOURCE_DIR.glob("term_meta_bank_*.json"), key=_safe_index)
    if not meta_files:
        return

    conn.execute("BEGIN")
    try:
        for meta_path in meta_files:
            with meta_path.open("r", encoding="utf-8") as handle:
                bucket = json.load(handle)
            batch = []
            for entry in bucket:
                if not entry:
                    continue
                headword = entry[0]
                payload = entry[2] if len(entry) > 2 and isinstance(entry[2], dict) else {}
                reading = payload.get("reading")
                if not isinstance(reading, str) or not reading:
                    continue
                batch.append((headword, reading, sqlite3.Binary(_compress_entry(entry))))
            if batch:
                conn.executemany(
                    "INSERT OR REPLACE INTO pitch (headword, reading, data) VALUES (?, ?, ?)",
                    batch,
                )
    finally:
        conn.commit()


def build_dictionary() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = DB_PATH.with_suffix(".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    conn = sqlite3.connect(str(tmp_path))
    try:
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
        _populate_entries(conn)
        _populate_pitch(conn)
        conn.executescript(
            """
            CREATE INDEX idx_entries_headword ON entries(headword);
            CREATE INDEX idx_entries_reading ON entries(reading);
            """
        )
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)",
            (_expected_db_version(),),
        )
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('source', ?)",
            ("jitendex-yomitan",),
        )
        conn.commit()
        conn.execute("PRAGMA optimize")
    finally:
        conn.close()

    tmp_path.replace(DB_PATH)
    _write_metadata()
    print(f"Built Japanese dictionary: {DB_PATH}")


if __name__ == "__main__":
    build_dictionary()
