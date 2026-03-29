"""Minimal language plugin example for mLearn."""

from __future__ import annotations


def LOAD_MODULE(resource_path: str) -> None:
    """Called when the language module is loaded."""
    print(f"[language-template] LOAD_MODULE resource_path={resource_path}")


def LANGUAGE_TOKENIZE(text: str) -> list[dict[str, str]]:
    """Return a tiny token stream matching the current backend expectations."""
    return [
        {
            "word": chunk,
            "lemma": chunk.lower(),
        }
        for chunk in text.split()
        if chunk
    ]


def LANGUAGE_TRANSLATE(word: str) -> list[dict[str, str]]:
    """Return placeholder translation data for template authors."""
    return [
        {
            "word": word,
            "translation": f"TODO: translate {word}",
        }
    ]
