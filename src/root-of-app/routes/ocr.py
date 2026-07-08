"""
OCR routes — RapidOCR, PaddleOCR, MangaOCR engines.

Handles text detection and recognition in images,
with support for vertical text (e.g. manga), RAM saver mode,
and idle unloading to free memory.
"""

import asyncio
import gc
import inspect
import io
import math
import os
import threading
import time
import traceback
import base64

import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from pydantic import BaseModel
from PIL import Image
from typing import List

import config
from logging_utils import get_logger, _process_stats

log = get_logger("ocr")
log_init = get_logger("ocr.init")
log_run = get_logger("ocr.run")
log_dl = get_logger("ocr.dl")

router = APIRouter()

# ── Global state ──
_rapid_ocr = None
_paddle_ocr = None
_manga_ocr = None
_rapid_ocr_language: str | None = None
_paddle_ocr_language: str | None = None
_ocr_model_lock = threading.Lock()
_transformers_preimport_done = threading.Event()

# OCR idle-unload
_OCR_IDLE_TIMEOUT_SECONDS = 600
_ocr_last_used: float = 0.0
_ocr_idle_timer: threading.Timer | None = None
_ocr_idle_lock = threading.Lock()
_SUPPORTED_OCR_RECOGNITION_ENGINES = {"rapidocr", "paddleocr", "mangaocr"}


def get_transformers_preimport_event() -> threading.Event:
    """Return the event so server.py startup can set it."""
    return _transformers_preimport_done


# ── Idle management ──


def _ocr_touch():
    global _ocr_last_used, _ocr_idle_timer
    _ocr_last_used = time.monotonic()
    with _ocr_idle_lock:
        if _ocr_idle_timer is not None:
            _ocr_idle_timer.cancel()
        _ocr_idle_timer = threading.Timer(_OCR_IDLE_TIMEOUT_SECONDS, _ocr_check_idle)
        _ocr_idle_timer.daemon = True
        _ocr_idle_timer.start()


def _ocr_check_idle():
    elapsed = time.monotonic() - _ocr_last_used
    if elapsed >= _OCR_IDLE_TIMEOUT_SECONDS:
        _ocr_unload()
    else:
        remaining = _OCR_IDLE_TIMEOUT_SECONDS - elapsed
        with _ocr_idle_lock:
            global _ocr_idle_timer
            _ocr_idle_timer = threading.Timer(remaining, _ocr_check_idle)
            _ocr_idle_timer.daemon = True
            _ocr_idle_timer.start()


def _ocr_unload():
    global _rapid_ocr, _paddle_ocr, _manga_ocr, _rapid_ocr_language, _paddle_ocr_language
    with _ocr_model_lock:
        _ocr_unload_inner()


def _ocr_unload_inner():
    global _rapid_ocr, _paddle_ocr, _manga_ocr, _rapid_ocr_language, _paddle_ocr_language
    any_unloaded = False
    if _rapid_ocr is not None:
        log.info("OCR idle timeout — unloading RapidOCR")
        try:
            del _rapid_ocr
        except Exception:
            pass
        _rapid_ocr = None
        _rapid_ocr_language = None
        any_unloaded = True
    if _paddle_ocr is not None:
        log.info("OCR idle timeout — unloading PaddleOCR")
        try:
            del _paddle_ocr
        except Exception:
            pass
        _paddle_ocr = None
        _paddle_ocr_language = None
        any_unloaded = True
    if _manga_ocr is not None:
        log.info("OCR idle timeout — unloading MangaOCR")
        try:
            del _manga_ocr
        except Exception:
            pass
        _manga_ocr = None
        any_unloaded = True
    if any_unloaded:
        gc.collect()
        torch = config.torch
        if torch is not None:
            try:
                if hasattr(torch, "cuda") and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                    torch.mps.empty_cache()
            except Exception:
                pass
        log.info("OCR models unloaded successfully")


# ── Engine initialisation ──


