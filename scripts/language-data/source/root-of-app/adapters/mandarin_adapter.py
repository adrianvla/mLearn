"""Downloaded Mandarin adapter that adds tone-marked pinyin to spaCy tokens."""

from __future__ import annotations

from typing import Any

from generic_language import GenericLanguageModule
from pypinyin import Style, lazy_pinyin


_backend: GenericLanguageModule | None = None
_pinyin_input_converter: Any = None


def _language_code() -> str:
    prefix = "_mlearn_language_"
    module_name = __name__[len(prefix):] if __name__.startswith(prefix) else "zh-Hans"
    return module_name.replace("_", "-")


def _contains_han(text: str) -> bool:
    return any("\u3400" <= char <= "\u9fff" or "\uf900" <= char <= "\ufaff" for char in text)


def _tone_marked_pinyin(text: str) -> str:
    pronunciation_input = _pinyin_input_converter.convert(text) if _pinyin_input_converter else text
    syllables = lazy_pinyin(
        pronunciation_input,
        style=Style.TONE,
        neutral_tone_with_five=False,
        errors="default",
    )
    return " ".join(part for part in syllables if part).strip()


def LOAD_MODULE(resource_path: str, language_data_path: str | None = None) -> None:
    global _backend, _pinyin_input_converter

    language = _language_code()
    _backend = GenericLanguageModule(language)
    _backend.LOAD_MODULE(resource_path, language_data_path)
    adapter_config = _backend.metadata.get("runtime", {}).get("adapter", {}).get("config", {})
    conversion = adapter_config.get("pinyinInputConversion")
    _pinyin_input_converter = None
    if conversion:
        from opencc import OpenCC
        _pinyin_input_converter = OpenCC(str(conversion))


def LANGUAGE_TOKENIZE(text: str) -> list[dict[str, Any]]:
    if _backend is None:
        raise RuntimeError("Mandarin adapter is not loaded")

    enriched: list[dict[str, Any]] = []
    for token in _backend.LANGUAGE_TOKENIZE(text):
        surface = str(token.get("word") or "")
        if _contains_han(surface):
            reading = _tone_marked_pinyin(surface)
            enriched.append({**token, "reading": reading})
        else:
            enriched.append(token)
    return enriched


def LANGUAGE_TRANSLATE(word: str):
    if _backend is None:
        raise RuntimeError("Mandarin adapter is not loaded")
    return _backend.LANGUAGE_TRANSLATE(word)
