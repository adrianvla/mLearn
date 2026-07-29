"""Chinese script conversion backed by packaged language data when available."""

import asyncio
import importlib
import json
from pathlib import Path
from typing import Literal

import config  # pyright: ignore[reportImplicitRelativeImport]
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/v1/convert")
ROOT_OF_APP_DIR = Path(config.ROOT_OF_APP_DIR)
_TABLE_UNSET = object()
_t2s_chars: dict[str, str] | None | object = _TABLE_UNSET


class ConvertRequest(BaseModel):
    language: str
    text: str = Field(..., max_length=50000)
    to: Literal["simplified", "traditional"]


def _t2s_table_path() -> Path:
    data_root = Path(config.LANGUAGE_DATA_PATH) if config.LANGUAGE_DATA_PATH else ROOT_OF_APP_DIR
    installed_path = data_root / "languages" / "zh.t2s.json"
    return installed_path if installed_path.is_file() else ROOT_OF_APP_DIR / "languages" / "zh.t2s.json"


def _load_t2s_chars() -> dict[str, str] | None:
    global _t2s_chars
    if _t2s_chars is _TABLE_UNSET:
        try:
            table = json.loads(_t2s_table_path().read_text(encoding="utf-8"))
            chars = table.get("chars") if isinstance(table, dict) else None
            _t2s_chars = chars if isinstance(chars, dict) else None
        except (OSError, json.JSONDecodeError):
            _t2s_chars = None
    return _t2s_chars if isinstance(_t2s_chars, dict) else None


def _convert_with_opencc(text: str, conversion_config: str) -> str:
    opencc = importlib.import_module("opencc")
    return opencc.OpenCC(conversion_config).convert(text)


def _convert_to_simplified(text: str) -> str:
    chars = _load_t2s_chars()
    if chars is not None:
        return "".join(chars.get(char, char) for char in text)
    return _convert_with_opencc(text, "t2s")


def _reset_cache_for_tests() -> None:
    global _t2s_chars
    _t2s_chars = _TABLE_UNSET


@router.post("")
async def convert_endpoint(request: ConvertRequest):
    if request.language != "zh":
        # Only zh currently ships scriptConversion metadata.
        raise HTTPException(status_code=422, detail="Unsupported script conversion language")
    try:
        if request.to == "simplified":
            converted = await asyncio.get_running_loop().run_in_executor(None, _convert_to_simplified, request.text)
        else:
            # No packaged s2t table exists, so this direction requires OpenCC.
            converted = await asyncio.get_running_loop().run_in_executor(None, _convert_with_opencc, request.text, "s2t")
    except ImportError:
        return JSONResponse(status_code=503, content={"error": "OpenCC is unavailable"})
    return {"converted": converted}


def get_router() -> APIRouter:
    return router
