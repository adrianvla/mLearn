import atexit
import contextvars
import functools
import html
import json
import os
import re
import sqlite3
import threading
import unicodedata
import zlib
from pathlib import Path
from typing import Any

from logging_utils import get_logger

log = get_logger("generic-language")

DICTIONARY_TARGET_ENV = "MLEARN_DICTIONARY_TARGET_LANGUAGE"
DICTIONARY_TARGETS_ENV = "MLEARN_DICTIONARY_TARGET_LANGUAGES_JSON"
_dictionary_target_override = contextvars.ContextVar("mlearn_dictionary_target_override", default=None)
ENTRY_CACHE_SIZE = 4096
READING_CACHE_SIZE = 4096
PROSODY_CACHE_SIZE = 2048
LOOKUP_CANDIDATE_LIMIT = 64
ROUGH_UNSAFE_TOKENIZER_SCRIPTS = {"Han", "Hira", "Kana", "Bopo", "Thai", "Khmr", "Mymr"}
ROUGH_TOKENIZER_TYPES = {"unicode-word"}
_SUDACHI_TOKENIZER_LOCKS: dict[str, threading.Lock] = {}
_SUDACHI_TOKENIZER_LOCKS_GUARD = threading.Lock()
SCRIPT_ALIASES: dict[str, list[str]] = {
    "arab": ["Arab"],
    "armn": ["Armn"],
    "beng": ["Beng"],
    "bopo": ["Bopo"],
    "cyrl": ["Cyrl"],
    "deva": ["Deva"],
    "ethi": ["Ethi"],
    "geor": ["Geor"],
    "grek": ["Grek"],
    "guru": ["Guru"],
    "hang": ["Hang"],
    "han": ["Han"],
    "hans": ["Han"],
    "hant": ["Han"],
    "hebr": ["Hebr"],
    "hira": ["Hira"],
    "jpan": ["Hira", "Kana", "Han"],
    "kana": ["Kana"],
    "khmr": ["Khmr"],
    "knda": ["Knda"],
    "kore": ["Hang", "Han"],
    "latn": ["Latn"],
    "mlym": ["Mlym"],
    "mymr": ["Mymr"],
    "sinh": ["Sinh"],
    "syrc": ["Syrc"],
    "taml": ["Taml"],
    "telu": ["Telu"],
    "thaa": ["Thaa"],
    "thai": ["Thai"],
}
SCRIPT_RANGES: dict[str, tuple[tuple[int, int], ...]] = {
    "Arab": ((0x0600, 0x06FF), (0x0750, 0x077F), (0x08A0, 0x08FF), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)),
    "Armn": ((0x0530, 0x058F),),
    "Beng": ((0x0980, 0x09FF),),
    "Bopo": ((0x3100, 0x312F), (0x31A0, 0x31BF)),
    "Cyrl": ((0x0400, 0x04FF), (0x0500, 0x052F), (0x2DE0, 0x2DFF), (0xA640, 0xA69F)),
    "Deva": ((0x0900, 0x097F),),
    "Ethi": ((0x1200, 0x137F),),
    "Geor": ((0x10A0, 0x10FF), (0x2D00, 0x2D2F)),
    "Grek": ((0x0370, 0x03FF), (0x1F00, 0x1FFF)),
    "Guru": ((0x0A00, 0x0A7F),),
    "Hang": ((0x1100, 0x11FF), (0x3130, 0x318F), (0xAC00, 0xD7AF)),
    "Han": ((0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)),
    "Hebr": ((0x0590, 0x05FF), (0xFB1D, 0xFB4F)),
    "Hira": ((0x3040, 0x309F),),
    "Kana": ((0x30A0, 0x30FF), (0x31F0, 0x31FF)),
    "Khmr": ((0x1780, 0x17FF),),
    "Knda": ((0x0C80, 0x0CFF),),
    "Latn": ((0x0041, 0x005A), (0x0061, 0x007A), (0x00C0, 0x024F), (0x1E00, 0x1EFF)),
    "Mlym": ((0x0D00, 0x0D7F),),
    "Mymr": ((0x1000, 0x109F),),
    "Sinh": ((0x0D80, 0x0DFF),),
    "Syrc": ((0x0700, 0x074F), (0x0860, 0x086F)),
    "Taml": ((0x0B80, 0x0BFF),),
    "Telu": ((0x0C00, 0x0C7F),),
    "Thaa": ((0x0780, 0x07BF),),
    "Thai": ((0x0E00, 0x0E7F),),
}
LOOKUP_NORMALIZER_PRESETS: dict[str, list[Any]] = {
    "arabic-script": [
        "unicode-nfkc",
        "remove-tatweel",
        "remove-arabic-diacritics",
    ],
    "persian-arabic": [
        "unicode-nfkc",
        "remove-tatweel",
        "remove-arabic-diacritics",
        {
            "type": "replace-characters",
            "map": {
                "ك": "ک",
                "ي": "ی",
                "ى": "ی",
            },
        },
    ],
}
TEXT_NORMALIZER_NAMES = {
    "none",
    "kana-to-hiragana",
    "lowercase",
    "casefold",
    "strip-diacritics",
    "lowercase-strip-diacritics",
    "unicode-nfc",
    "unicode-nfd",
    "unicode-nfkc",
    "unicode-nfkd",
    "remove-arabic-diacritics",
    "remove-tatweel",
}


def _safe_target_language(value: str | None, fallback: str | None = None) -> str | None:
    raw = value or fallback
    if not raw:
        return None
    target = re.sub(r"[^a-zA-Z0-9_-]+", "", raw).lower()
    return target or fallback


def _safe_sql_identifier(value: Any, fallback: str) -> str:
    raw = str(value or fallback)
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", raw):
        raise RuntimeError(f"Invalid dictionary SQLite identifier: {raw!r}")
    return raw


def _safe_language_data_path(root: Path, relative_value: Any) -> Path | None:
    if not isinstance(relative_value, str) or not relative_value.strip():
        return None
    relative = relative_value.strip()
    if Path(relative).is_absolute():
        return None
    candidate = (root / relative).resolve()
    root_resolved = root.resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        return None
    return candidate


def _dictionary_target_for_language(language: str) -> str | None:
    override = _dictionary_target_override.get()
    if isinstance(override, dict):
        value = override.get(language)
        if isinstance(value, str) and value:
            return value
    elif isinstance(override, str) and override:
        return override

    raw = os.environ.get(DICTIONARY_TARGETS_ENV)
    if not raw:
        return None
    try:
        targets = json.loads(raw)
    except Exception as exc:
        log.warning("Failed to parse %s: %s", DICTIONARY_TARGETS_ENV, exc)
        return None
    if not isinstance(targets, dict):
        return None
    value = targets.get(language)
    return str(value) if isinstance(value, str) and value else None


class dictionary_target_language_override:
    def __init__(self, language: str | None, target_language: str | None):
        self.language = language
        self.target_language = _safe_target_language(target_language)
        self._token = None

    def __enter__(self):
        if self.language and self.target_language:
            self._token = _dictionary_target_override.set({self.language: self.target_language})
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._token is not None:
            _dictionary_target_override.reset(self._token)
        return False


def _deserialize_entry(blob: bytes):
    return json.loads(zlib.decompress(blob).decode("utf-8"))


