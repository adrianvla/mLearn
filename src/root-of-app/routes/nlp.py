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
from logging_utils import get_logger

log = get_logger("nlp")

router = APIRouter()


def _resolve_module(language: Optional[str]):
    """Return the requested language module, falling back to the active one."""
    if language:
        mod = plugin_registry.get_language(language)
        if mod is not None:
            return mod
    return plugin_registry.get_active()


class TokenizeRequest(BaseModel):
    text: str = Field(..., max_length=50000)
    language: Optional[str] = Field(default=None, max_length=32)


class TokenizeResponse(BaseModel):
    tokens: List


class TranslationRequest(BaseModel):
    word: str = Field(..., max_length=1000)
    language: Optional[str] = Field(default=None, max_length=32)


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
    return mod.LANGUAGE_TRANSLATE(req.word)
