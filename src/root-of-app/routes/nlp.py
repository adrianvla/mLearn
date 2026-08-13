"""
NLP routes — tokenization and translation.

Delegates to the active language module from plugin_registry, with optional
per-request override via the ``language`` field. The override lets clients
request the correct module even when the global active language has not yet
been switched (e.g. cross-language flashcard rendering, batched migrations,
or clients that key their caches by language).
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Optional

import plugin_registry
import config
from generic_language import dictionary_target_language_override
from logging_utils import get_logger

log = get_logger("nlp")

router = APIRouter()


def _resolve_module(language: Optional[str]):
    """Return the requested language module, falling back to the active one."""
    if language:
        return config.get_or_load_language(language)
    return plugin_registry.get_active()


class TokenizeRequest(BaseModel):
    text: str = Field(..., max_length=50000)
    language: Optional[str] = Field(default=None, max_length=32)


class TokenizeResponse(BaseModel):
    tokens: List


class TranslationRequest(BaseModel):
    word: str = Field(..., max_length=1000)
    language: Optional[str] = Field(default=None, max_length=32)
    dictionary_target_language: Optional[str] = Field(default=None, max_length=32)
    dictionaryTargetLanguage: Optional[str] = Field(default=None, max_length=32)

    def requested_dictionary_target_language(self) -> Optional[str]:
        return self.dictionary_target_language or self.dictionaryTargetLanguage


class TranslationResponse(BaseModel):
    data: List


@router.post("/tokenize", response_model=TokenizeResponse)
def tokenize(req: TokenizeRequest):
    log.info(f"requested tokenization:  {req.text[:100]}")
    mod = _resolve_module(req.language)
    if mod is None:
        return {"tokens": []}
    tokens = mod.LANGUAGE_TOKENIZE(req.text)
    return {"tokens": tokens}


@router.post("/translate", response_model=TranslationResponse)
def get_translation(req: TranslationRequest):
    log.info(f"requested translation:  {req.word[:100]}")
    mod = _resolve_module(req.language)
    if mod is None:
        return {"data": []}
    target_language = req.requested_dictionary_target_language()
    if target_language:
        language = req.language or getattr(mod, "language", None)
        with dictionary_target_language_override(language, target_language):
            return mod.LANGUAGE_TRANSLATE(req.word)
    return mod.LANGUAGE_TRANSLATE(req.word)


class DictionaryWordsRequest(BaseModel):
    language: Optional[str] = Field(default=None, max_length=32)


class DictionaryWordsResponse(BaseModel):
    words: List


@router.post("/dictionary-words", response_model=DictionaryWordsResponse)
def dictionary_words(req: DictionaryWordsRequest):
    """Enumerate all dictionary headwords for a language.

    Used by bulk-add surfaces to offer words that have no frequency-list entry
    (the "No level" filter bucket). Response is a list of (word, reading)
    pairs ordered by headword; reading is empty for dictionary schemas that
    do not separate it (simple-headword).
    """
    log.info(f"requested dictionary words:  {req.language or 'active'}")
    mod = _resolve_module(req.language)
    if mod is None:
        return {"words": []}
    return mod.LANGUAGE_DICTIONARY_WORDS()
