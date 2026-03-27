"""
NLP routes — tokenization and translation.

Delegates to the dynamically loaded language module from config.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List

import config
import plugin_registry
from logging_utils import _log

router = APIRouter()


class TokenizeRequest(BaseModel):
    text: str = Field(..., max_length=50000)


class TokenizeResponse(BaseModel):
    tokens: List


class TranslationRequest(BaseModel):
    word: str = Field(..., max_length=1000)


class TranslationResponse(BaseModel):
    data: List


@router.post("/tokenize", response_model=TokenizeResponse)
def tokenize(req: TokenizeRequest):
    _log("requested tokenization: ", req.text[:100])
    mod = plugin_registry.get_active()
    if mod is None:
        return {"tokens": []}
    tokens = mod.LANGUAGE_TOKENIZE(req.text)
    return {"tokens": tokens}


@router.post("/translate", response_model=TranslationResponse)
def get_translation(req: TranslationRequest):
    _log("requested translation: ", req.word[:100])
    mod = plugin_registry.get_active()
    if mod is None:
        return {"data": []}
    return mod.LANGUAGE_TRANSLATE(req.word)