def _get_rapid_ocr(language: str):
    global _rapid_ocr
    if not config.OCR_ALLOWED:
        log_init.info("OCR disabled; RapidOCR not initialised")
        return None
    with _ocr_model_lock:
        if _rapid_ocr is not None and _rapid_ocr_language == language:
            return _rapid_ocr
        return _init_rapid_ocr(language)


def _init_rapid_ocr(language: str):
    global _rapid_ocr, _rapid_ocr_language
    try:
        from rapidocr import RapidOCR, LangRec  # type: ignore
    except Exception as e:
        log_init.error(f"RapidOCR import error {e}", exc_info=True)
        return None

    ocr_config = config.language_runtime_config_for_language(language, "ocr")
    configured_lang_value = ocr_config.get("rapidLangType")
    if not isinstance(configured_lang_value, str) or not configured_lang_value.strip():
        log_init.error(f"RapidOCR runtime metadata is missing rapidLangType for {language}")
        return None
    configured_lang = configured_lang_value.upper()
    if not hasattr(LangRec, configured_lang):
        log_init.error(f"RapidOCR runtime metadata has unsupported rapidLangType {configured_lang_value!r} for {language}")
        return None
    lang_type = getattr(LangRec, configured_lang)
    supports_vertical_text = config.language_supports_vertical_text_for_language(language)

    log_init.info(f"Initializing RapidOCR with lang {str(lang_type)}")
    t0 = time.perf_counter()
    params = {
        "Global.use_cls": False,
        "Rec.lang_type": lang_type,
    }
    if supports_vertical_text:
        params["Det.limit_type"] = "max"
        params["Det.limit_side_len"] = 960
        params["Det.unclip_ratio"] = 1.5
    _rapid_ocr = RapidOCR(params=params)
    _rapid_ocr_language = language
    t1 = time.perf_counter()
    log_init.info(f"RapidOCR initialized in {t1 - t0:.2f}s")
    _process_stats("rapid_ocr_init")
    return _rapid_ocr


def _get_paddle_ocr(language: str):
    global _paddle_ocr
    if not config.OCR_ALLOWED:
        log_init.info("OCR disabled; PaddleOCR not initialised")
        return None
    with _ocr_model_lock:
        if _paddle_ocr is not None and _paddle_ocr_language == language:
            return _paddle_ocr
        return _init_paddle_ocr(language)


def _init_paddle_ocr(language: str):
    global _paddle_ocr, _paddle_ocr_language
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as e:
        log_init.error(f"PaddleOCR import error {e}", exc_info=True)
        return None
    ocr_config = config.language_runtime_config_for_language(language, "ocr")
    lang_code_value = ocr_config.get("paddleLang")
    if not isinstance(lang_code_value, str) or not lang_code_value.strip():
        log_init.error(f"PaddleOCR runtime metadata is missing paddleLang for {language}")
        return None
    lang_code = lang_code_value
    try:
        import paddle  # type: ignore

        log_init.info(f"PaddlePaddle version {getattr(paddle, '__version__', 'unknown')}")
    except Exception as e:
        log_init.warning(f"Paddle import/version error {e}")
    log_init.info(f"Initializing PaddleOCR with lang {lang_code}")
    t0 = time.perf_counter()
    _paddle_ocr = PaddleOCR(
        lang=lang_code,
        use_angle_cls=True,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
    )
    _paddle_ocr_language = language
    t1 = time.perf_counter()
    log_init.info(f"PaddleOCR initialized in {t1 - t0:.2f}s")
    _process_stats("paddle_init")
    return _paddle_ocr


def _uses_manga_ocr_recognition(language: str | None) -> bool:
    if not language:
        return False
    ocr_config = config.language_runtime_config_for_language(language, "ocr")
    recognition_engine = ocr_config.get("recognitionEngine")
    return (
        isinstance(recognition_engine, str)
        and _normalize_ocr_recognition_engine(recognition_engine) == "mangaocr"
    )


def _normalize_ocr_recognition_engine(recognition_engine: str) -> str:
    trimmed = recognition_engine.strip()
    normalized = trimmed.lower()
    return normalized if normalized in _SUPPORTED_OCR_RECOGNITION_ENGINES else trimmed