def _string_at_path(value: Any, path: Any) -> str:
    if not isinstance(path, list) or not path:
        return ""
    if "*" in path:
        for candidate in _values_at_path(value, path):
            if isinstance(candidate, str) and candidate:
                return candidate
        return ""
    current = value
    for segment in path:
        if not isinstance(segment, str) or not segment or not isinstance(current, dict):
            return ""
        current = current.get(segment)
    return current if isinstance(current, str) else ""


def _first_string_field(value: Any, field: str) -> str:
    if isinstance(value, dict):
        candidate = value.get(field)
        if isinstance(candidate, str) and candidate:
            return candidate
        for child in value.values():
            found = _first_string_field(child, field)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _first_string_field(child, field)
            if found:
                return found
    return ""


def _string_list_at_path(value: Any, path: Any) -> list[str]:
    if not isinstance(path, list) or not path:
        return []
    if "*" in path:
        values: list[str] = []
        for candidate in _values_at_path(value, path):
            if isinstance(candidate, str) and candidate:
                values.append(candidate)
            elif isinstance(candidate, list):
                values.extend(str(item) for item in candidate if item is not None and str(item))
        return values
    current = value
    for segment in path:
        if not isinstance(segment, str) or not segment or not isinstance(current, dict):
            return []
        current = current.get(segment)
    if isinstance(current, str):
        return [current] if current else []
    if isinstance(current, list):
        return [str(item) for item in current if item is not None and str(item)]
    return []


def _values_at_path(value: Any, path: list[Any]) -> list[Any]:
    if not path:
        return [value]
    segment, *rest = path
    if segment == "*":
        if not isinstance(value, list):
            return []
        values: list[Any] = []
        for item in value:
            values.extend(_values_at_path(item, rest))
        return values
    if not isinstance(segment, str) or not segment or not isinstance(value, dict):
        return []
    return _values_at_path(value.get(segment), rest)


def _camel_to_kebab_case(name: str) -> str:
    return re.sub(r"([A-Z])", lambda match: "-" + match.group(1).lower(), name)


def _escape_quotes(value: str) -> str:
    return value.replace('"', "&quot;")


def _create_html_element(element):
    if isinstance(element, str):
        return element
    if not isinstance(element, dict):
        return html.escape(str(element))

    tag = element.get("tag", "div")
    content = element.get("content", "")

    attributes = []
    for key, value in element.items():
        if key in ("tag", "content"):
            continue
        if isinstance(value, dict) and key == "style":
            value = "; ".join([f"{_camel_to_kebab_case(k)}: {v}" for k, v in value.items()])
            attributes.append(f'style="{_escape_quotes(value)}"')
        elif isinstance(value, dict):
            for data_key, data_value in value.items():
                attributes.append(f'data-{data_key}="{_escape_quotes(str(data_value))}"')
        else:
            if key == "style" and isinstance(value, str):
                value = value.replace('"', "")
            attributes.append(f'{key}="{_escape_quotes(str(value))}"')

    if isinstance(content, list):
        content_html = "".join(_create_html_element(c) for c in content)
    else:
        content_html = _create_html_element(content)

    attrs = f" {' '.join(attributes)}" if attributes else ""
    return f"<{tag}{attrs}>{content_html}</{tag}>"


def _normalize_script_codes(scripts: list[str] | set[str] | tuple[str, ...] | None) -> list[str]:
    if not scripts:
        return []
    normalized: list[str] = []
    for script in scripts:
        raw_script = str(script).strip()
        if not raw_script:
            continue

        aliases = SCRIPT_ALIASES.get(raw_script.lower(), [])
        if aliases:
            for alias in aliases:
                if alias not in normalized:
                    normalized.append(alias)
            continue

        canonical = (
            f"{raw_script[0].upper()}{raw_script[1:].lower()}"
            if re.fullmatch(r"[A-Za-z]{4}", raw_script)
            else raw_script
        )
        if canonical not in normalized:
            normalized.append(canonical)
    return normalized


def _char_matches_script(
    char: str,
    script: str,
    script_ranges: dict[str, tuple[tuple[int, int], ...]] | None = None,
) -> bool:
    code_point = ord(char)
    ranges = [
        *(script_ranges or {}).get(script, ()),
        *SCRIPT_RANGES.get(script, ()),
    ]
    return any(start <= code_point <= end for start, end in ranges)


