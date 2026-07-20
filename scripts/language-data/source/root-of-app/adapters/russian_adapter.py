"""Downloaded Russian adapter that adds lexical stress to generic spaCy tokens."""

from __future__ import annotations

import gzip
import json
import re
import threading
import unicodedata
from pathlib import Path
from typing import Any

from generic_language import GenericLanguageModule
from silero_stress import load_accentor


_backend: GenericLanguageModule | None = None
_pronunciations: dict[str, str] = {}
_accentor: Any = None
_accentor_lock = threading.Lock()
_CYRILLIC_WORD_PATTERN = re.compile(r"[А-Яа-яЁё+]+(?:-[А-Яа-яЁё+]+)*")


def _language_code() -> str:
    prefix = "_mlearn_language_"
    module_name = __name__[len(prefix):] if __name__.startswith(prefix) else "ru"
    return module_name.replace("_", "-")


def _restore_initial_case(surface: str, reading: str) -> str:
    if surface[:1].isupper() and reading[:1].islower():
        return reading[:1].upper() + reading[1:]
    return reading


def _alignment_key(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.replace("+", "").casefold())
    without_stress = "".join(char for char in decomposed if char != "\u0301")
    return unicodedata.normalize("NFC", without_stress).replace("ё", "е")


def _combining_acute_reading(value: str) -> str:
    marked = re.sub(
        r"\+([АЕЁИОУЫЭЮЯаеёиоуыэюя])",
        lambda match: f"{match.group(1)}\u0301",
        value,
    )
    return unicodedata.normalize("NFC", marked.replace("+", ""))


def _get_accentor():
    global _accentor
    if _accentor is not None:
        return _accentor
    with _accentor_lock:
        if _accentor is None:
            _accentor = load_accentor()
    return _accentor


def _contextual_readings(text: str) -> list[tuple[str, str]]:
    stressed_text = str(_get_accentor()(text))
    return [
        (_alignment_key(match.group(0)), _combining_acute_reading(match.group(0)))
        for match in _CYRILLIC_WORD_PATTERN.finditer(stressed_text)
    ]


def LOAD_MODULE(resource_path: str, language_data_path: str | None = None) -> None:
    global _backend, _pronunciations, _accentor

    language = _language_code()
    data_root = Path(language_data_path or resource_path)
    _backend = GenericLanguageModule(language)
    _backend.LOAD_MODULE(resource_path, str(data_root))
    # Load before OCR can initialize Paddle in the same backend process. Loading
    # the packaged TorchScript accentor after Paddle can crash in native code.
    _accentor = load_accentor()

    adapter_config = _backend.metadata.get("runtime", {}).get("adapter", {}).get("config", {})
    relative_path = adapter_config.get("pronunciationPath", "languages/ru.pronunciation.json.gz")
    pronunciation_path = data_root / str(relative_path)
    with gzip.open(pronunciation_path, "rt", encoding="utf-8") as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise RuntimeError(f"Invalid Russian pronunciation map: {pronunciation_path}")
    _pronunciations = {
        str(surface).casefold(): str(reading)
        for surface, reading in loaded.items()
        if surface and reading
    }


def LANGUAGE_TOKENIZE(text: str) -> list[dict[str, Any]]:
    if _backend is None:
        raise RuntimeError("Russian adapter is not loaded")

    contextual = _contextual_readings(text)
    contextual_index = 0
    enriched: list[dict[str, Any]] = []
    for token in _backend.LANGUAGE_TOKENIZE(text):
        surface = str(token.get("word") or "")
        surface_key = _alignment_key(surface)
        reading = None
        if surface_key:
            for candidate_index in range(contextual_index, len(contextual)):
                candidate_key, candidate_reading = contextual[candidate_index]
                if candidate_key == surface_key:
                    reading = candidate_reading
                    contextual_index = candidate_index + 1
                    break
        if not reading:
            reading = _pronunciations.get(surface.casefold())
        if reading:
            enriched.append({**token, "reading": _restore_initial_case(surface, reading)})
        else:
            enriched.append(token)
    return enriched


def LANGUAGE_TRANSLATE(word: str):
    if _backend is None:
        raise RuntimeError("Russian adapter is not loaded")
    return _backend.LANGUAGE_TRANSLATE(word)