def _require_ocr_runtime_config(language: str | None) -> dict:
    if not language:
        raise HTTPException(
            status_code=400,
            detail="No language selected for OCR",
        )
    ocr_config = config.language_runtime_config_for_language(language, "ocr")
    recognition_engine = ocr_config.get("recognitionEngine")
    if not isinstance(recognition_engine, str) or not recognition_engine.strip():
        raise HTTPException(
            status_code=400,
            detail=f"OCR runtime language data is required for {language}",
        )
    return ocr_config


def _require_ocr_recognition_engine(language: str, ocr_config: dict) -> str:
    recognition_engine = ocr_config.get("recognitionEngine")
    if not isinstance(recognition_engine, str) or not recognition_engine.strip():
        raise HTTPException(
            status_code=400,
            detail=f"OCR runtime language data is required for {language}",
        )
    return _normalize_ocr_recognition_engine(recognition_engine)


def _is_builtin_ocr_recognition_engine(recognition_engine: str) -> bool:
    return recognition_engine in _SUPPORTED_OCR_RECOGNITION_ENGINES


def _paddle_run_ocr(paddle_inst, img):
    try:
        res = paddle_inst.ocr(img, cls=False)
        log_run.info(f"paddle ocr produced {len(res) if isinstance(res, list) else 'n/a'} items")
        return res
    except TypeError:
        res = paddle_inst.ocr(img)
        log_run.info(f"paddle ocr produced (compat) {len(res) if isinstance(res, list) else 'n/a'} items")
        return res


def _extract_lines_from_paddle_result(result):
    if not result:
        return []

    if (
        isinstance(result, list)
        and len(result) == 1
        and not isinstance(result[0], (list, tuple))
    ):
        result = result[0]

    if isinstance(result, dict):
        texts = result.get("rec_texts") or result.get("texts")
        scores = result.get("rec_scores") or result.get("scores")
        box_keys = [
            "text_det_polys",
            "det_polys",
            "dt_polys",
            "polys",
            "text_region_polys",
            "boxes",
            "dt_boxes",
            "det_boxes",
        ]
        boxes = None
        for k in box_keys:
            if k in result:
                boxes = result[k]
                break
        if boxes is None:
            for k, v in result.items():
                if isinstance(v, (list, tuple)) and len(v) > 0:
                    try:
                        arr = np.array(v[0])
                        if arr.ndim == 2 and arr.shape[1] == 2 and arr.shape[0] >= 4:
                            boxes = v
                            break
                    except Exception:
                        pass
        flat: list[tuple] = []
        try:
            if (
                texts is not None
                and isinstance(boxes, (list, tuple))
                and len(boxes) > 0
            ):
                n = min(len(texts), len(boxes))
                for i in range(n):
                    pts = boxes[i]
                    if isinstance(pts, np.ndarray):
                        pts = pts.tolist()
                    if pts and isinstance(pts[0], (int, float)) and len(pts) % 2 == 0:
                        pts = [
                            [float(pts[j]), float(pts[j + 1])]
                            for j in range(0, len(pts), 2)
                        ]
                    pts = [[float(x), float(y)] for x, y in pts]
                    txt = str(texts[i])
                    scr = (
                        float(scores[i])
                        if scores is not None and i < len(scores)
                        else None
                    )
                    flat.append((pts, txt, scr))
                return flat
            if texts is not None:
                return [
                    (
                        None,
                        str(t),
                        float(scores[i])
                        if scores is not None and i < len(scores)
                        else None,
                    )
                    for i, t in enumerate(texts)
                ]
        except Exception:
            return []
        return []

    lines = result
    if (
        isinstance(result, list)
        and len(result) > 0
        and isinstance(result[0], list)
        and (len(result) == 1 or (result and isinstance(result[0][0], (list, tuple))))
    ):
        lines = result[0]

    flat = []
    try:
        for item in lines:
            if not item:
                continue
            pts = item[0]
            txt, scr = None, None
            if (
                len(item) > 1
                and isinstance(item[1], (list, tuple))
                and len(item[1]) >= 2
            ):
                txt, scr = item[1][0], float(item[1][1])
            flat.append((pts, txt, scr))
    except Exception as e:
        log_run.error(f"Failed to parse PaddleOCR lines: {e}")
        return []
    return flat


