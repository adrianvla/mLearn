import atexit
import functools
import json
import os
import re
import sqlite3
import threading
import zlib
from pathlib import Path
from typing import List, Tuple, Optional, List as _List

from sudachipy import tokenizer
from sudachipy import dictionary as sudachi_dictionary


DB_FILENAME = "dictionary_cache.sqlite3"
SCHEMA_VERSION = "1"
ENTRY_CACHE_SIZE = 4096
READING_CACHE_SIZE = 4096
PITCH_CACHE_SIZE = 2048

_DB_CONN: Optional[sqlite3.Connection] = None
_DB_LOCK = threading.RLock()
_tokenizer_lock = threading.Lock()
tokenizer_obj = None
mode = tokenizer.Tokenizer.SplitMode.C  # Use a coarser split mode
_atexit_registered = False

TranslationCache = {}


def camel_to_kebab_case(name):
    """Convert camelCase to kebab-case."""
    return re.sub(r'([A-Z])', lambda match: '-' + match.group(1).lower(), name)


def escape_quotes(value):
    """Escape double quotes in attribute values."""
    return value.replace('"', '&quot;')


def _ensure_tokenizer():
    global tokenizer_obj
    if tokenizer_obj is not None:
        return tokenizer_obj
    with _tokenizer_lock:
        if tokenizer_obj is None:
            preferred_dict = os.environ.get("SUDACHI_DICT", "small")
            try:
                tokenizer_obj = sudachi_dictionary.Dictionary(dict_type=preferred_dict).create()
            except Exception:
                tokenizer_obj = sudachi_dictionary.Dictionary().create()
    return tokenizer_obj


def LANGUAGE_TOKENIZE(text):
    tokenizer_inst = _ensure_tokenizer()
    token_list = []
    tokens = tokenizer_inst.tokenize(text, mode)
    for token in tokens:
        surface = token.surface()
        pos = token.part_of_speech()[0]
        actual_word = token.dictionary_form()
        if surface and pos != "空白":
            token_list.append({
                'word': surface,
                'actual_word': actual_word,
                'type': pos
            })
    for token in token_list:
        if token['word'] == 'じゃ' and token['type'] == '助動詞':
            token['type'] = '助詞'
        if token['word'] == 'なら' and token['type'] == '助動詞':
            token['type'] = '助詞'
        if token['word'] == 'ただ' and token['type'] == '名詞':
            token['type'] = '副詞'
    return token_list


def _db_path(folder: Path) -> Path:
    return folder / DB_FILENAME


def _read_revision(path: Path) -> str:
    if not path.exists():
        return "missing"
    try:
        with path.open('r', encoding='utf-8') as handle:
            payload = json.load(handle)
        return str(payload.get('revision', 'unknown'))
    except Exception:
        return "unknown"


def _expected_db_version(base_dir: Path) -> str:
    dictionaries_dir = base_dir / 'dictionaries' / 'jitendex-yomitan'
    dict_revision = _read_revision(dictionaries_dir / 'index.json')
    meta_revision = _read_revision(dictionaries_dir / 'index_.json')
    return f"{SCHEMA_VERSION}:{dict_revision}:{meta_revision}"


