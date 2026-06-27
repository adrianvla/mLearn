import atexit
import functools
import html
import json
import sqlite3
import threading
import zlib
from pathlib import Path

import spacy
import spacy.cli


DB_RELATIVE_PATH = Path("dictionaries") / "freedict-deu-eng" / "dictionary.db"
METADATA_RELATIVE_PATH = Path("dictionaries") / "freedict-deu-eng" / "metadata.json"
SCHEMA_VERSION = "1"
ENTRY_CACHE_SIZE = 4096

nlp = None
_DB_CONN = None
_DB_LOCK = threading.RLock()
_atexit_registered = False


def LOAD_MODULE(folder, language_data_folder=None):
    global nlp
    try:
        nlp = spacy.load("de_core_news_sm")
    except:
        spacy.cli.download("de_core_news_sm")
        nlp = spacy.load("de_core_news_sm")
    dictionary_root = Path(language_data_folder) if language_data_folder else Path(folder)
    _initialize_dictionary(dictionary_root)


def LANGUAGE_TOKENIZE(text):
    processed = nlp(text)
    tokens = []
    for token in processed:
        display_word = token.text_with_ws
        actual_word = token.lemma_.strip() or token.text.strip()
        tokens.append({"word": display_word, "type": token.pos_, "actual_word": actual_word})
    return tokens


def _metadata_path(base_dir: Path) -> Path:
    return base_dir / METADATA_RELATIVE_PATH


def _db_path(base_dir: Path) -> Path:
    return base_dir / DB_RELATIVE_PATH


def _expected_db_version(base_dir: Path) -> str:
    metadata_path = _metadata_path(base_dir)
    if not metadata_path.exists():
        raise RuntimeError(f"German dictionary metadata is missing: {metadata_path}")
    with metadata_path.open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    version = str(metadata.get("version") or "").strip()
    if not version:
        raise RuntimeError(f"German dictionary metadata is invalid: {metadata_path}")
    return version


def _deserialize_entry(blob):
    return json.loads(zlib.decompress(blob).decode("utf-8"))


def _close_db():
    global _DB_CONN, _atexit_registered
    conn, _DB_CONN = _DB_CONN, None
    _atexit_registered = False
    _lookup_rows_cached.cache_clear()
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def _initialize_dictionary(base_dir: Path) -> None:
    global _DB_CONN, _atexit_registered
    db_path = _db_path(base_dir)
    if not db_path.exists():
        raise RuntimeError(f"German dictionary database is missing: {db_path}")

    expected_version = _expected_db_version(base_dir)
    db_uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(db_uri, uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=1")

    try:
        rows = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    except sqlite3.DatabaseError as exc:
        conn.close()
        raise RuntimeError(f"German dictionary database is invalid: {db_path}") from exc

    schema_version = rows.get("schema_version")
    if schema_version != SCHEMA_VERSION:
        conn.close()
        raise RuntimeError(
            f"German dictionary schema mismatch: expected {SCHEMA_VERSION}, got {schema_version!r}"
        )

    freedict_version = rows.get("freedict_version")
    if freedict_version != expected_version:
        conn.close()
        raise RuntimeError(
            f"German dictionary version mismatch: expected {expected_version}, got {freedict_version!r}"
        )

    previous = _DB_CONN
    _DB_CONN = conn
    _lookup_rows_cached.cache_clear()

    if not _atexit_registered:
        atexit.register(_close_db)
        _atexit_registered = True

    if previous is not None and previous is not conn:
        try:
            previous.close()
        except Exception:
            pass


def _require_db_conn():
    if _DB_CONN is None:
        raise RuntimeError("German dictionary database is not loaded")
    return _DB_CONN


def _query_rows(word: str, use_lower: bool):
    if not word:
        return []
    conn = _require_db_conn()
    query = (
        "SELECT headword, pos, data FROM entries WHERE headword_lower = ? ORDER BY headword, id"
        if use_lower
        else "SELECT headword, pos, data FROM entries WHERE headword = ? ORDER BY id"
    )
    with _DB_LOCK:
        return conn.execute(query, (word,)).fetchall()


@functools.lru_cache(maxsize=ENTRY_CACHE_SIZE)
def _lookup_rows_cached(word: str, use_lower: bool):
    return [dict(row) for row in _query_rows(word, use_lower)]


def _lookup_dictionary_rows(word: str):
    rows = _lookup_rows_cached(word, False)
    if rows:
        return rows
    lowered = word.lower()
    if lowered != word:
        rows = _lookup_rows_cached(lowered, True)
        if rows:
            return rows
    return []


def _lemma_for_word(word: str):
    if not word:
        return ""
    processed = nlp(word)
    if not processed:
        return ""
    lemma = processed[0].lemma_.strip() or processed[0].text.strip()
    return lemma


def _truncate_short_definition(text: str, limit: int = 120) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _render_example(example):
    text = html.escape(example.get("text") or "")
    translations = "; ".join(html.escape(item) for item in example.get("translations") or [] if item)
    parts = []
    if text:
        parts.append(f'<div class="example-source">{text}</div>')
    if translations:
        parts.append(f'<div class="example-translation">{translations}</div>')
    return "".join(parts)


def _render_sense(payload):
    glosses = payload.get("glosses") or []
    examples = payload.get("examples") or []
    notes = payload.get("notes") or []
    gloss_html = "; ".join(f'<span class="gloss">{html.escape(gloss)}</span>' for gloss in glosses if gloss)
    notes_html = ""
    if notes:
        notes_html = f'<div class="notes">{"; ".join(html.escape(note) for note in notes if note)}</div>'
    examples_html = ""
    if examples:
        rendered = "".join(f'<li>{_render_example(example)}</li>' for example in examples)
        examples_html = f'<div class="examples"><ul>{rendered}</ul></div>'
    return f"<li>{gloss_html}{notes_html}{examples_html}</li>"


def _build_translation_response(rows):
    if not rows:
        return {"data": []}

    senses = []
    headword = rows[0]["headword"]
    pos = rows[0]["pos"] or ""
    for row in rows:
        payload = _deserialize_entry(row["data"])
        senses.append(payload)
        if not pos and payload.get("pos"):
            pos = payload.get("pos")

    first_gloss = ""
    for sense in senses:
        glosses = sense.get("glosses") or []
        if glosses:
            first_gloss = glosses[0]
            break

    short_definition = _truncate_short_definition(first_gloss)
    pos_html = f' <span class="pos">{html.escape(pos)}</span>' if pos else ""
    senses_html = "".join(_render_sense(sense) for sense in senses)
    full_html = f'<div class="de-entry"><h3>{html.escape(headword)}{pos_html}</h3><ol class="senses">{senses_html}</ol></div>'
    return {
        "data": [
            {"reading": headword, "definitions": short_definition},
            {"reading": headword, "definitions": full_html},
        ]
    }


def LANGUAGE_TRANSLATE(word):
    rows = _lookup_dictionary_rows(word)
    if not rows:
        lemma = _lemma_for_word(word)
        if lemma and lemma != word:
            rows = _lookup_dictionary_rows(lemma)
    return _build_translation_response(rows)