def _get_manga_ocr():
    global _manga_ocr
    if not config.OCR_ALLOWED:
        log_init.info("OCR disabled; MangaOCR not initialised")
        return None
    with _ocr_model_lock:
        if _manga_ocr is not None:
            return _manga_ocr
        return _init_manga_ocr()


def _init_manga_ocr():
    global _manga_ocr
    # If warmup hasn't been triggered yet, do the preimport inline
    if not _transformers_preimport_done.is_set():
        _ensure_warmup_started()
    _transformers_preimport_done.wait(timeout=120)
    try:
        _fd_count = len(os.listdir("/dev/fd"))
        log_init.info(f"Process FDs before MangaOCR init: {_fd_count}")
    except Exception:
        pass
    gc.collect()
    try:
        from manga_ocr import MangaOcr  # type: ignore
    except Exception as e:
        log_init.error(f"MangaOCR import error {e}", exc_info=True)
        return None
    try:
        log_init.info("Initializing MangaOCR")
        t0 = time.perf_counter()
        _manga_ocr = MangaOcr()
        t1 = time.perf_counter()
        log_init.info(f"MangaOCR initialized in {t1 - t0:.2f}s")
        _process_stats("mangaocr_init")
    except Exception as e:
        log_init.error(f"Failed to initialize MangaOCR {e}", exc_info=True)
        _manga_ocr = None
    return _manga_ocr


# ── Image helpers ──


