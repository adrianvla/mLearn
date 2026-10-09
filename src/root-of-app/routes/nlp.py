"""
NLP routes — tokenization and translation.

Delegates to the active language module from plugin_registry, with optional
per-request override via the ``language`` field. The override lets clients
request the correct module even when the global active language has not yet
been switched (e.g. cross-language flashcard rendering, batched migrations,
or clients that key their caches by language).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

import plugin_registry
import config
from generic_language import dictionary_target_language_override, DictionaryUnavailableError
from logging_utils import get_logger

log = get_logger("nlp")

router = APIRouter()


class LanguageReadyRequest(BaseModel):
    language: str = Field(..., max_length=32)
    generation: str = Field(..., max_length=64)
    dictionaryTargetLanguage: Optional[str] = Field(default=None, max_length=32)
    components: List[str] = Field(default_factory=lambda: ['core'], max_length=32)


@router.post('/language-ready')
def language_ready(req: LanguageReadyRequest):
    from language_generation import admit_language_generation, release_language_generation
    try:
        admission = admit_language_generation(config.LANGUAGE_DATA_PATH, req.generation)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail={'code': 'generation_changed'}) from exc
    try:
        with dictionary_target_language_override(req.language, req.dictionaryTargetLanguage):
            module = _resolve_module(req.language)
            metadata = config._read_language_metadata(req.language)
            tokenizer = metadata.get('runtime', {}).get('nlp', {}).get('tokenizer', {})
            if tokenizer.get('required') is True: module.LANGUAGE_TOKENIZE('')
            if req.dictionaryTargetLanguage: module.LANGUAGE_TRANSLATE('')
            if 'ocr' in req.components:
                from routes.ocr import ensure_language_ocr_ready
                ensure_language_ocr_ready(req.language)
            if 'voice' in req.components:
                from routes.voice import ensure_language_voice_ready
                ensure_language_voice_ready(req.language)
            ready_adapter = getattr(module, 'LANGUAGE_RUNTIME_READY', None)
            if callable(ready_adapter): ready_adapter(req.components)
        return {'language': req.language, 'generation': req.generation, 'components': req.components, 'ready': True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail={'code': 'language_runtime_unavailable', 'message': str(exc)}) from exc
    finally:
        release_language_generation(admission)


def _resolve_module(language: Optional[str]):
    """Resolve exactly the requested package, or the active package if unspecified."""
    if language:
        module = config.get_or_load_language(language)
    else:
        module = config.get_or_load_language(config.LANGUAGE) if config.LANGUAGE else plugin_registry.get_active()
    if module is None:
        raise HTTPException(status_code=503, detail={"code": "language_unavailable"})
    return module


class TokenizeRequest(BaseModel):
    dictionaryTargetLanguage: Optional[str] = Field(default=None, max_length=32)
    text: str = Field(..., max_length=50000)
    language: Optional[str] = Field(default=None, max_length=32)


class TokenizeResponse(BaseModel):
    tokens: List


class TranslationRequest(BaseModel):
    word: str = Field(..., max_length=1000)
    language: Optional[str] = Field(default=None, max_length=32)
    dictionary_target_language: Optional[str] = Field(default=None, max_length=32)
    dictionaryTargetLanguage: Optional[str] = Field(default=None, max_length=32)
    context: Optional[dict] = None

    def requested_dictionary_target_language(self) -> Optional[str]:
        return self.dictionary_target_language or self.dictionaryTargetLanguage


class TranslationResponse(BaseModel):
    data: List
    resolution: Optional[dict] = None


@router.post("/tokenize", response_model=TokenizeResponse)
def tokenize(req: TokenizeRequest):
    log.info("requested tokenization: characters=%d", len(req.text))
    mod = _resolve_module(req.language)
    with dictionary_target_language_override(req.language or getattr(mod, "language", None), req.dictionaryTargetLanguage):
        tokens = mod.LANGUAGE_TOKENIZE(req.text)
    return {"tokens": tokens}


@router.post("/translate", response_model=TranslationResponse)
def get_translation(req: TranslationRequest):
    log.info("requested translation: characters=%d", len(req.word))
    mod = _resolve_module(req.language)
    target_language = req.requested_dictionary_target_language()
    def resolve():
        resolver = getattr(mod, "LANGUAGE_RESOLVE", None)
        return resolver(req.word, req.context) if callable(resolver) else mod.LANGUAGE_TRANSLATE(req.word)
    try:
        if target_language:
            language = req.language or getattr(mod, "language", None)
            with dictionary_target_language_override(language, target_language):
                return resolve()
        return resolve()
    except DictionaryUnavailableError as error:
        raise HTTPException(status_code=503, detail={"code": "dictionary_unavailable"}) from error


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
    try:
        return mod.LANGUAGE_DICTIONARY_WORDS()
    except DictionaryUnavailableError as error:
        raise HTTPException(status_code=503, detail={"code": "dictionary_unavailable"}) from error
