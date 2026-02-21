"""
NLP routes — tokenization and translation.

Delegates to the dynamically loaded language module from config.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

import config
from logging_utils import _log

router = APIRouter()


class TokenizeRequest(BaseModel):
    text: str


class TokenizeResponse(BaseModel):
    tokens: List


class TranslationRequest(BaseModel):
    word: str


class TranslationResponse(BaseModel):
    data: List


@router.post("/tokenize", response_model=TokenizeResponse)
def tokenize(req: TokenizeRequest):
    _log("requested tokenization: ", req.text)
    tokens = config.language_module.LANGUAGE_TOKENIZE(req.text)
    return {"tokens": tokens}


@router.post("/translate", response_model=TranslationResponse)
def get_translation(req: TranslationRequest):
    _log("requested translation: ", req.word)
    return config.language_module.LANGUAGE_TRANSLATE(req.word)