def _regroup_boxes_for_vertical_text(boxes):
    """Post-process detection boxes for vertical-text languages.

    Clusters per-character or horizontal-row boxes into vertical columns
    using union-find.
    """
    if not boxes or len(boxes) <= 1:
        return boxes

    rects = []
    for box in boxes:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        w = max_x - min_x
        h = max_y - min_y
        rects.append(
            {
                "min_x": min_x,
                "max_x": max_x,
                "min_y": min_y,
                "max_y": max_y,
                "w": max(w, 1),
                "h": max(h, 1),
                "cx": (min_x + max_x) / 2.0,
                "cy": (min_y + max_y) / 2.0,
            }
        )

    tall_count = sum(1 for r in rects if r["h"] > r["w"] * 1.3)
    if tall_count >= len(rects) * 0.5:
        log_run.info(
            f"Vertical regroup: {tall_count}/{len(rects)} already vertical, skipping"
        )
        return boxes

    log_run.info(
        f"Vertical regroup: only {tall_count}/{len(rects)} vertical, "
        "regrouping into columns"
    )

    n = len(rects)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    widths = sorted(r["w"] for r in rects)
    median_w = widths[len(widths) // 2] if widths else 1.0
    x_thresh = median_w * 1.2

    for i in range(n):
        for j in range(i + 1, n):
            ri, rj = rects[i], rects[j]
            x_overlap = min(ri["max_x"], rj["max_x"]) - max(ri["min_x"], rj["min_x"])
            if x_overlap >= -x_thresh:
                y_gap = max(
                    0, max(ri["min_y"], rj["min_y"]) - min(ri["max_y"], rj["max_y"])
                )
                max_h = max(ri["h"], rj["h"])
                if y_gap <= max_h * 3:
                    union(i, j)

    from collections import defaultdict

    clusters = defaultdict(list)
    for i in range(n):
        clusters[find(i)].append(i)

    merged = []
    for indices in clusters.values():
        if not indices:
            continue
        min_x = min(rects[i]["min_x"] for i in indices)
        max_x = max(rects[i]["max_x"] for i in indices)
        min_y = min(rects[i]["min_y"] for i in indices)
        max_y = max(rects[i]["max_y"] for i in indices)
        merged.append(
            [
                [min_x, min_y],
                [max_x, min_y],
                [max_x, max_y],
                [min_x, max_y],
            ]
        )

    log_run.info(f"Vertical regroup: {len(boxes)} boxes → {len(merged)} columns")
    return merged


def _load_image_from_inputs(
    file_bytes: bytes | None, image_base64: str | None
) -> Image.Image:
    if file_bytes is None and not image_base64:
        raise HTTPException(
            status_code=400, detail="No image provided. Send 'file' or 'image_base64'."
        )
    try:
        if file_bytes is not None:
            log.info(f"Loading image from file bytes of length: {len(file_bytes)}")
            img = Image.open(io.BytesIO(file_bytes))
            log.info(f"Loaded image: mode= {img.mode}  size= {img.size}")
            return img.convert("RGB")
        else:
            raw_part = image_base64.split(",")[-1] if image_base64 else ""
            log.info(f"Loading image from base64 of length: {len(raw_part)}")
            raw = base64.b64decode(raw_part)
            img = Image.open(io.BytesIO(raw))
            log.info(f"Loaded image: mode= {img.mode}  size= {img.size}")
            return img.convert("RGB")
    except Exception as e:
        log.error(f"_load_image_from_inputs error: {e}", exc_info=True)
        log.error(traceback.format_exc())
        raise HTTPException(status_code=400, detail="Invalid image data.")


def _extract_rapid_ocr_boxes(result) -> list:
    if result is None:
        return []
    boxes = result.boxes
    txts = result.txts
    scores = result.scores
    if boxes is None or txts is None:
        return []
    flat = []
    try:
        n = min(len(boxes), len(txts))
        for i in range(n):
            pts = boxes[i]
            if isinstance(pts, np.ndarray):
                pts = pts.tolist()
            pts = [[float(x), float(y)] for x, y in pts]
            txt = str(txts[i])
            scr = float(scores[i]) if scores is not None and i < len(scores) else None
            flat.append((pts, txt, scr))
    except Exception as e:
        log_run.error(f"_extract_rapid_ocr_boxes error: {e}", exc_info=True)
    return flat


def _crop_by_box(image: Image.Image, pts) -> Image.Image:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    left = max(0, int(min(xs)))
    upper = max(0, int(min(ys)))
    right = int(max(xs))
    lower = int(max(ys))
    if right <= left:
        right = left + 1
    if lower <= upper:
        lower = upper + 1
    return image.crop((left, upper, right, lower))


def _is_box_vertical(pts) -> bool:
    try:
        w_top = math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        w_bot = math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1])
        h_left = math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1])
        h_right = math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
        w = (w_top + w_bot) / 2.0
        h = (h_left + h_right) / 2.0
        return h > w * 1.2 if w > 0 else h > 0
    except Exception:
        return False


# ── Pydantic models ──


class OcrBox(BaseModel):
    box: List[List[float]]
    text: str
    score: float | None = None
    is_vertical: bool | None = None


class OcrProcessingTimes(BaseModel):
    total_ms: float
    detection_ms: float | None = None
    detection_engine: str | None = None
    recognition_ms: float | None = None
    recognition_engine: str | None = None
    per_box_ms: List[float] | None = None


class OcrResponse(BaseModel):
    boxes: List[OcrBox]
    processing_times: OcrProcessingTimes | None = None


def _normalize_language_adapter_ocr_box(raw_box) -> OcrBox:
    if isinstance(raw_box, OcrBox):
        box = raw_box
    elif isinstance(raw_box, dict):
        box = OcrBox(**raw_box)
    else:
        raise HTTPException(
            status_code=500,
            detail="Language OCR adapter returned an invalid OCR box",
        )
    if box.is_vertical is not None:
        return box
    return OcrBox(
        box=box.box,
        text=box.text,
        score=box.score,
        is_vertical=_is_box_vertical(box.box),
    )


