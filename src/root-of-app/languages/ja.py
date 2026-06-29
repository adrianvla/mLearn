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


DICTIONARY_DIRNAME = "ja"
DB_FILENAME = "dictionary.db"
SCHEMA_VERSION = "1"
DEFAULT_DICTIONARY_TARGET_LANGUAGE = "en"
DICTIONARY_TARGET_ENV = "MLEARN_DICTIONARY_TARGET_LANGUAGE"
ENTRY_CACHE_SIZE = 4096
READING_CACHE_SIZE = 4096
PITCH_CACHE_SIZE = 2048

_DB_CONN: Optional[sqlite3.Connection] = None
_DB_LOCK = threading.RLock()
_tokenizer_lock = threading.Lock()
_tokenizer_use_lock = threading.Lock()
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


def _katakana_to_hiragana(text):
    """Convert katakana characters to hiragana."""
    result = []
    for ch in text:
        cp = ord(ch)
        if 0x30A1 <= cp <= 0x30F6:
            result.append(chr(cp - 0x60))
        elif ch == 'ー':
            result.append(ch)
        else:
            result.append(ch)
    return ''.join(result)


def LANGUAGE_TOKENIZE(text):
    tokenizer_inst = _ensure_tokenizer()
    token_list = []
    with _tokenizer_use_lock:
        tokens = list(tokenizer_inst.tokenize(text, mode))
    for token in tokens:
        surface = token.surface()
        pos = token.part_of_speech()[0]
        actual_word = token.dictionary_form()
        reading = _katakana_to_hiragana(token.reading_form())
        if actual_word == surface and pos == "動詞" and not _entries_by_headword_cached(actual_word):
            actual_word = _resolve_potential_form(surface, reading)
        if surface and pos != "空白":
            token_list.append({
                'word': surface,
                'actual_word': actual_word,
                'type': pos,
                'reading': reading,
            })
    for token in token_list:
        if token['word'] == 'じゃ' and token['type'] == '助動詞':
            token['type'] = '助詞'
        if token['word'] == 'なら' and token['type'] == '助動詞':
            token['type'] = '助詞'
        if token['word'] == 'ただ' and token['type'] == '名詞':
            token['type'] = '副詞'
    return token_list


def _dictionary_target_language() -> str:
    target = os.environ.get(DICTIONARY_TARGET_ENV, DEFAULT_DICTIONARY_TARGET_LANGUAGE)
    target = re.sub(r"[^a-zA-Z0-9_-]+", "", target).lower()
    return target or DEFAULT_DICTIONARY_TARGET_LANGUAGE


def _db_path(language_data_dir: Path) -> Path:
    target = _dictionary_target_language()
    target_path = language_data_dir / "dictionaries" / DICTIONARY_DIRNAME / target / DB_FILENAME
    if target_path.is_file():
        return target_path
    if target == DEFAULT_DICTIONARY_TARGET_LANGUAGE:
        return language_data_dir / "dictionaries" / DICTIONARY_DIRNAME / DB_FILENAME
    return target_path


def _deserialize_entry(blob: bytes):
    return json.loads(zlib.decompress(blob).decode('utf-8'))


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


def _initialize_dictionary(language_data_dir: Path) -> None:
    global _DB_CONN, _atexit_registered
    db_path = _db_path(language_data_dir)
    if not db_path.is_file():
        raise FileNotFoundError(
            f"Japanese dictionary database not found at {db_path}. "
            "Install Japanese language data before starting the backend."
        )

    db_uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(db_uri, uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=1")
    conn.execute("PRAGMA temp_store=MEMORY")

    row = conn.execute("SELECT value FROM meta WHERE key='version'").fetchone()
    if row is None or not str(row["value"]).startswith(f"{SCHEMA_VERSION}:"):
        conn.close()
        raise RuntimeError(f"Japanese dictionary database has an incompatible schema: {db_path}")

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


def load_dictionary(resource_folder, language_data_folder=None):
    language_data_dir = Path(language_data_folder) if language_data_folder else Path(resource_folder)
    _initialize_dictionary(language_data_dir)


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


def _rank_entry(e) -> Tuple[int, int, int, int, int]:
    try:
        reading = e[1] if len(e) > 1 and e[1] is not None else ''
    except Exception:
        reading = ''
    pref_hira = 0 if is_hiragana(reading) else 1
    pref_kana = 0 if is_kana(reading) else 1
    # Prefer entries tagged as 'common' (Yomitan term_tags at index 7)
    pref_common = 1
    try:
        if len(e) > 7 and isinstance(e[7], list) and 'common' in e[7]:
            pref_common = 0
    except Exception:
        pass
    score_val = 0
    try:
        raw = e[4] if len(e) > 4 else 0
        if isinstance(raw, (int, float)):
            score_val = int(raw)
    except Exception:
        pass
    # Prefer shorter readings as a final tiebreaker (common readings tend to be shorter)
    return (pref_hira, pref_kana, pref_common, -score_val, len(reading))


def _collect_by_headword(word: str) -> _List:
    return list(_entries_by_headword_cached(word))


def _collect_by_reading(kana: str) -> _List:
    return list(_entries_by_reading_cached(kana))


def _resolve_potential_form(surface: str, reading: str) -> str:
    """
    Map godan verb potential forms back to dictionary base forms.

    Some potential forms (e.g. 見せる, 読める) are themselves legitimate
    dictionary entries and are returned unchanged.  For forms that Sudachi
    fails to lemmatize (e.g. 治せる → 治す), we derive the base form and
    verify it exists in the headword cache before returning it.
    """
    # If the surface already exists in the dictionary, trust it.
    if _entries_by_headword_cached(surface):
        return surface

    # Godan potential-form suffix → base-form suffix mappings.
    # The potential form replaces the final u-row kana with the
    # corresponding e-row kana + る.  We reverse that here.
    _GODAN_POTENTIAL_MAP = {
        'ける': 'く',
        'げる': 'ぐ',
        'せる': 'す',
        'てる': 'つ',
        'ねる': 'ぬ',
        'べる': 'ぶ',
        'める': 'む',
        'れる': 'る',
        'える': 'う',
    }

    for pot_suffix, base_suffix in _GODAN_POTENTIAL_MAP.items():
        if surface.endswith(pot_suffix):
            candidate = surface[:-len(pot_suffix)] + base_suffix
            if _entries_by_headword_cached(candidate):
                return candidate
            break

    # No viable candidate found; return the original surface.
    return surface


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


def LOAD_MODULE(resource_folder, cache_folder=None):
    load_dictionary(resource_folder, cache_folder)


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