def _single_code_point_characters(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    result: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        chars = list(item)
        if len(chars) == 1:
            result.add(chars[0])
    return result


def _matches_any_script(
    text: str,
    scripts: list[str],
    extra_characters: set[str] | None = None,
    script_ranges: dict[str, tuple[tuple[int, int], ...]] | None = None,
) -> bool:
    normalized_scripts = _normalize_script_codes(scripts)
    saw_letter = False
    extras = extra_characters or set()
    for char in text:
        if char in extras:
            continue
        if not char.isalpha():
            continue
        saw_letter = True
        if not any(_char_matches_script(char, script, script_ranges) for script in normalized_scripts):
            return False
    return saw_letter


def _katakana_to_hiragana(text: str) -> str:
    result = []
    for ch in text:
        cp = ord(ch)
        if 0x30A1 <= cp <= 0x30F6:
            result.append(chr(cp - 0x60))
        else:
            result.append(ch)
    return "".join(result)


def _strip_diacritics(text: str) -> str:
    return unicodedata.normalize("NFC", "".join(
        char
        for char in unicodedata.normalize("NFD", text)
        if unicodedata.category(char) != "Mn"
    ))


def _remove_arabic_diacritics(text: str) -> str:
    return "".join(
        char
        for char in text
        if not (
            "\u0610" <= char <= "\u061a"
            or "\u064b" <= char <= "\u065f"
            or char == "\u0670"
            or "\u06d6" <= char <= "\u06ed"
        )
    )


def _remove_tatweel(text: str) -> str:
    return text.replace("\u0640", "")


def _package_normalizer_presets(metadata: dict[str, Any] | None) -> dict[str, list[Any]]:
    text_processing = metadata.get("textProcessing") if isinstance(metadata, dict) else None
    presets = text_processing.get("normalizerPresets") if isinstance(text_processing, dict) else None
    if not isinstance(presets, dict):
        return {}
    return {
        name: steps
        for name, steps in presets.items()
        if isinstance(name, str) and isinstance(steps, list)
    }


def _normalizer_preset_steps(name: str, metadata: dict[str, Any] | None) -> list[Any] | None:
    if name in LOOKUP_NORMALIZER_PRESETS:
        return LOOKUP_NORMALIZER_PRESETS[name]
    if name in TEXT_NORMALIZER_NAMES:
        return None
    return _package_normalizer_presets(metadata).get(name)


def _expand_normalizer_steps(normalizer: Any, metadata: dict[str, Any] | None = None, seen: set[str] | None = None) -> list[Any]:
    steps = normalizer if isinstance(normalizer, list) else ([] if not normalizer or normalizer == "none" else [normalizer])
    expanded: list[Any] = []
    seen = seen or set()
    for step in steps:
        if isinstance(step, str):
            preset = _normalizer_preset_steps(step, metadata)
            if preset is not None and step not in seen:
                expanded.extend(_expand_normalizer_steps(preset, metadata, {*seen, step}))
            else:
                expanded.append(step)
        elif isinstance(step, dict) and step.get("type") == "preset":
            name = step.get("name")
            preset = _normalizer_preset_steps(name, metadata) if isinstance(name, str) else None
            if preset is not None and name not in seen:
                expanded.extend(_expand_normalizer_steps(preset, metadata, {*seen, name}))
        else:
            expanded.append(step)
    return expanded


def _apply_text_normalizer(value: str, step: Any) -> str:
    if isinstance(step, str):
        if step == "none":
            return value
        if step == "kana-to-hiragana":
            return _katakana_to_hiragana(value)
        if step == "lowercase":
            return value.lower()
        if step == "casefold":
            return value.casefold()
        if step == "strip-diacritics":
            return _strip_diacritics(value)
        if step == "lowercase-strip-diacritics":
            return _strip_diacritics(value.lower())
        if step == "unicode-nfc":
            return unicodedata.normalize("NFC", value)
        if step == "unicode-nfd":
            return unicodedata.normalize("NFD", value)
        if step == "unicode-nfkc":
            return unicodedata.normalize("NFKC", value)
        if step == "unicode-nfkd":
            return unicodedata.normalize("NFKD", value)
        if step == "remove-arabic-diacritics":
            return _remove_arabic_diacritics(value)
        if step == "remove-tatweel":
            return _remove_tatweel(value)
        return value

    if isinstance(step, dict) and step.get("type") == "replace-characters":
        mapping = step.get("map")
        if not isinstance(mapping, dict):
            return value
        return "".join(str(mapping.get(char, char)) for char in value)

    if isinstance(step, dict) and step.get("type") in {"replace-prefix", "replace-suffix"}:
        from_value = step.get("from")
        if not isinstance(from_value, str) or not from_value:
            return value
        to_value = step.get("to")
        replacement = str(to_value) if to_value is not None else ""
        if step.get("type") == "replace-prefix":
            return replacement + value[len(from_value):] if value.startswith(from_value) else value
        return value[: -len(from_value)] + replacement if value.endswith(from_value) else value

    return value


def _normalize_token_reading(reading: str, normalizer: Any, metadata: dict[str, Any] | None = None) -> str:
    normalized = reading
    for step in _expand_normalizer_steps(normalizer, metadata):
        normalized = _apply_text_normalizer(normalized, step)
    return normalized


def _canonicalize_rough_tokenizer_type(tokenizer_type: Any) -> str | None:
    return tokenizer_type if tokenizer_type in ROUGH_TOKENIZER_TYPES else None


def _normalize_tokenizer_config(tokenizer_config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(tokenizer_config)
    normalized["type"] = _canonicalize_rough_tokenizer_type(normalized.get("type")) or normalized.get("type")
    normalized["fallback"] = _canonicalize_rough_tokenizer_type(normalized.get("fallback")) or normalized.get("fallback")
    return normalized


def _get_sudachi_tokenizer_lock(language: str, tokenizer_config: dict[str, Any]) -> threading.Lock:
    model = str(tokenizer_config.get("model") or os.environ.get("SUDACHI_DICT", "small"))
    key = f"{language}:{model}"
    with _SUDACHI_TOKENIZER_LOCKS_GUARD:
        lock = _SUDACHI_TOKENIZER_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _SUDACHI_TOKENIZER_LOCKS[key] = lock
        return lock


def _uses_rough_tokenizer_on_unsafe_scripts(
    tokenizer_config: dict[str, Any],
    normalized_scripts: set[str],
) -> bool:
    return (
        tokenizer_config.get("allowRoughSegmentationForSegmentlessScripts") is not True
        and bool(normalized_scripts)
        and normalized_scripts.issubset(ROUGH_UNSAFE_TOKENIZER_SCRIPTS)
    )


def _metadata_language_scripts(metadata: dict[str, Any] | None) -> list[str]:
    metadata = metadata or {}
    text_processing = metadata.get("textProcessing")
    script_profile = text_processing.get("scriptProfile") if isinstance(text_processing, dict) else None
    accepted_scripts = script_profile.get("acceptedScripts") if isinstance(script_profile, dict) else None
    scripts = accepted_scripts if isinstance(accepted_scripts, list) and accepted_scripts else []
    return _normalize_script_codes([str(script) for script in scripts]) if isinstance(scripts, list) else []


def _metadata_script_ranges(metadata: dict[str, Any] | None) -> dict[str, tuple[tuple[int, int], ...]]:
    metadata = metadata or {}
    text_processing = metadata.get("textProcessing")
    script_profile = text_processing.get("scriptProfile") if isinstance(text_processing, dict) else None
    configured_ranges = script_profile.get("scriptRanges") if isinstance(script_profile, dict) else None
    if not isinstance(configured_ranges, dict):
        return {}

    result: dict[str, tuple[tuple[int, int], ...]] = {}
    for script, ranges in configured_ranges.items():
        if not isinstance(script, str) or not isinstance(ranges, list):
            continue
        normalized_scripts = _normalize_script_codes([script])
        parsed_ranges: list[tuple[int, int]] = []
        for range_value in ranges:
            if not isinstance(range_value, list) or len(range_value) != 2:
                continue
            start, end = range_value
            if (
                not isinstance(start, int)
                or not isinstance(end, int)
                or start < 0
                or end > 0x10FFFF
                or start > end
            ):
                continue
            parsed_ranges.append((start, end))
        if parsed_ranges:
            for normalized_script in normalized_scripts:
                result[normalized_script] = tuple(parsed_ranges)
    return result


def _rough_tokenizer_classes(tokenizer_config: dict[str, Any]) -> set[str]:
    configured = tokenizer_config.get("tokenCharacterClasses")
    if not isinstance(configured, list):
        return {"letter", "number"}
    allowed = {"letter", "number", "mark"}
    return {str(item) for item in configured if str(item) in allowed}


def _rough_tokenizer_scripts(tokenizer_config: dict[str, Any], metadata: dict[str, Any] | None = None) -> list[str]:
    configured = tokenizer_config.get("tokenCharacterScripts")
    if isinstance(configured, list) and configured:
        return _normalize_script_codes([str(script) for script in configured if isinstance(script, str)])

    metadata = metadata or {}
    normalized = _metadata_language_scripts(metadata)
    if tokenizer_config.get("acceptsRomanizedInput") is True and normalized and "Latn" not in normalized:
        normalized.append("Latn")
    return normalized


def _rough_extra_token_characters(tokenizer_config: dict[str, Any]) -> set[str]:
    configured = tokenizer_config.get("extraTokenCharacters")
    if not isinstance(configured, list):
        return set()
    return {str(item) for item in configured if isinstance(item, str) and len(item) == 1}


def _rough_inner_token_characters(tokenizer_config: dict[str, Any]) -> set[str]:
    configured = tokenizer_config.get("innerTokenCharacters")
    if not isinstance(configured, list):
        return set()
    return {str(item) for item in configured if isinstance(item, str) and len(item) == 1}


def _is_rough_token_character(
    char: str,
    tokenizer_config: dict[str, Any],
    has_open_token: bool,
    token_scripts: list[str] | None = None,
    script_ranges: dict[str, tuple[tuple[int, int], ...]] | None = None,
) -> bool:
    if char in _rough_extra_token_characters(tokenizer_config):
        return True

    category = unicodedata.category(char)
    classes = _rough_tokenizer_classes(tokenizer_config)
    if category.startswith("L"):
        return "letter" in classes and (
            not token_scripts
            or any(_char_matches_script(char, script, script_ranges) for script in token_scripts)
        )
    if category.startswith("N"):
        return "number" in classes
    if category.startswith("M"):
        return has_open_token and "mark" in classes
    return False


def _is_rough_inner_token_character(
    char: str,
    next_char: str | None,
    tokenizer_config: dict[str, Any],
    has_open_token: bool,
    token_scripts: list[str] | None = None,
    script_ranges: dict[str, tuple[tuple[int, int], ...]] | None = None,
) -> bool:
    if not has_open_token or not next_char:
        return False
    if char not in _rough_inner_token_characters(tokenizer_config):
        return False
    return _is_rough_token_character(next_char, tokenizer_config, False, token_scripts, script_ranges)


class GenericLanguageModule:
    def __init__(self, language: str):
        self.language = language
        self.metadata: dict[str, Any] = {}
        self.language_data_dir: Path | None = None
        self._db_conn: sqlite3.Connection | None = None
        self._active_dictionary_path: Path | None = None
        self._db_lock = threading.RLock()
        self._atexit_registered = False
        self._dictionary_config: dict[str, Any] = {}
        self._dictionary_schema = ""
        self._dictionary_renderer = ""
        self._prosody_config: dict[str, Any] = {}
        self._spacy_nlp = None
        self._sudachi_tokenizer = None
        self._sudachi_mode = None
        self._tokenizer_lock = threading.Lock()

    def LOAD_MODULE(self, resource_folder, language_data_folder=None):
        self.language_data_dir = Path(language_data_folder) if language_data_folder else Path(resource_folder)
        metadata_path = self.language_data_dir / "languages" / f"{self.language}.json"
        if metadata_path.is_file():
            self.metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        else:
            self.metadata = {}

        runtime = self.metadata.get("runtime", {})
        nlp_config = runtime.get("nlp", {}) if isinstance(runtime, dict) else {}
        self._dictionary_config = nlp_config.get("dictionary", {}) if isinstance(nlp_config, dict) else {}
        self._dictionary_schema = str(self._dictionary_config.get("schema") or "")
        self._dictionary_renderer = str(self._dictionary_config.get("renderer") or "")
        self._prosody_config = self._dictionary_config.get("prosody", {}) if isinstance(self._dictionary_config.get("prosody"), dict) else {}
        self._initialize_dictionary()
        self._initialize_tokenizer()

    def LANGUAGE_TOKENIZE(self, text):
        tokenizer_config = self._tokenizer_config()
        tokenizer_type = str(tokenizer_config.get("type") or "none")
        if tokenizer_type == "none":
            raise RuntimeError(f"No tokenizer is configured for {self.language}")
        if tokenizer_type == "sudachi":
            return self._tokenize_sudachi(text)
        if tokenizer_type == "spacy":
            return self._tokenize_spacy(text)
        if tokenizer_type in ROUGH_TOKENIZER_TYPES:
            return self._tokenize_rough_unicode_word(text, tokenizer_config)
        raise RuntimeError(f"Unsupported tokenizer type for {self.language}: {tokenizer_type}")

    def LANGUAGE_TRANSLATE(self, word):
        if not self._dictionary_schema:
            return {"data": []}
        self._ensure_dictionary_connection()
        if not self._db_conn:
            return {"data": []}
        if self._dictionary_schema == "headword-reading-zlib-json":
            return self._translate_headword_reading(word)
        if self._dictionary_schema == "simple-headword-zlib-json":
            return self._translate_simple_headword(word)
        return {"data": []}

    def _tokenizer_config(self) -> dict[str, Any]:
        runtime = self.metadata.get("runtime", {})
        nlp_config = runtime.get("nlp", {}) if isinstance(runtime, dict) else {}
        tokenizer_config = nlp_config.get("tokenizer", {}) if isinstance(nlp_config, dict) else {}
        normalized_scripts = set(_metadata_language_scripts(self.metadata))
        if isinstance(tokenizer_config, dict) and tokenizer_config:
            tokenizer_type = tokenizer_config.get("type")
            if (
                tokenizer_type in ROUGH_TOKENIZER_TYPES
                and _uses_rough_tokenizer_on_unsafe_scripts(tokenizer_config, normalized_scripts)
            ):
                return {
                    "type": "none",
                    "required": True,
                    "fallback": "none",
                }
            normalized_config = _normalize_tokenizer_config(tokenizer_config)
            if (
                tokenizer_config.get("fallback") in ROUGH_TOKENIZER_TYPES
                and _uses_rough_tokenizer_on_unsafe_scripts(tokenizer_config, normalized_scripts)
            ):
                normalized_config["fallback"] = "none"
            return normalized_config

        if normalized_scripts.intersection(ROUGH_UNSAFE_TOKENIZER_SCRIPTS):
            return {
                "type": "none",
                "required": True,
                "fallback": "none",
            }

        return {
            "type": "none",
            "required": True,
            "fallback": "none",
        }

    def _tokenizer_allows_rough_fallback(self, tokenizer_config: dict[str, Any]) -> bool:
        if tokenizer_config.get("type") in ROUGH_TOKENIZER_TYPES:
            return True
        if tokenizer_config.get("required") is True:
            return False
        return tokenizer_config.get("fallback") in ROUGH_TOKENIZER_TYPES

    def _initialize_tokenizer(self) -> None:
        tokenizer_type = str(self._tokenizer_config().get("type") or "none")
        if tokenizer_type == "spacy":
            self._ensure_spacy()
        elif tokenizer_type == "sudachi":
            self._ensure_sudachi()
        elif tokenizer_type not in {"none", *ROUGH_TOKENIZER_TYPES}:
            raise RuntimeError(f"Unsupported tokenizer type for {self.language}: {tokenizer_type}")

    def _initialize_dictionary(self) -> None:
        self._ensure_dictionary_connection()

    def _ensure_dictionary_connection(self) -> None:
        if self._dictionary_config.get("type") != "sqlite-zlib-json":
            return
        db_path = self._resolve_dictionary_path()
        if db_path is None or not db_path.is_file():
            with self._db_lock:
                if self._db_conn is not None:
                    self._close_db()
            log.warning("Dictionary database for %s is not installed", self.language)
            return

        with self._db_lock:
            if self._db_conn is not None and self._active_dictionary_path == db_path:
                return

            db_uri = f"file:{db_path.as_posix()}?mode=ro"
            conn = sqlite3.connect(db_uri, uri=True, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only=1")
            conn.execute("PRAGMA temp_store=MEMORY")
            self._verify_db(conn, db_path)

            previous_conn = self._db_conn
            self._db_conn = conn
            self._active_dictionary_path = db_path
            self._entries_by_headword_cached.cache_clear()
            self._entries_by_reading_cached.cache_clear()
            self._prosody_entry_cached.cache_clear()
            if previous_conn is not None:
                try:
                    previous_conn.close()
                except Exception:
                    pass
            if not self._atexit_registered:
                atexit.register(self._close_db)
                self._atexit_registered = True

    def _resolve_dictionary_path(self) -> Path | None:
        if self.language_data_dir is None:
            return None
        requested_target = _dictionary_target_for_language(self.language) or os.environ.get(DICTIONARY_TARGET_ENV)
        has_requested_target = bool(requested_target)
        default_target = (
            str(self._dictionary_config["defaultTargetLanguage"])
            if self._dictionary_config.get("defaultTargetLanguage")
            else None
        )
        target = _safe_target_language(
            requested_target,
            None if has_requested_target else default_target,
        )
        candidates: list[Path] = []
        template = self._dictionary_config.get("targetPathTemplate")
        if isinstance(template, str) and template and target:
            relative = template.replace("{language}", self.language).replace("{target}", target)
            candidate = _safe_language_data_path(self.language_data_dir, relative)
            if candidate is not None:
                candidates.append(candidate)
                if has_requested_target:
                    return candidate
            else:
                log.warning("Ignoring unsafe dictionary path for %s: %s", self.language, relative)
                if has_requested_target:
                    return None
        elif isinstance(template, str) and template and has_requested_target:
            return None
        path_value = self._dictionary_config.get("path")
        candidate = _safe_language_data_path(self.language_data_dir, path_value)
        if candidate is not None:
            candidates.append(candidate)
        elif isinstance(path_value, str) and path_value:
            log.warning("Ignoring unsafe dictionary path for %s: %s", self.language, path_value)
        fallback = self._dictionary_config.get("fallbackPath")
        candidate = _safe_language_data_path(self.language_data_dir, fallback)
        if candidate is not None:
            candidates.append(candidate)
        elif isinstance(fallback, str) and fallback:
            log.warning("Ignoring unsafe dictionary path for %s: %s", self.language, fallback)

        for candidate in candidates:
            if candidate.is_file():
                return candidate
        return candidates[0] if candidates else None

    def _verify_db(self, conn: sqlite3.Connection, db_path: Path) -> None:
        expected_schema = self._dictionary_config.get("schemaVersion")
        if not expected_schema:
            return
        try:
            rows = dict(conn.execute("SELECT key, value FROM meta").fetchall())
        except sqlite3.DatabaseError as exc:
            raise RuntimeError(f"Dictionary database is invalid: {db_path}") from exc

        if self._dictionary_schema == "headword-reading-zlib-json":
            version = str(rows.get("version") or "")
            if not version.startswith(f"{expected_schema}:"):
                raise RuntimeError(f"Dictionary schema mismatch for {db_path}: {version!r}")
        else:
            version = str(rows.get("schema_version") or "")
            if version != str(expected_schema):
                raise RuntimeError(f"Dictionary schema mismatch for {db_path}: {version!r}")

    def _close_db(self) -> None:
        conn, self._db_conn = self._db_conn, None
        self._active_dictionary_path = None
        self._atexit_registered = False
        self._entries_by_headword_cached.cache_clear()
        self._entries_by_reading_cached.cache_clear()
        self._prosody_entry_cached.cache_clear()
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    def _require_db_conn(self) -> sqlite3.Connection:
        if self._db_conn is None:
            raise RuntimeError("Dictionary database is not loaded")
        return self._db_conn

    @functools.lru_cache(maxsize=ENTRY_CACHE_SIZE)
    def _entries_by_headword_cached(self, word: str):
        if not word:
            return []
        conn = self._require_db_conn()
        with self._db_lock:
            if self._dictionary_schema == "simple-headword-zlib-json":
                rows = conn.execute("SELECT headword, pos, data FROM entries WHERE headword = ? ORDER BY id", (word,)).fetchall()
            else:
                rows = conn.execute("SELECT data FROM entries WHERE headword = ?", (word,)).fetchall()
        return [self._row_payload(row) for row in rows]

    @functools.lru_cache(maxsize=READING_CACHE_SIZE)
    def _entries_by_reading_cached(self, reading: str):
        if not reading or self._dictionary_schema != "headword-reading-zlib-json":
            return []
        conn = self._require_db_conn()
        with self._db_lock:
            rows = conn.execute("SELECT data FROM entries WHERE reading = ?", (reading,)).fetchall()
        return [_deserialize_entry(row["data"]) for row in rows]

    @functools.lru_cache(maxsize=PROSODY_CACHE_SIZE)
    def _prosody_entry_cached(self, word: str, reading: str = ""):
        if not word or self._dictionary_schema != "headword-reading-zlib-json" or not self._prosody_config:
            return None
        table_value = self._prosody_config.get("table")
        if not isinstance(table_value, str) or not table_value.strip():
            raise RuntimeError("Dictionary prosody metadata must declare a SQLite table")
        table = _safe_sql_identifier(table_value, "")
        headword_column = _safe_sql_identifier(self._prosody_config.get("headwordColumn"), "headword")
        reading_column_value = self._prosody_config.get("readingColumn")
        data_column = _safe_sql_identifier(self._prosody_config.get("dataColumn"), "data")
        conn = self._require_db_conn()
        with self._db_lock:
            if isinstance(reading_column_value, str) and reading_column_value.strip():
                if not reading:
                    return None
                reading_column = _safe_sql_identifier(reading_column_value, "")
                row = conn.execute(
                    f"SELECT {data_column} FROM {table} WHERE {headword_column} = ? AND {reading_column} = ?",
                    (word, reading),
                ).fetchone()
            else:
                row = conn.execute(
                    f"SELECT {data_column} FROM {table} WHERE {headword_column} = ?",
                    (word,),
                ).fetchone()
        if not row:
            return None
        payload = _deserialize_entry(row[data_column])
        if not isinstance(reading_column_value, str) and reading:
            payload_reading = _string_at_path(payload, self._prosody_config.get("readingPath")) or _first_string_field(payload, "reading")
            if payload_reading and not self._readings_match_after_normalization(payload_reading, reading):
                return None
        return payload

    def _row_payload(self, row):
        if self._dictionary_schema == "simple-headword-zlib-json":
            return {
                "headword": row["headword"],
                "pos": row["pos"] or "",
                "payload": _deserialize_entry(row["data"]),
            }
        return _deserialize_entry(row["data"])

    def _lookup_simple_rows(self, word: str):
        rows = self._entries_by_headword_cached(word)
        if rows:
            return rows
        lowered = word.lower()
        conn = self._require_db_conn()
        with self._db_lock:
            db_rows = conn.execute(
                "SELECT headword, pos, data FROM entries WHERE headword_lower = ? ORDER BY headword, id",
                (lowered,),
            ).fetchall()
        return [self._row_payload(row) for row in db_rows]

    def _translate_simple_headword(self, word: str):
        rows = []
        for seed in self._lookup_seed_candidates(word):
            for candidate in self._lookup_candidates(seed):
                rows = self._lookup_simple_rows(candidate)
                if rows:
                    break
            if rows:
                break
        if not rows:
            return {"data": []}

        if self._dictionary_renderer != "simple-glosses":
            return {"data": [row.get("payload") for row in rows]}
        return self._render_simple_glosses(rows)

    def _render_simple_glosses(self, rows):
        headword = rows[0].get("headword") or ""
        reading = self._simple_reading_for_rows(rows) or headword
        pos = rows[0].get("pos") or ""
        senses = [row.get("payload") or {} for row in rows]
        first_gloss = ""
        for sense in senses:
            glosses = self._simple_glosses_for_sense(sense)
            if glosses:
                first_gloss = str(glosses[0])
                break
        short_definition = first_gloss if len(first_gloss) <= 120 else first_gloss[:119].rstrip() + "..."
        pos_html = f' <span class="pos">{html.escape(pos)}</span>' if pos else ""
        sense_items = []
        for sense in senses:
            glosses = "; ".join(html.escape(str(gloss)) for gloss in self._simple_glosses_for_sense(sense) if gloss)
            notes = "; ".join(html.escape(str(note)) for note in sense.get("notes") or [] if note)
            note_html = f'<div class="notes">{notes}</div>' if notes else ""
            sense_items.append(f"<li>{glosses}{note_html}</li>")
        full_html = f'<div class="dictionary-entry"><h3>{html.escape(headword)}{pos_html}</h3><ol class="senses">{"".join(sense_items)}</ol></div>'
        return {
            "data": [
                {"reading": reading, "definitions": short_definition},
                {"reading": reading, "definitions": full_html},
            ]
        }

    def _simple_reading_for_rows(self, rows) -> str:
        for row in rows:
            payload = row.get("payload") or {}
            if not isinstance(payload, dict):
                continue
            reading = _string_at_path(payload, self._dictionary_config.get("readingPath"))
            if reading:
                return reading
            value = payload.get("reading") or payload.get("pronunciation") or payload.get("transliteration")
            if value is not None and str(value):
                return str(value)
        return ""

    def _simple_glosses_for_sense(self, sense) -> list[str]:
        if not isinstance(sense, dict):
            return []
        configured = _string_list_at_path(sense, self._dictionary_config.get("definitionsPath"))
        if configured:
            return configured
        return self._structured_entry_string_list(sense.get("glosses"))

    def _lookup_seed_candidates(self, word: str) -> list[str]:
        candidates: list[str] = []

        def add(value: str) -> None:
            if value and value not in candidates:
                candidates.append(value)

        add(word)
        if self._dictionary_lookup_uses_tokenizer_lemma_seeds():
            for lemma in self._tokenizer_lemma_candidates(word):
                add(lemma)
        return candidates

    def _dictionary_lookup_seed_forms(self) -> list[str] | None:
        lookup = self._dictionary_config.get("lookup")
        seed_forms = lookup.get("seedForms") if isinstance(lookup, dict) else None
        if not isinstance(seed_forms, list):
            return None
        return [str(seed_form) for seed_form in seed_forms if isinstance(seed_form, str)]

    def _dictionary_lookup_uses_tokenizer_lemma_seeds(self) -> bool:
        seed_forms = self._dictionary_lookup_seed_forms()
        if seed_forms is not None:
            return "tokenizer-lemma" in seed_forms
        tokenizer_config = self._tokenizer_config()
        capabilities = tokenizer_config.get("capabilities")
        if isinstance(capabilities, list) and "lemmas" in capabilities:
            return True
        return tokenizer_config.get("type") in {"spacy", "sudachi"}

    def _tokenizer_lemma_candidates(self, word: str) -> list[str]:
        tokenizer_config = self._tokenizer_config()
        tokenizer_type = tokenizer_config.get("type")
        if tokenizer_type == "spacy":
            return [self._lemma_spacy(word)]
        if tokenizer_type == "sudachi":
            return self._lemma_sudachi(word)
        if tokenizer_type in ROUGH_TOKENIZER_TYPES:
            return [self._normalize_rough_lemma(word, tokenizer_config)]
        return []

    def _translate_headword_reading(self, word: str):
        matches = []
        matched_word = word
        for seed in self._lookup_seed_candidates(word):
            for candidate in self._lookup_candidates(seed):
                matches = list(self._entries_by_headword_cached(candidate))
                if matches:
                    matched_word = candidate
                    break
                if self._should_lookup_reading(candidate):
                    for reading_candidate in self._reading_lookup_candidates(candidate):
                        matches = list(self._entries_by_reading_cached(reading_candidate))
                        if matches:
                            matched_word = candidate
                            break
                    if matches:
                        break
                if matches:
                    break
            if matches:
                break
        if not matches:
            return {"data": []}
        best = sorted(matches, key=self._rank_headword_reading_entry)[0]
        reading = self._headword_reading_entry_reading(best)
        prosody_headword = self._headword_reading_entry_headword(best) or matched_word
        prosody = self._prosody_entry_cached(prosody_headword, reading) or {}

        if self._dictionary_renderer == "structured-glosses":
            return self._render_structured_headword_reading_entry(best, prosody, matched_word)

        if self._dictionary_renderer != "raw-entry":
            return {"data": [best, prosody, matches]}

        html_string = ""
        try:
            html_string = "".join(_create_html_element(element) for element in best[5])
        except Exception:
            html_string = html.escape(str(best))

        one_line = self._extract_gloss_line(html_string)
        reading = reading or word
        return {
            "data": [
                {"reading": reading, "definitions": one_line},
                {"reading": reading, "definitions": html_string},
                prosody,
            ]
        }

    def _render_structured_headword_reading_entry(self, entry, prosody, fallback_word: str):
        if not isinstance(entry, dict):
            return {"data": [entry, prosody, []]}

        reading = self._headword_reading_entry_reading(entry) or fallback_word
        word = str(entry.get("word") or entry.get("headword") or fallback_word)
        definitions = (
            _string_list_at_path(entry, self._dictionary_config.get("definitionsPath"))
            or self._structured_entry_string_list(
                entry.get("definitions")
                or entry.get("glosses")
                or entry.get("meanings")
                or entry.get("definition")
            )
        )
        notes = self._structured_entry_string_list(entry.get("notes"))
        pos_values = self._structured_entry_string_list(entry.get("partOfSpeech") or entry.get("pos"))
        tags = self._structured_entry_string_list(entry.get("tags"))

        short_definition = definitions[0] if definitions else ""
        if len(short_definition) > 120:
            short_definition = short_definition[:119].rstrip() + "..."

        pos_html = f' <span class="pos">{html.escape(", ".join(pos_values))}</span>' if pos_values else ""
        tag_html = f'<div class="tags">{html.escape(", ".join(tags))}</div>' if tags else ""
        note_html = f'<div class="notes">{"; ".join(html.escape(note) for note in notes)}</div>' if notes else ""
        sense_items = "".join(f"<li>{html.escape(definition)}</li>" for definition in definitions)
        if not sense_items:
            sense_items = "<li></li>"
        full_html = (
            f'<div class="dictionary-entry">'
            f'<h3>{html.escape(word)}{pos_html}</h3>'
            f'{tag_html}'
            f'<ol class="senses">{sense_items}</ol>'
            f'{note_html}'
            f'</div>'
        )
        return {
            "data": [
                {"reading": reading, "definitions": short_definition},
                {"reading": reading, "definitions": full_html},
                prosody,
            ]
        }

    def _structured_entry_string_list(self, value) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value else []
        if isinstance(value, list):
            return [str(item) for item in value if item is not None and str(item)]
        return [str(value)] if str(value) else []

    def _lookup_candidates(self, word: str) -> list[str]:
        if not word:
            return []

        candidates: list[str] = []

        def add(value: str) -> None:
            if value and value not in candidates:
                candidates.append(value)

        add(word)
        normalizers = self._lookup_normalizers()
        if self._lookup_normalizer_mode() == "branching":
            frontier = [word]
            for step in normalizers:
                next_frontier = list(frontier)
                for value in frontier:
                    normalized = self._apply_lookup_normalizer(value, step)
                    if normalized and normalized not in next_frontier:
                        next_frontier.append(normalized)
                    add(normalized)
                    if len(candidates) >= LOOKUP_CANDIDATE_LIMIT:
                        return candidates
                frontier = next_frontier[:LOOKUP_CANDIDATE_LIMIT]
        else:
            current = word
            for step in normalizers:
                current = self._apply_lookup_normalizer(current, step)
                add(current)
        return candidates

    def _lookup_normalizers(self) -> list[Any]:
        lookup = self._dictionary_config.get("lookup")
        if not isinstance(lookup, dict):
            return self._lexeme_surface_normalizers()
        normalizers = lookup.get("normalizers")
        if not isinstance(normalizers, list):
            return self._lexeme_surface_normalizers()

        return _expand_normalizer_steps(normalizers, self.metadata)

    def _lexeme_surface_normalizers(self) -> list[Any]:
        text_processing = self.metadata.get("textProcessing")
        lexeme_normalization = text_processing.get("lexemeNormalization") if isinstance(text_processing, dict) else None
        if not isinstance(lexeme_normalization, dict):
            return []
        normalizers = lexeme_normalization.get("surfaceNormalizers")
        return _expand_normalizer_steps(normalizers if isinstance(normalizers, list) else [], self.metadata)

    def _lookup_normalizer_mode(self) -> str:
        lookup = self._dictionary_config.get("lookup")
        mode = lookup.get("normalizerMode") if isinstance(lookup, dict) else None
        return "branching" if mode == "branching" else "pipeline"

    def _reading_extra_characters(self) -> set[str]:
        text_processing = self.metadata.get("textProcessing")
        lexeme_normalization = text_processing.get("lexemeNormalization") if isinstance(text_processing, dict) else None
        return _single_code_point_characters(
            lexeme_normalization.get("readingExtraCharacters") if isinstance(lexeme_normalization, dict) else None
        )

    def _lexeme_reading_normalizer(self) -> Any:
        text_processing = self.metadata.get("textProcessing")
        lexeme_normalization = text_processing.get("lexemeNormalization") if isinstance(text_processing, dict) else None
        if not isinstance(lexeme_normalization, dict):
            return None
        return lexeme_normalization.get("readingNormalizer")

    def _readings_match_after_normalization(self, left: str, right: str) -> bool:
        if not left or not right:
            return False
        if left == right:
            return True
        normalizer = self._lexeme_reading_normalizer()
        return (
            _normalize_token_reading(left, normalizer, self.metadata)
            == _normalize_token_reading(right, normalizer, self.metadata)
        )

    def _reading_lookup_candidates(self, reading: str) -> list[str]:
        candidates: list[str] = []

        def add(value: str) -> None:
            if value and value not in candidates:
                candidates.append(value)

        add(reading)
        add(_normalize_token_reading(reading, self._lexeme_reading_normalizer(), self.metadata))
        return candidates

    def _should_lookup_reading(self, word: str) -> bool:
        if self._dictionary_schema != "headword-reading-zlib-json":
            return False
        lookup = self._dictionary_config.get("lookup")
        mode = lookup.get("readingLookup") if isinstance(lookup, dict) else None
        if mode is True or mode == "always":
            return True
        if mode == "none" or mode is False:
            return False
        if isinstance(mode, dict):
            scripts = mode.get("scripts")
            if isinstance(scripts, list):
                normalized_scripts = _normalize_script_codes([str(script) for script in scripts if isinstance(script, str)])
                return _matches_any_script(word, normalized_scripts, self._reading_extra_characters(), _metadata_script_ranges(self.metadata))
            return False

        text_processing = self.metadata.get("textProcessing")
        lexeme_normalization = text_processing.get("lexemeNormalization") if isinstance(text_processing, dict) else None
        reading_scripts = lexeme_normalization.get("readingScripts") if isinstance(lexeme_normalization, dict) else None
        if isinstance(reading_scripts, list):
            normalized_reading_scripts = _normalize_script_codes([
                str(script) for script in reading_scripts if isinstance(script, str)
            ])
            if normalized_reading_scripts:
                return _matches_any_script(word, normalized_reading_scripts, self._reading_extra_characters(), _metadata_script_ranges(self.metadata))

        return False

    def _apply_lookup_normalizer(self, value: str, step: Any) -> str:
        return _apply_text_normalizer(value, step)

    def _reading_rank_rules(self) -> list[Any]:
        lookup = self._dictionary_config.get("lookup")
        if isinstance(lookup, dict) and isinstance(lookup.get("readingRank"), list):
            return lookup["readingRank"]
        return ["common", "score-desc", "short-reading"]

    def _rank_headword_reading_entry(self, entry) -> tuple[int, ...]:
        reading = self._headword_reading_entry_reading(entry)

        pref_common = 0 if self._headword_reading_entry_is_common(entry) else 1
        score_val = self._headword_reading_entry_score(entry)

        rank: list[int] = []
        for rule in self._reading_rank_rules():
            if rule == "common":
                rank.append(pref_common)
            elif rule == "score-desc":
                rank.append(-score_val)
            elif rule == "short-reading":
                rank.append(len(reading))
            elif rule == "long-reading":
                rank.append(-len(reading))
            elif isinstance(rule, dict) and rule.get("type") == "script":
                scripts = rule.get("scripts")
                normalized_scripts = _normalize_script_codes([str(script) for script in scripts]) if isinstance(scripts, list) else []
                rank.append(0 if _matches_any_script(reading, normalized_scripts, self._reading_extra_characters(), _metadata_script_ranges(self.metadata)) else 1)

        rank.append(len(reading))
        return tuple(rank)

    def _headword_reading_entry_reading(self, entry) -> str:
        if isinstance(entry, dict):
            configured = _string_at_path(entry, self._dictionary_config.get("readingPath"))
            if configured:
                return configured
            value = entry.get("reading") or entry.get("pronunciation") or entry.get("transliteration")
            return str(value) if value is not None else ""
        try:
            return str(entry[1]) if len(entry) > 1 and entry[1] is not None else ""
        except Exception:
            return ""

    def _headword_reading_entry_headword(self, entry) -> str:
        if isinstance(entry, dict):
            value = entry.get("word") or entry.get("headword") or entry.get("surface") or entry.get("expression")
            return str(value) if value is not None else ""
        try:
            return str(entry[0]) if len(entry) > 0 and entry[0] is not None else ""
        except Exception:
            return ""

    def _headword_reading_entry_is_common(self, entry) -> bool:
        if isinstance(entry, dict):
            tags = entry.get("tags")
            if isinstance(tags, list) and "common" in tags:
                return True
            return entry.get("common") is True
        try:
            return len(entry) > 7 and isinstance(entry[7], list) and "common" in entry[7]
        except Exception:
            return False

    def _headword_reading_entry_score(self, entry) -> int:
        raw = entry.get("score") if isinstance(entry, dict) else None
        if raw is None:
            try:
                raw = entry[4] if len(entry) > 4 else 0
            except Exception:
                raw = 0
        return int(raw) if isinstance(raw, (int, float)) else 0

    def _extract_gloss_line(self, html_string: str) -> str:
        glossary_pattern = re.compile(r'<ul[^>]*data-content="glossary"[^>]*>(.*?)</ul>', re.DOTALL)
        glossary_matches = glossary_pattern.findall(html_string)
        one_line = []
        for match in glossary_matches:
            li_pattern = re.compile(r"<li[^>]*>(.*?)</li>", re.DOTALL)
            for li in li_pattern.findall(match):
                one_line.append(re.sub(r"<[^>]+>", "", li))
        return ", ".join(one_line[:3])

    def _ensure_spacy(self):
        if self._spacy_nlp is not None:
            return self._spacy_nlp
        config = self._tokenizer_config()
        model = str(config.get("model") or "")
        if not model:
            return None
        try:
            import spacy
            self._spacy_nlp = spacy.load(model)
        except Exception:
            if config.get("autoDownload") is True:
                try:
                    import spacy
                    import spacy.cli
                    spacy.cli.download(model)
                    self._spacy_nlp = spacy.load(model)
                except Exception as exc:
                    log.warning("Failed to load spaCy model %s: %s", model, exc)
            else:
                log.warning("spaCy model %s is not available", model)
        return self._spacy_nlp

    def _ensure_sudachi(self):
        if self._sudachi_tokenizer is not None:
            return self._sudachi_tokenizer
        with self._tokenizer_lock:
            if self._sudachi_tokenizer is not None:
                return self._sudachi_tokenizer
            try:
                from sudachipy import dictionary as sudachi_dictionary
                from sudachipy import tokenizer
                preferred_dict = str(self._tokenizer_config().get("model") or os.environ.get("SUDACHI_DICT", "small"))
                try:
                    self._sudachi_tokenizer = sudachi_dictionary.Dictionary(dict_type=preferred_dict).create()
                except Exception:
                    self._sudachi_tokenizer = sudachi_dictionary.Dictionary().create()
                self._sudachi_mode = tokenizer.Tokenizer.SplitMode.C
            except Exception as exc:
                log.warning("Sudachi tokenizer is not available for %s: %s", self.language, exc)
        return self._sudachi_tokenizer

    def _tokenize_sudachi(self, text: str):
        tokenizer_config = self._tokenizer_config()
        tokenizer_obj = self._ensure_sudachi()
        if tokenizer_obj is None:
            return self._missing_tokenizer_fallback("sudachi", tokenizer_config, text)
        ignored_pos = set(tokenizer_config.get("ignoredPos") or [])
        reading_normalizer = tokenizer_config.get("outputReadingNormalizer") or "none"
        token_list = []
        sudachi_lock = _get_sudachi_tokenizer_lock(self.language, tokenizer_config)
        with sudachi_lock:
            for token in tokenizer_obj.tokenize(text, self._sudachi_mode):
                surface = token.surface()
                pos = token.part_of_speech()[0]
                actual_word = token.dictionary_form()
                reading = _normalize_token_reading(token.reading_form(), reading_normalizer, self.metadata)
                if actual_word == surface and not self._entries_by_headword_cached(actual_word):
                    actual_word = self._apply_lemma_fallback_rules(surface, pos, tokenizer_config)
                if surface and pos not in ignored_pos:
                    token_list.append({
                        "word": surface,
                        "actual_word": actual_word,
                        "type": pos,
                        "reading": reading,
                    })
        return token_list

    def _apply_lemma_fallback_rules(self, surface: str, pos: str, tokenizer_config: dict[str, Any]) -> str:
        rules = tokenizer_config.get("lemmaFallbackRules") or []
        if not isinstance(rules, list):
            return surface
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            rule_pos = rule.get("pos")
            if isinstance(rule_pos, str) and rule_pos and rule_pos != pos:
                continue
            suffix = rule.get("suffix")
            replacement = rule.get("replacement")
            if not isinstance(suffix, str) or not suffix:
                continue
            if not isinstance(replacement, str):
                continue
            if not surface.endswith(suffix):
                continue
            candidate = surface[: -len(suffix)] + replacement
            if rule.get("requireDictionaryMatch", True) and not self._entries_by_headword_cached(candidate):
                continue
            return candidate
        return surface

    def _tokenize_spacy(self, text: str):
        nlp = self._ensure_spacy()
        tokenizer_config = self._tokenizer_config()
        if nlp is None:
            return self._missing_tokenizer_fallback("spacy", tokenizer_config, text)
        ignored_pos = set(tokenizer_config.get("ignoredPos") or [])
        token_list = []
        for token in nlp(text):
            if token.is_space:
                continue
            surface = token.text.strip()
            if not surface:
                continue
            if token.pos_ in ignored_pos:
                continue
            result = {
                "word": surface,
                "type": token.pos_,
                "actual_word": token.lemma_.strip() or surface,
            }
            features = self._spacy_token_features(token)
            if features:
                result["features"] = features
            token_list.append(result)
        return token_list

    def _spacy_token_features(self, token) -> dict[str, Any]:
        try:
            morph = token.morph
        except Exception:
            return {}
        try:
            features = morph.to_dict()
        except Exception:
            return {}
        return {str(key): value for key, value in features.items() if key and value}

    def _lemma_spacy(self, word: str) -> str:
        nlp = self._ensure_spacy()
        if nlp is None:
            return ""
        processed = nlp(word)
        if not processed:
            return ""
        return processed[0].lemma_.strip() or processed[0].text.strip()

    def _lemma_sudachi(self, word: str) -> list[str]:
        tokenizer_config = self._tokenizer_config()
        tokenizer_obj = self._ensure_sudachi()
        if tokenizer_obj is None:
            return []
        candidates: list[str] = []

        def add(value: str) -> None:
            if value and value not in candidates:
                candidates.append(value)

        sudachi_lock = _get_sudachi_tokenizer_lock(self.language, tokenizer_config)
        with sudachi_lock:
            for token in tokenizer_obj.tokenize(word, self._sudachi_mode):
                add(token.dictionary_form())
        return candidates

    def _missing_tokenizer_fallback(self, tokenizer_type: str, tokenizer_config: dict[str, Any], text: str):
        if not self._tokenizer_allows_rough_fallback(tokenizer_config):
            message = f"Required {tokenizer_type} tokenizer is not available for {self.language}"
            raise RuntimeError(message)
        message = f"{tokenizer_type} tokenizer is not available for {self.language}"
        log.warning("%s; falling back to rough unicode-word tokenizer", message)
        return self._tokenize_rough_unicode_word(text, tokenizer_config)

    def _tokenize_rough_unicode_word(self, text: str, tokenizer_config: dict[str, Any]):
        tokens = []
        current = []
        chars = list(text)
        token_scripts = _rough_tokenizer_scripts(tokenizer_config, self.metadata)
        script_ranges = _metadata_script_ranges(self.metadata)
        for index, ch in enumerate(chars):
            if _is_rough_token_character(ch, tokenizer_config, bool(current), token_scripts, script_ranges):
                current.append(ch)
            elif _is_rough_inner_token_character(
                ch,
                chars[index + 1] if index + 1 < len(chars) else None,
                tokenizer_config,
                bool(current),
                token_scripts,
                script_ranges,
            ):
                current.append(ch)
            else:
                self._flush_rough_token(tokens, current, tokenizer_config)
        self._flush_rough_token(tokens, current, tokenizer_config)
        return tokens

    def _flush_rough_token(self, tokens: list[dict[str, str]], current: list[str], tokenizer_config: dict[str, Any]) -> None:
        if not current:
            return
        word = "".join(current)
        current.clear()
        actual_word = self._normalize_rough_lemma(word, tokenizer_config)
        tokens.append({"word": word, "actual_word": actual_word, "type": "WORD"})

    def _rough_lemma_normalizers(self, tokenizer_config: dict[str, Any]) -> list[Any]:
        normalizers = tokenizer_config.get("lemmaNormalizers")
        if isinstance(normalizers, list) and normalizers:
            return _expand_normalizer_steps(normalizers, self.metadata)
        inferred = self._lexeme_surface_normalizers()
        if tokenizer_config.get("lowercaseLemma") is True:
            return [*inferred, "lowercase"]
        return inferred

    def _normalize_rough_lemma(self, word: str, tokenizer_config: dict[str, Any]) -> str:
        actual_word = word
        for step in self._rough_lemma_normalizers(tokenizer_config):
            actual_word = self._apply_lookup_normalizer(actual_word, step)
        return actual_word