async def _run_language_adapter_ocr(
    language: str,
    recognition_engine: str,
    image: Image.Image,
    options: dict,
) -> list[OcrBox]:
    module = config.get_or_load_language(language)
    handler = getattr(module, "LANGUAGE_OCR", None) if module is not None else None
    if handler is None or not callable(handler):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported OCR recognition engine for {language}: {recognition_engine}",
        )

    try:
        if inspect.iscoroutinefunction(handler):
            raw_result = await handler(image, options)
        else:
            raw_result = await asyncio.to_thread(handler, image, options)
    except HTTPException:
        raise
    except Exception as exc:
        log_run.error(f"Language OCR adapter error for {language}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Language OCR adapter failed")

    raw_boxes = raw_result.get("boxes") if isinstance(raw_result, dict) else raw_result
    if not isinstance(raw_boxes, list):
        raise HTTPException(
            status_code=500,
            detail="Language OCR adapter returned an invalid OCR response",
        )
    return [_normalize_language_adapter_ocr_box(raw_box) for raw_box in raw_boxes]


# ── Warmup endpoint ──

_warmup_lock = threading.Lock()
_warmup_started = False


def _do_warmup():
    """Run the heavy transformers pre-import in the current thread."""
    try:
        log_init.info("Pre-importing transformers for MangaOCR (lazy warmup)...")
        from transformers import (  # noqa: F401
            ViTImageProcessor,
            AutoTokenizer,
            VisionEncoderDecoderModel,
            GenerationMixin,
        )

        gc.collect()
        log_init.info("Transformers pre-import done (lazy warmup)")
    except Exception as e:
        log_init.warning(f"Transformers pre-import failed (non-fatal): {e}")
    finally:
        _transformers_preimport_done.set()


def _ensure_warmup_started():
    """Start the warmup thread if not already running."""
    global _warmup_started
    with _warmup_lock:
        if _warmup_started or _transformers_preimport_done.is_set():
            return
        _warmup_started = True
    t = threading.Thread(target=_do_warmup, daemon=True)
    t.start()


@router.post("/ocr/warmup")
async def ocr_warmup(language: str | None = Query(None)):
    """Trigger lazy pre-import of transformers for MangaOCR.

    Called when the reader is first opened for a language whose OCR runtime
    metadata uses MangaOCR, so heavy imports happen on demand.
    """
    if not config.OCR_ALLOWED:
        return {"status": "disabled"}

    warmup_language = language if isinstance(language, str) and language else config.LANGUAGE
    if not _uses_manga_ocr_recognition(warmup_language):
        return {"status": "not_needed", "language": warmup_language}

    if _transformers_preimport_done.is_set():
        return {"status": "already_done", "language": warmup_language}

    global _warmup_started
    with _warmup_lock:
        if _warmup_started:
            return {"status": "in_progress", "language": warmup_language}

    _ensure_warmup_started()
    return {"status": "started", "language": warmup_language}


# ── Main endpoint ──


