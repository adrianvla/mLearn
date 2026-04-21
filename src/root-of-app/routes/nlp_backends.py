"""
NLP Backend Integration Routes

Provides structured endpoints for the TypeScript NLP backend abstraction layer.
Bridges the trait-based NLP backend interface with language-specific implementations.

Endpoints:
- POST /nlp/backends/list - List available backends
- POST /nlp/backends/{backend_id}/tokenize - Tokenize text
- POST /nlp/backends/{backend_id}/tokenize-batch - Batch tokenize
- POST /nlp/backends/{backend_id}/lemma - Get lemma for word
- POST /nlp/backends/{backend_id}/reading - Get reading for word
- POST /nlp/backends/{backend_id}/pitch-accent - Get pitch accent for word
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import plugin_registry
from logging_utils import _log

router = APIRouter(prefix="/nlp/backends", tags=["nlp-backends"])


# ============================================================================
# Request/Response Models
# ============================================================================

class MorphTokenResponse(BaseModel):
    """Morphological token response"""
    surface: str
    base: str
    pos: str
    posTags: Optional[List[str]] = None
    reading: Optional[str] = None
    pitchAccent: Optional[int] = None
    inflection: Optional[str] = None
    conjugation: Optional[str] = None
    features: Optional[Dict[str, str]] = None


class TokenizationResultResponse(BaseModel):
    """Tokenization result response"""
    text: str
    language: str
    tokens: List[MorphTokenResponse]
    processingTime: Optional[float] = None
    confidence: Optional[float] = None


class TokenizeRequest(BaseModel):
    """Tokenize request"""
    text: str = Field(..., max_length=50000)
    language: str = Field(..., min_length=2, max_length=5)


class TokenizeBatchRequest(BaseModel):
    """Batch tokenize request"""
    texts: List[str] = Field(..., max_items=100)
    language: str = Field(..., min_length=2, max_length=5)


class LemmaRequest(BaseModel):
    """Get lemma request"""
    word: str = Field(..., max_length=1000)
    language: str = Field(..., min_length=2, max_length=5)


class ReadingRequest(BaseModel):
    """Get reading request"""
    word: str = Field(..., max_length=1000)
    language: str = Field(..., min_length=2, max_length=5)


class PitchAccentRequest(BaseModel):
    """Get pitch accent request"""
    word: str = Field(..., max_length=1000)
    language: str = Field(..., min_length=2, max_length=5)


class BackendInfoResponse(BaseModel):
    """Backend information response"""
    id: str
    name: str
    supportedLanguages: List[str]
    isAvailable: bool


class BackendListResponse(BaseModel):
    """List of available backends"""
    backends: List[BackendInfoResponse]


# ============================================================================
# Helper Functions
# ============================================================================

def _convert_token_to_response(token: Dict[str, Any]) -> MorphTokenResponse:
    """Convert language module token to MorphTokenResponse"""
    return MorphTokenResponse(
        surface=token.get('word', ''),
        base=token.get('actual_word', token.get('word', '')),
        pos=token.get('type', ''),
        posTags=token.get('posTags'),
        reading=token.get('reading'),
        pitchAccent=token.get('pitchAccent'),
        inflection=token.get('inflection'),
        conjugation=token.get('conjugation'),
        features=token.get('features'),
    )


def _get_backend_info(backend_id: str) -> Optional[BackendInfoResponse]:
    """Get backend information"""
    backends = {
        'mecab': BackendInfoResponse(
            id='mecab',
            name='MeCab',
            supportedLanguages=['ja'],
            isAvailable=True,
        ),
        'spacy': BackendInfoResponse(
            id='spacy',
            name='spaCy',
            supportedLanguages=['de'],
            isAvailable=True,
        ),
    }
    return backends.get(backend_id)


def _validate_backend_language(backend_id: str, language: str) -> bool:
    """Validate that backend supports language"""
    backend_info = _get_backend_info(backend_id)
    if not backend_info:
        return False
    return language in backend_info.supportedLanguages


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/list", response_model=BackendListResponse)
def list_backends():
    """List available NLP backends"""
    _log("Listing available NLP backends")
    backends = [
        _get_backend_info('mecab'),
        _get_backend_info('spacy'),
    ]
    return BackendListResponse(backends=[b for b in backends if b])


@router.post("/tokenize", response_model=TokenizationResultResponse)
def tokenize(req: TokenizeRequest):
    """Tokenize text using appropriate backend"""
    _log(f"Tokenizing text for language {req.language}: {req.text[:100]}")
    
    # Get active language module
    mod = plugin_registry.get_active()
    if mod is None:
        raise HTTPException(status_code=400, detail="No active language module")
    
    try:
        # Call language module tokenizer
        tokens = mod.LANGUAGE_TOKENIZE(req.text)
        
        # Convert to response format
        response_tokens = [_convert_token_to_response(t) for t in tokens]
        
        return TokenizationResultResponse(
            text=req.text,
            language=req.language,
            tokens=response_tokens,
            confidence=1.0,
        )
    except Exception as e:
        _log(f"Tokenization error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Tokenization failed: {str(e)}")


@router.post("/tokenize-batch", response_model=List[TokenizationResultResponse])
def tokenize_batch(req: TokenizeBatchRequest):
    """Batch tokenize multiple texts"""
    _log(f"Batch tokenizing {len(req.texts)} texts for language {req.language}")
    
    # Get active language module
    mod = plugin_registry.get_active()
    if mod is None:
        raise HTTPException(status_code=400, detail="No active language module")
    
    try:
        results = []
        for text in req.texts:
            tokens = mod.LANGUAGE_TOKENIZE(text)
            response_tokens = [_convert_token_to_response(t) for t in tokens]
            results.append(TokenizationResultResponse(
                text=text,
                language=req.language,
                tokens=response_tokens,
                confidence=1.0,
            ))
        return results
    except Exception as e:
        _log(f"Batch tokenization error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Batch tokenization failed: {str(e)}")


@router.post("/lemma")
def get_lemma(req: LemmaRequest):
    """Get lemma (dictionary form) for a word"""
    _log(f"Getting lemma for word: {req.word}")
    
    # Validate backend supports language
    if not _validate_backend_language('mecab', req.language) and not _validate_backend_language('spacy', req.language):
        raise HTTPException(status_code=400, detail=f"Unsupported language: {req.language}")
    
    # Get active language module
    mod = plugin_registry.get_active()
    if mod is None:
        raise HTTPException(status_code=400, detail="No active language module")
    
    try:
        # Tokenize the word to get its lemma
        tokens = mod.LANGUAGE_TOKENIZE(req.word)
        if tokens:
            return {"lemma": tokens[0].get('actual_word', req.word)}
        return {"lemma": req.word}
    except Exception as e:
        _log(f"Lemma lookup error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Lemma lookup failed: {str(e)}")


@router.post("/reading")
def get_reading(req: ReadingRequest):
    """Get reading/pronunciation for a word"""
    _log(f"Getting reading for word: {req.word}")
    
    # Validate backend supports language
    if not _validate_backend_language('mecab', req.language) and not _validate_backend_language('spacy', req.language):
        raise HTTPException(status_code=400, detail=f"Unsupported language: {req.language}")
    
    # Get active language module
    mod = plugin_registry.get_active()
    if mod is None:
        raise HTTPException(status_code=400, detail="No active language module")
    
    try:
        # Tokenize the word to get its reading
        tokens = mod.LANGUAGE_TOKENIZE(req.word)
        if tokens and 'reading' in tokens[0]:
            return {"reading": tokens[0]['reading']}
        # German doesn't have readings
        return {"reading": None}
    except Exception as e:
        _log(f"Reading lookup error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Reading lookup failed: {str(e)}")


@router.post("/pitch-accent")
def get_pitch_accent(req: PitchAccentRequest):
    """Get pitch accent for a word (Japanese only)"""
    _log(f"Getting pitch accent for word: {req.word}")
    
    # Pitch accent is Japanese-only
    if req.language != 'ja':
        return {"pitchAccent": None}
    
    # Get active language module
    mod = plugin_registry.get_active()
    if mod is None:
        raise HTTPException(status_code=400, detail="No active language module")
    
    try:
        # Tokenize the word to get its pitch accent
        tokens = mod.LANGUAGE_TOKENIZE(req.word)
        if tokens and 'pitchAccent' in tokens[0]:
            return {"pitchAccent": tokens[0]['pitchAccent']}
        # Pitch accent not available
        return {"pitchAccent": None}
    except Exception as e:
        _log(f"Pitch accent lookup error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Pitch accent lookup failed: {str(e)}")