def _compress_entry(entry) -> bytes:
    data = json.dumps(entry, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return zlib.compress(data)


def _deserialize_entry(blob: bytes):
    return json.loads(zlib.decompress(blob).decode('utf-8'))


def _safe_index(path: Path) -> int:
    match = re.search(r'(\d+)$', path.stem)
    return int(match.group(1)) if match else 0


def _populate_entries(conn: sqlite3.Connection, dictionaries_dir: Path) -> None:
    term_files = sorted(dictionaries_dir.glob('term_bank_*.json'), key=_safe_index)
    if not term_files:
        return
    conn.execute("BEGIN")
    try:
        for term_path in term_files:
            with term_path.open('r', encoding='utf-8') as handle:
                bucket = json.load(handle)
            batch = []
            for entry in bucket:
                if not entry:
                    continue
                headword = entry[0]
                reading = entry[1] if len(entry) > 1 else ''
                batch.append((headword, reading, sqlite3.Binary(_compress_entry(entry))))
            if batch:
                conn.executemany(
                    "INSERT INTO entries (headword, reading, data) VALUES (?, ?, ?)",
                    batch
                )
            batch.clear()
            bucket.clear()
    finally:
        conn.commit()


def _populate_pitch(conn: sqlite3.Connection, dictionaries_dir: Path) -> None:
    meta_files = sorted(dictionaries_dir.glob('term_meta_bank_*.json'), key=_safe_index)
    if not meta_files:
        return
    conn.execute("BEGIN")
    try:
        for meta_path in meta_files:
            with meta_path.open('r', encoding='utf-8') as handle:
                bucket = json.load(handle)
            batch = []
            for entry in bucket:
                if not entry:
                    continue
                headword = entry[0]
                batch.append((headword, sqlite3.Binary(_compress_entry(entry))))
            if batch:
                conn.executemany(
                    "INSERT OR REPLACE INTO pitch (headword, data) VALUES (?, ?)",
                    batch
                )
            batch.clear()
            bucket.clear()
    finally:
        conn.commit()


def _rebuild_database(conn: sqlite3.Connection, base_dir: Path, expected_version: str) -> None:
    dictionaries_dir = base_dir / 'dictionaries' / 'jitendex-yomitan'
    conn.executescript(
        """
        DROP TABLE IF EXISTS entries;
        DROP TABLE IF EXISTS pitch;
        DROP TABLE IF EXISTS meta;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (
            headword TEXT NOT NULL,
            reading TEXT,
            data BLOB NOT NULL
        );
        CREATE TABLE pitch (
            headword TEXT PRIMARY KEY,
            data BLOB NOT NULL
        );
        """
    )
    _populate_entries(conn, dictionaries_dir)
    _populate_pitch(conn, dictionaries_dir)
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_entries_headword ON entries(headword);
        CREATE INDEX IF NOT EXISTS idx_entries_reading ON entries(reading);
        """
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)",
        (expected_version,)
    )
    conn.commit()


def _close_db():
    global _DB_CONN, _atexit_registered
    conn, _DB_CONN = _DB_CONN, None
    _atexit_registered = False
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def _clear_entry_caches():
    TranslationCache.clear()
    _entries_by_headword_cached.cache_clear()
    _entries_by_reading_cached.cache_clear()
    _pitch_entry_cached.cache_clear()


def _initialize_dictionary(base_dir: Path) -> None:
    global _DB_CONN, _atexit_registered
    base_dir.mkdir(parents=True, exist_ok=True)
    db_path = _db_path(base_dir)
    expected_version = _expected_db_version(base_dir)

    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")

    needs_rebuild = True
    try:
        row = conn.execute("SELECT value FROM meta WHERE key='version'").fetchone()
        needs_rebuild = row is None or row['value'] != expected_version
    except sqlite3.DatabaseError:
        needs_rebuild = True

    if needs_rebuild:
        _rebuild_database(conn, base_dir, expected_version)

    previous = _DB_CONN
    _DB_CONN = conn
    _clear_entry_caches()

    if not _atexit_registered:
        atexit.register(_close_db)
        _atexit_registered = True

    if previous is not None and previous is not conn:
        try:
            previous.close()
        except Exception:
            pass


def load_dictionary(folder):
    _initialize_dictionary(Path(folder))


def _require_db_conn() -> sqlite3.Connection:
    if _DB_CONN is None:
        raise RuntimeError("Dictionary database is not loaded")
    return _DB_CONN


@functools.lru_cache(maxsize=ENTRY_CACHE_SIZE)
def _entries_by_headword_cached(word: str) -> _List:
    if not word:
        return []
    conn = _require_db_conn()
    with _DB_LOCK:
        rows = conn.execute("SELECT data FROM entries WHERE headword = ?", (word,)).fetchall()
    return [_deserialize_entry(row['data']) for row in rows]


@functools.lru_cache(maxsize=READING_CACHE_SIZE)
def _entries_by_reading_cached(reading: str) -> _List:
    if not reading:
        return []
    conn = _require_db_conn()
    with _DB_LOCK:
        rows = conn.execute("SELECT data FROM entries WHERE reading = ?", (reading,)).fetchall()
    return [_deserialize_entry(row['data']) for row in rows]


@functools.lru_cache(maxsize=PITCH_CACHE_SIZE)
def _pitch_entry_cached(word: str):
    if not word:
        return None
    conn = _require_db_conn()
    with _DB_LOCK:
        row = conn.execute("SELECT data FROM pitch WHERE headword = ?", (word,)).fetchone()
    if row is None:
        return None
    return _deserialize_entry(row['data'])


def is_hiragana(s: str) -> bool:
    return bool(s) and all('\u3040' <= ch <= '\u309F' for ch in s)


def is_katakana(s: str) -> bool:
    return bool(s) and all('\u30A0' <= ch <= '\u30FF' for ch in s)


def is_kana(s: str) -> bool:
    return bool(s) and all((
        ('\u3040' <= ch <= '\u309F') or ('\u30A0' <= ch <= '\u30FF') or ch == 'ー'
    ) for ch in s)


def _rank_entry(e) -> Tuple[int, int, int]:
    try:
        reading = e[1] if len(e) > 1 else ''
    except Exception:
        reading = ''
    pref_hira = 0 if is_hiragana(reading) else 1
    pref_kana = 0 if is_kana(reading) else 1
    score_val = 0
    try:
        raw = e[4] if len(e) > 4 else 0
        if isinstance(raw, (int, float)):
            score_val = int(raw)
    except Exception:
        pass
    return (pref_hira, pref_kana, -score_val)


def _collect_by_headword(word: str) -> _List:
    return list(_entries_by_headword_cached(word))


def _collect_by_reading(kana: str) -> _List:
    return list(_entries_by_reading_cached(kana))


def binary_search(word):
    pitch_accent_entry = _pitch_entry_cached(word)
    matches = _collect_by_headword(word)
    if not matches and is_kana(word):
        matches = _collect_by_reading(word)
    if not matches:
        return None
    best = sorted(matches, key=_rank_entry)[0]
    return best, pitch_accent_entry, matches


def create_html_element(element):
    if isinstance(element, str):
        return element

    tag = element.get('tag', 'div')
    content = element.get('content', '')

    attributes = []
    for key, value in element.items():
        if key in ('tag', 'content'):
            continue
        if isinstance(value, dict) and key == 'style':
            value = '; '.join([f"{camel_to_kebab_case(k)}: {v}" for k, v in value.items()])
            attributes.append(f'style="{escape_quotes(value)}"')
        elif isinstance(value, dict):
            for data_key, data_value in value.items():
                attributes.append(f'data-{data_key}="{escape_quotes(str(data_value))}"')
        else:
            if key == 'style' and isinstance(value, str):
                value = value.replace('"', '')
            attributes.append(f'{key}="{escape_quotes(str(value))}"')

    if isinstance(content, list):
        content_html = ''.join(create_html_element(c) for c in content)
    else:
        content_html = create_html_element(content)

    attrs = f" {' '.join(attributes)}" if attributes else ''
    return f"<{tag}{attrs}>{content_html}</{tag}>"


def LOAD_MODULE(folder):
    load_dictionary(folder)


def LANGUAGE_TRANSLATE(word):
    global TranslationCache
    if word in TranslationCache:
        return TranslationCache[word]

    search_result = binary_search(word)
    if search_result is None:
        TranslationCache[word] = {"data": []}
        return {"data": []}

    result, pitch_accent_entry, matches = search_result
    if pitch_accent_entry is None:
        pitch_accent_entry = {}
    if result is None:
        TranslationCache[word] = {"data": []}
        return {"data": []}

    html_string = ''.join(create_html_element(element) for element in result[5])

    glossary_pattern = re.compile(r'<ul[^>]*data-content="glossary"[^>]*>(.*?)</ul>', re.DOTALL)
    glossary_matches = glossary_pattern.findall(html_string)

    one_line = []
    for match in glossary_matches:
        li_pattern = re.compile(r'<li[^>]*>(.*?)</li>', re.DOTALL)
        li_matches = li_pattern.findall(match)
        for li in li_matches:
            one_line.append(re.sub(r'<[^>]+>', '', li))
    one_line = ', '.join(one_line[:3])

    data = {
        'data': [
            {'reading': result[1], 'definitions': one_line},
            {'reading': result[1], 'definitions': html_string},
            pitch_accent_entry
        ]
    }
    TranslationCache[word] = {"data": data['data']}
    return {"data": data['data']}