@router.post("/ocr", response_model=OcrResponse)
async def ocr_endpoint(
    file: UploadFile | None = File(None),
    image_base64: str | None = Form(None),
    language: str | None = Form(None),
    dev_mode: str | None = Form(None),
    detection_max_width: str | None = Form(None),
    detection_max_height: str | None = Form(None),
):
    if not config.OCR_ALLOWED:
        raise HTTPException(status_code=403, detail="OCR disabled by user")

    is_dev = dev_mode is not None and dev_mode.lower() in ("1", "true", "yes")
    ocr_language = language or config.LANGUAGE
    ocr_config = _require_ocr_runtime_config(ocr_language)
    recognition_engine = _require_ocr_recognition_engine(ocr_language, ocr_config)

    max_width_value = detection_max_width
    max_height_value = detection_max_height
    detection_max_w: int | None = None
    detection_max_h: int | None = None
    if max_width_value is not None:
        try:
            detection_max_w = max(1, int(max_width_value))
        except (ValueError, TypeError):
            pass
    if max_height_value is not None:
        try:
            detection_max_h = max(1, int(max_height_value))
        except (ValueError, TypeError):
            pass

    log_run.info(f"Loading OCR recognition engine {recognition_engine}")
    _process_stats("ocr_req")
    _ocr_touch()
    try:
        t_total_start = time.perf_counter()
        file_bytes = await file.read() if file is not None else None
        image = _load_image_from_inputs(file_bytes, image_base64)
        np_img = np.array(image, dtype=np.uint8)
        if not np_img.flags["C_CONTIGUOUS"]:
            np_img = np.ascontiguousarray(np_img)

        results: list[OcrBox] = []
        timing_detection_ms: float | None = None
        timing_detection_engine: str | None = None
        timing_recognition_ms: float | None = None
        timing_recognition_engine: str | None = None
        timing_per_box_ms: list[float] | None = None

        if not _is_builtin_ocr_recognition_engine(recognition_engine):
            adapter_options = {
                "language": ocr_language,
                "recognitionEngine": recognition_engine,
                "devMode": is_dev,
            }
            t_adapter_start = time.perf_counter()
            results = await _run_language_adapter_ocr(
                ocr_language,
                recognition_engine,
                image,
                adapter_options,
            )
            t_adapter_end = time.perf_counter()
            elapsed_ms = (t_adapter_end - t_adapter_start) * 1000
            timing_detection_ms = elapsed_ms
            timing_detection_engine = "LanguageAdapter"
            timing_recognition_ms = elapsed_ms
            timing_recognition_engine = recognition_engine

        elif recognition_engine == "mangaocr":
            log_run.info(f"{ocr_language} OCR — MangaOCR image recognition")
            mocr = _get_manga_ocr()
            if mocr is None:
                raise HTTPException(
                    status_code=500,
                    detail="MangaOCR not available — OCR dependencies may not be installed. Re-run the installer and ensure OCR is selected.",
                )
            t_rec_start = time.perf_counter()
            text = await asyncio.to_thread(mocr, image) or ""
            elapsed_ms = (time.perf_counter() - t_rec_start) * 1000
            w, h = image.size
            full_box = [
                [0.0, 0.0],
                [float(w), 0.0],
                [float(w), float(h)],
                [0.0, float(h)],
            ]
            results.append(
                OcrBox(
                    box=full_box,
                    text=text,
                    score=None,
                    is_vertical=_is_box_vertical(full_box),
                )
            )
            timing_detection_ms = 0.0
            timing_detection_engine = "Crop"
            timing_recognition_ms = elapsed_ms
            timing_recognition_engine = "MangaOCR"
            timing_per_box_ms = [elapsed_ms]

        elif recognition_engine == "rapidocr":
            t0 = time.perf_counter()
            rapid = _get_rapid_ocr(ocr_language)
            t1 = time.perf_counter()
            if rapid is None:
                raise HTTPException(
                    status_code=500,
                    detail="RapidOCR not available — OCR dependencies may not be installed. Re-run the installer and ensure OCR is selected.",
                )
            log_run.info(f"RapidOCR handle ready in {t1 - t0:.2f}s")
            log_run.info("Recognizing text positions...")

            t2 = time.perf_counter()
            out = await asyncio.to_thread(
                rapid, np_img, use_det=True, use_cls=False, use_rec=True
            )
            t3 = time.perf_counter()
            elapsed_ms = (t3 - t2) * 1000
            log_run.info(f"RapidOCR e2e {t3 - t2:.2f}s")
            timing_detection_ms = elapsed_ms
            timing_detection_engine = "RapidOCR"
            timing_recognition_ms = elapsed_ms
            timing_recognition_engine = "RapidOCR"

            lines = _extract_rapid_ocr_boxes(out)
            log_run.info(f"Extracted {len(lines)} lines (e2e)")
            for i, (pts, txt, scr) in enumerate(lines):
                if pts is None:
                    continue
                if i % 25 == 0:
                    log_run.info(f"Recognition progress {i + 1}/{len(lines)}")
                box_pts = [[float(x), float(y)] for x, y in pts]
                results.append(
                    OcrBox(
                        box=box_pts,
                        text=str(txt or ""),
                        score=(float(scr) if scr is not None else None),
                        is_vertical=_is_box_vertical(box_pts),
                    )
                )

        elif recognition_engine == "paddleocr":
            t0 = time.perf_counter()
            paddle = _get_paddle_ocr(ocr_language)
            t1 = time.perf_counter()
            if paddle is None:
                raise HTTPException(
                    status_code=500,
                    detail="PaddleOCR not available — OCR dependencies may not be installed. Re-run the installer and ensure OCR is selected.",
                )
            log_run.info(f"PaddleOCR handle ready in {t1 - t0:.2f}s")
            log_run.info("Recognizing text positions...")

            H, W = int(np_img.shape[0]), int(np_img.shape[1])
            paddle_img = np_img
            scale = 1.0
            if detection_max_w is not None or detection_max_h is not None:
                effective_max_dim = 2000
                if detection_max_w is not None and detection_max_h is not None:
                    effective_max_dim = max(detection_max_w, detection_max_h)
                elif detection_max_w is not None:
                    effective_max_dim = detection_max_w
                elif detection_max_h is not None:
                    effective_max_dim = detection_max_h
                if max(H, W) > effective_max_dim:
                    scale = float(effective_max_dim) / float(max(H, W))
                    new_w = max(1, int(W * scale))
                    new_h = max(1, int(H * scale))
                    log_run.info(
                        f"Downscaling for PaddleOCR "
                        f"{W}x{H}->{new_w}x{new_h} "
                        f"scale={scale:.3f}"
                    )
                    paddle_img = np.ascontiguousarray(
                        np.array(image.resize((new_w, new_h)), dtype=np.uint8)
                    )

            t2 = time.perf_counter()
            out = await asyncio.to_thread(_paddle_run_ocr, paddle, paddle_img)
            t3 = time.perf_counter()
            elapsed_ms = (t3 - t2) * 1000
            log_run.info(f"PaddleOCR e2e {t3 - t2:.2f}s")
            timing_detection_ms = elapsed_ms
            timing_detection_engine = "PaddleOCR"
            timing_recognition_ms = elapsed_ms
            timing_recognition_engine = "PaddleOCR"

            lines = _extract_lines_from_paddle_result(out)
            log_run.info(f"Extracted {len(lines)} lines (e2e)")
            inv = 1.0 / scale if scale != 1.0 else 1.0
            for i, (pts, txt, scr) in enumerate(lines):
                if pts is None:
                    continue
                if i % 25 == 0:
                    log_run.info(f"Recognition progress {i + 1}/{len(lines)}")
                if inv != 1.0:
                    box_pts = [[float(x) * inv, float(y) * inv] for x, y in pts]
                else:
                    box_pts = [[float(x), float(y)] for x, y in pts]
                results.append(
                    OcrBox(
                        box=box_pts,
                        text=str(txt or ""),
                        score=(float(scr) if scr is not None else None),
                        is_vertical=_is_box_vertical(box_pts),
                    )
                )

        log_run.info(f"Final boxes {len(results)}")
        _process_stats("ocr_done")
        t_total_end = time.perf_counter()
        response_data: dict = {
            "boxes": [r.model_dump(exclude_none=True) for r in results]
        }
        if is_dev:
            times = OcrProcessingTimes(
                total_ms=round((t_total_end - t_total_start) * 1000, 1),
                detection_ms=(
                    round(timing_detection_ms, 1)
                    if timing_detection_ms is not None
                    else None
                ),
                detection_engine=timing_detection_engine,
                recognition_ms=(
                    round(timing_recognition_ms, 1)
                    if timing_recognition_ms is not None
                    else None
                ),
                recognition_engine=timing_recognition_engine,
                per_box_ms=(
                    [round(t, 1) for t in timing_per_box_ms]
                    if timing_per_box_ms
                    else None
                ),
            )
            response_data["processing_times"] = times.model_dump(exclude_none=True)
        return response_data
    except HTTPException:
        log_run.warning("/ocr http exception")
        raise
    except Exception as e:
        log_run.error(f"Unhandled error {e}", exc_info=True)
        log_run.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="OCR processing error")
