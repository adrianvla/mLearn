"""Language-package conversion adapter endpoint."""

import asyncio
import inspect

import config  # pyright: ignore[reportImplicitRelativeImport]
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/v1/convert")


class ConvertRequest(BaseModel):
    language: str = Field(..., min_length=1, max_length=32)
    text: str = Field(..., max_length=50000)
    to: str = Field(..., min_length=1, max_length=128)


@router.post("")
async def convert_endpoint(request: ConvertRequest):
    try:
        language_module = config.get_or_load_language(request.language)
    except ImportError:
        return JSONResponse(
            status_code=503,
            content={"error": "Language conversion dependency is unavailable"},
        )

    if language_module is None:
        raise HTTPException(status_code=422, detail="Language package is not installed")

    handler = getattr(language_module, "LANGUAGE_CONVERT", None)
    if not callable(handler):
        raise HTTPException(status_code=422, detail="Language package does not provide conversion")

    try:
        if inspect.iscoroutinefunction(handler):
            converted = await handler(request.text, request.to)
        else:
            converted = await asyncio.to_thread(handler, request.text, request.to)
    except ImportError:
        return JSONResponse(
            status_code=503,
            content={"error": "Language conversion dependency is unavailable"},
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not isinstance(converted, str):
        raise HTTPException(status_code=500, detail="Language conversion returned an invalid result")
    return {"converted": converted}


def get_router() -> APIRouter:
    return router
