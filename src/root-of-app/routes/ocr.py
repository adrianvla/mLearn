"""
OCR routes — RapidOCR, PaddleOCR, MangaOCR engines.

Handles text detection and recognition in images,
with support for vertical text (e.g. manga), RAM saver mode,
and idle unloading to free memory.
"""
import gc
import io
import math
import os
import statistics
import threading
import time
import traceback
import base64

import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from PIL import Image
from typing import List

import config
from logging_utils import (
    _log, _log_ocr, _log_ocr_init, _log_ocr_run, _log_ocr_dl, _process_stats,
)

router = APIRouter()

# ── Global state ──
_rapid_ocr = None
_paddle_ocr = None
_manga_ocr = None
_ocr_model_lock = threading.Lock()
_transformers_preimport_done = threading.Event()

# OCR idle-unload
_OCR_IDLE_TIMEOUT_SECONDS = 600
_ocr_last_used: float = 0.0
_ocr_idle_timer: threading.Timer | None = None
_ocr_idle_lock = threading.Lock()


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
        _ocr_idle_timer = threading.Timer(
            _OCR_IDLE_TIMEOUT_SECONDS, _ocr_check_idle
        )
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
    global _rapid_ocr, _paddle_ocr, _manga_ocr
    with _ocr_model_lock:
        _ocr_unload_inner()


def _ocr_unload_inner():
    global _rapid_ocr, _paddle_ocr, _manga_ocr
    any_unloaded = False
    if _rapid_ocr is not None:
        _log_ocr("OCR idle timeout — unloading RapidOCR")
        try:
            del _rapid_ocr
        except Exception:
            pass
        _rapid_ocr = None
        any_unloaded = True
    if _paddle_ocr is not None:
        _log_ocr("OCR idle timeout — unloading PaddleOCR")
        try:
            del _paddle_ocr
        except Exception:
            pass
        _paddle_ocr = None
        any_unloaded = True
    if _manga_ocr is not None:
        _log_ocr("OCR idle timeout — unloading MangaOCR")
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
                if hasattr(torch, 'cuda') and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                if hasattr(torch, 'mps') and hasattr(torch.mps, 'empty_cache'):
                    torch.mps.empty_cache()
            except Exception:
                pass
        _log_ocr("OCR models unloaded successfully")


# ── Engine initialisation ──

def _get_rapid_ocr():
    global _rapid_ocr
    if not config.OCR_ALLOWED:
        _log_ocr_init("OCR disabled; RapidOCR not initialised")
        return None
    with _ocr_model_lock:
        if _rapid_ocr is not None:
            return _rapid_ocr
        return _init_rapid_ocr()


def _init_rapid_ocr():
    global _rapid_ocr
    try:
        from rapidocr import RapidOCR, LangRec  # type: ignore
    except Exception as e:
        _log_ocr_init("RapidOCR import error", e)
        return None

    lang_map = {
        "de": LangRec.LATIN,
        "ja": LangRec.JAPAN,
        "en": LangRec.EN,
        "zh": LangRec.CH,
        "ko": LangRec.KOREAN,
        "fr": LangRec.LATIN,
        "es": LangRec.LATIN,
        "ru": LangRec.CYRILLIC,
        "ar": LangRec.ARABIC,
        "th": LangRec.TH,
    }
    lang_type = lang_map.get(config.LANGUAGE, LangRec.EN)

    _log_ocr_init("Initializing RapidOCR with lang", str(lang_type))
    t0 = time.perf_counter()
    params = {
        "Global.use_cls": False,
        "Rec.lang_type": lang_type,
    }
    if config.SUPPORTS_VERTICAL_TEXT:
        params["Det.limit_type"] = "max"
        params["Det.limit_side_len"] = 960
        params["Det.unclip_ratio"] = 1.5
    _rapid_ocr = RapidOCR(params=params)
    t1 = time.perf_counter()
    _log_ocr_init(f"RapidOCR initialized in {t1 - t0:.2f}s")
    _process_stats("rapid_ocr_init")
    return _rapid_ocr


def _get_paddle_ocr():
    global _paddle_ocr
    if not config.OCR_ALLOWED:
        _log_ocr_init("OCR disabled; PaddleOCR not initialised")
        return None
    with _ocr_model_lock:
        if _paddle_ocr is not None:
            return _paddle_ocr
        return _init_paddle_ocr()


def _init_paddle_ocr():
    global _paddle_ocr
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as e:
        _log_ocr_init("PaddleOCR import error", e)
        return None
    langs = {
        "de": "german", "ja": "japan", "en": "en", "ch": "ch",
        "ko": "korean", "fr": "french", "es": "spanish", "ru": "russian",
    }
    lang_code = langs.get(config.LANGUAGE, 'en')
    try:
        import paddle  # type: ignore
        _log_ocr_init("PaddlePaddle version",
                       getattr(paddle, "__version__", "unknown"))
    except Exception as e:
        _log_ocr_init("Paddle import/version error", e)
    _log_ocr_init("Initializing PaddleOCR with lang", lang_code)
    t0 = time.perf_counter()
    _paddle_ocr = PaddleOCR(
        lang=lang_code,
        use_angle_cls=True,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
    )
    t1 = time.perf_counter()
    _log_ocr_init(f"PaddleOCR initialized in {t1 - t0:.2f}s")
    _process_stats("paddle_init")
    return _paddle_ocr


def _paddle_run_ocr(paddle_inst, img):
    try:
        res = paddle_inst.ocr(img, cls=False)
        _log_ocr_run("paddle ocr produced",
                      len(res) if isinstance(res, list) else 'n/a', "items")
        return res
    except TypeError:
        res = paddle_inst.ocr(img)
        _log_ocr_run("paddle ocr produced (compat)",
                      len(res) if isinstance(res, list) else 'n/a', "items")
        return res


def _extract_lines_from_paddle_result(result):
    if not result:
        return []

    if (isinstance(result, list) and len(result) == 1
            and not isinstance(result[0], (list, tuple))):
        result = result[0]

    if isinstance(result, dict):
        texts = result.get('rec_texts') or result.get('texts')
        scores = result.get('rec_scores') or result.get('scores')
        box_keys = [
            'text_det_polys', 'det_polys', 'dt_polys', 'polys',
            'text_region_polys', 'boxes', 'dt_boxes', 'det_boxes',
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
            if (texts is not None and isinstance(boxes, (list, tuple))
                    and len(boxes) > 0):
                n = min(len(texts), len(boxes))
                for i in range(n):
                    pts = boxes[i]
                    if isinstance(pts, np.ndarray):
                        pts = pts.tolist()
                    if (pts and isinstance(pts[0], (int, float))
                            and len(pts) % 2 == 0):
                        pts = [[float(pts[j]), float(pts[j + 1])]
                               for j in range(0, len(pts), 2)]
                    pts = [[float(x), float(y)] for x, y in pts]
                    txt = str(texts[i])
                    scr = (float(scores[i])
                           if scores is not None and i < len(scores) else None)
                    flat.append((pts, txt, scr))
                return flat
            if texts is not None:
                return [
                    (None, str(t),
                     float(scores[i])
                     if scores is not None and i < len(scores) else None)
                    for i, t in enumerate(texts)
                ]
        except Exception:
            return []
        return []

    lines = result
    if (isinstance(result, list) and len(result) > 0
            and isinstance(result[0], list)
            and (len(result) == 1
                 or (result and isinstance(result[0][0], (list, tuple))))):
        lines = result[0]

    flat = []
    try:
        for item in lines:
            if not item:
                continue
            pts = item[0]
            txt, scr = None, None
            if (len(item) > 1 and isinstance(item[1], (list, tuple))
                    and len(item[1]) >= 2):
                txt, scr = item[1][0], float(item[1][1])
            flat.append((pts, txt, scr))
    except Exception as e:
        _log_ocr_run(f"Failed to parse PaddleOCR lines: {e}")
        return []
    return flat


def _get_manga_ocr():
    global _manga_ocr
    if not config.OCR_ALLOWED:
        _log_ocr_init("OCR disabled; MangaOCR not initialised")
        return None
    with _ocr_model_lock:
        if _manga_ocr is not None:
            return _manga_ocr
        return _init_manga_ocr()


def _init_manga_ocr():
    global _manga_ocr
    _transformers_preimport_done.wait(timeout=120)
    try:
        _fd_count = len(os.listdir('/dev/fd'))
        _log_ocr_init(f"Process FDs before MangaOCR init: {_fd_count}")
    except Exception:
        pass
    gc.collect()
    try:
        from manga_ocr import MangaOcr  # type: ignore
    except Exception as e:
        _log_ocr_init("MangaOCR import error", e)
        return None
    try:
        _log_ocr_init("Initializing MangaOCR")
        t0 = time.perf_counter()
        _manga_ocr = MangaOcr()
        t1 = time.perf_counter()
        _log_ocr_init(f"MangaOCR initialized in {t1 - t0:.2f}s")
        _process_stats("mangaocr_init")
    except Exception as e:
        _log_ocr_init("Failed to initialize MangaOCR", e)
        _manga_ocr = None
    return _manga_ocr


# ── Image helpers ──

def _opencv_detect_text_regions(np_img, prefer_vertical: bool = False):
    """Detect text regions using OpenCV morphological operations.

    Lightweight 'Ram Saver' detection path — avoids neural network loading.
    """
    import cv2  # type: ignore
    gray = cv2.cvtColor(np_img, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 15
    )

    if prefer_vertical:
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (4, 25))
        combined = cv2.dilate(binary, kernel, iterations=2)
    else:
        kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 8))
        dilated_h = cv2.dilate(binary, kernel_h, iterations=2)
        kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (8, 25))
        dilated_v = cv2.dilate(binary, kernel_v, iterations=2)
        combined = cv2.bitwise_or(dilated_h, dilated_v)

    contours, _ = cv2.findContours(
        combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    H, W = np_img.shape[:2]
    img_area = H * W
    min_area = img_area * 0.0005
    max_area = img_area * 0.95

    boxes = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = w * h
        if area < min_area or area > max_area:
            continue
        aspect = w / max(h, 1)
        if aspect > 30 or aspect < 0.03:
            continue
        box = [
            [float(x), float(y)],
            [float(x + w), float(y)],
            [float(x + w), float(y + h)],
            [float(x), float(y + h)],
        ]
        boxes.append(box)

    boxes.sort(key=lambda b: (b[0][1], b[0][0]))
    _log_ocr_run(f"OpenCV morphological detection found {len(boxes)} regions")
    return boxes


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
        rects.append({
            'min_x': min_x, 'max_x': max_x,
            'min_y': min_y, 'max_y': max_y,
            'w': max(w, 1), 'h': max(h, 1),
            'cx': (min_x + max_x) / 2.0,
            'cy': (min_y + max_y) / 2.0,
        })

    tall_count = sum(1 for r in rects if r['h'] > r['w'] * 1.3)
    if tall_count >= len(rects) * 0.5:
        _log_ocr_run(
            f"Vertical regroup: {tall_count}/{len(rects)} already vertical, "
            "skipping"
        )
        return boxes

    _log_ocr_run(
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

    widths = sorted(r['w'] for r in rects)
    median_w = widths[len(widths) // 2] if widths else 1.0
    x_thresh = median_w * 1.2

    for i in range(n):
        for j in range(i + 1, n):
            ri, rj = rects[i], rects[j]
            x_overlap = min(ri['max_x'], rj['max_x']) - max(ri['min_x'], rj['min_x'])
            if x_overlap >= -x_thresh:
                y_gap = max(0, max(ri['min_y'], rj['min_y']) - min(ri['max_y'], rj['max_y']))
                max_h = max(ri['h'], rj['h'])
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
        min_x = min(rects[i]['min_x'] for i in indices)
        max_x = max(rects[i]['max_x'] for i in indices)
        min_y = min(rects[i]['min_y'] for i in indices)
        max_y = max(rects[i]['max_y'] for i in indices)
        merged.append([
            [min_x, min_y], [max_x, min_y],
            [max_x, max_y], [min_x, max_y],
        ])

    _log_ocr_run(
        f"Vertical regroup: {len(boxes)} boxes → {len(merged)} columns"
    )
    return merged


def _load_image_from_inputs(
    file_bytes: bytes | None, image_base64: str | None
) -> Image.Image:
    if file_bytes is None and not image_base64:
        raise HTTPException(
            status_code=400,
            detail="No image provided. Send 'file' or 'image_base64'."
        )
    try:
        if file_bytes is not None:
            _log("Loading image from file bytes of length:", len(file_bytes))
            img = Image.open(io.BytesIO(file_bytes))
            _log("Loaded image: mode=", img.mode, " size=", img.size)
            return img.convert('RGB')
        else:
            raw_part = image_base64.split(',')[-1] if image_base64 else ''
            _log("Loading image from base64 of length:", len(raw_part))
            raw = base64.b64decode(raw_part)
            img = Image.open(io.BytesIO(raw))
            _log("Loaded image: mode=", img.mode, " size=", img.size)
            return img.convert('RGB')
    except Exception as e:
        _log("_load_image_from_inputs error:", e)
        _log(traceback.format_exc())
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
            scr = (float(scores[i])
                   if scores is not None and i < len(scores) else None)
            flat.append((pts, txt, scr))
    except Exception as e:
        _log_ocr_run("_extract_rapid_ocr_boxes error:", e)
    return flat


def _box_width(pts) -> float:
    try:
        xs = [p[0] for p in pts]
        return max(xs) - min(xs)
    except Exception:
        return 0.0


def _box_height(pts) -> float:
    try:
        ys = [p[1] for p in pts]
        return max(ys) - min(ys)
    except Exception:
        return 0.0


def _filter_furigana_boxes(
    boxes: list[list[list[float]]]
) -> list[list[list[float]]]:
    if not boxes:
        return boxes
    widths = [max(1.0, _box_width(b)) for b in boxes]
    try:
        med = statistics.median(widths)
    except statistics.StatisticsError:
        med = sum(widths) / max(1, len(widths))
    lo, hi = 0.6 * med, 1.8 * med
    filtered = []
    for b, w in zip(boxes, widths):
        h = _box_height(b)
        if h < 5:
            continue
        if lo <= w <= hi:
            filtered.append(b)
    return filtered


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


# ── Main endpoint ──

@router.post("/ocr", response_model=OcrResponse)
async def ocr_endpoint(
    file: UploadFile | None = File(None),
    image_base64: str | None = Form(None),
    turbo: str | None = Form(None),
    ram_saver: str | None = Form(None),
    dev_mode: str | None = Form(None),
    paddle_max_width: str | None = Form(None),
    paddle_max_height: str | None = Form(None),
):
    if not config.OCR_ALLOWED:
        raise HTTPException(status_code=403, detail="OCR disabled by user")

    is_turbo = turbo is None or turbo.lower() not in ("0", "false", "no")
    if ram_saver is not None:
        use_ram_saver = ram_saver.lower() in ("1", "true", "yes")
    else:
        use_ram_saver = config.OCR_RAM_SAVER

    is_dev = dev_mode is not None and dev_mode.lower() in ("1", "true", "yes")

    paddle_max_w: int | None = None
    paddle_max_h: int | None = None
    if paddle_max_width is not None:
        try:
            paddle_max_w = max(1, int(paddle_max_width))
        except (ValueError, TypeError):
            pass
    if paddle_max_height is not None:
        try:
            paddle_max_h = max(1, int(paddle_max_height))
        except (ValueError, TypeError):
            pass

    _log_ocr_run(f"Loading Neural Network (turbo={is_turbo})")
    _process_stats("ocr_req")
    _ocr_touch()
    try:
        t_total_start = time.perf_counter()
        file_bytes = await file.read() if file is not None else None
        image = _load_image_from_inputs(file_bytes, image_base64)
        np_img = np.array(image, dtype=np.uint8)
        if not np_img.flags['C_CONTIGUOUS']:
            np_img = np.ascontiguousarray(np_img)

        results: list[OcrBox] = []
        timing_detection_ms: float | None = None
        timing_detection_engine: str | None = None
        timing_recognition_ms: float | None = None
        timing_recognition_engine: str | None = None
        timing_per_box_ms: list[float] | None = None

        if is_turbo:
            # ── Turbo mode: RapidOCR ──
            import cv2 as _cv2
            np_img_bgr = _cv2.cvtColor(np_img, _cv2.COLOR_RGB2BGR)

            if config.LANGUAGE == 'ja':
                _log_ocr_run(
                    f"Japanese OCR — Turbo ON, "
                    f"Ram Saver {'ON' if use_ram_saver else 'OFF'}"
                )
                H, W = int(np_img.shape[0]), int(np_img.shape[1])

                if use_ram_saver:
                    t2 = time.perf_counter()
                    initial_boxes = _opencv_detect_text_regions(
                        np_img_bgr,
                        prefer_vertical=config.SUPPORTS_VERTICAL_TEXT
                    )
                    t3 = time.perf_counter()
                    _log_ocr_run(
                        f"OpenCV detection {t3 - t2:.2f}s, "
                        f"{len(initial_boxes)} boxes"
                    )
                    timing_detection_ms = (t3 - t2) * 1000
                    timing_detection_engine = "OpenCV"
                else:
                    t0 = time.perf_counter()
                    rapid = _get_rapid_ocr()
                    t1 = time.perf_counter()
                    if rapid is None:
                        raise HTTPException(
                            status_code=500,
                            detail="RapidOCR not available"
                        )
                    _log_ocr_run(
                        f"RapidOCR handle ready in {t1 - t0:.2f}s (turbo)"
                    )

                    det_img = np_img_bgr
                    scale = 1.0
                    if max(H, W) > 2000:
                        scale = 2000.0 / float(max(H, W))
                        new_w = max(1, int(W * scale))
                        new_h = max(1, int(H * scale))
                        _log_ocr_run(
                            f"Downscaling for detection "
                            f"{W}x{H}->{new_w}x{new_h} scale={scale:.3f}"
                        )
                        det_img = _cv2.resize(
                            np_img_bgr, (new_w, new_h),
                            interpolation=_cv2.INTER_AREA
                        )
                        if not det_img.flags['C_CONTIGUOUS']:
                            det_img = np.ascontiguousarray(det_img)

                    t2 = time.perf_counter()
                    det_result = rapid(
                        det_img, use_det=True, use_cls=False, use_rec=False
                    )
                    t3 = time.perf_counter()
                    _log_ocr_run(f"RapidOCR detection-only {t3 - t2:.2f}s")
                    timing_detection_ms = (t3 - t2) * 1000
                    timing_detection_engine = "RapidOCR"

                    initial_boxes = []
                    if (det_result is not None
                            and det_result.boxes is not None):
                        for pts in det_result.boxes:
                            if isinstance(pts, np.ndarray):
                                pts = pts.tolist()
                            initial_boxes.append(
                                [[float(x), float(y)] for x, y in pts]
                            )

                    if scale != 1.0 and initial_boxes:
                        inv = 1.0 / scale
                        initial_boxes = [
                            [[float(x) * inv, float(y) * inv]
                             for x, y in pts]
                            for pts in initial_boxes
                        ]
                    _log_ocr_run(
                        f"Found {len(initial_boxes)} boxes after rescale"
                    )

                if config.SUPPORTS_VERTICAL_TEXT and initial_boxes:
                    initial_boxes = _regroup_boxes_for_vertical_text(
                        initial_boxes
                    )

                _log_ocr_run("Recognizing text with MangaOCR...")
                mocr = _get_manga_ocr()
                if mocr is None:
                    raise HTTPException(
                        status_code=500, detail="MangaOCR not available"
                    )
                timing_recognition_engine = "MangaOCR"
                t_rec_start = time.perf_counter()
                per_box_times: list[float] = []
                if not initial_boxes:
                    try:
                        t_box_s = time.perf_counter()
                        full_txt = mocr(image) or ''
                        per_box_times.append(
                            (time.perf_counter() - t_box_s) * 1000
                        )
                        w, h = image.size
                        full_box = [
                            [0.0, 0.0], [float(w), 0.0],
                            [float(w), float(h)], [0.0, float(h)],
                        ]
                        results.append(OcrBox(
                            box=full_box, text=full_txt, score=None,
                            is_vertical=_is_box_vertical(full_box)
                        ))
                        _log_ocr_run(
                            f"Full-image fallback len={len(full_txt)}"
                        )
                    except Exception as e:
                        _log_ocr_run("Full-image fallback error", e)
                else:
                    for i, pts in enumerate(initial_boxes):
                        crop = _crop_by_box(image, pts)
                        t_box_s = time.perf_counter()
                        try:
                            txt = mocr(crop) or ''
                            _log_ocr_run(
                                f"Recognition progress "
                                f"{i + 1}/{len(initial_boxes)}"
                            )
                        except Exception as e:
                            _log_ocr_run(f"MangaOCR error box {i + 1}", e)
                            txt = ''
                        per_box_times.append(
                            (time.perf_counter() - t_box_s) * 1000
                        )
                        box_pts = [[float(x), float(y)] for x, y in pts]
                        results.append(OcrBox(
                            box=box_pts, text=txt, score=None,
                            is_vertical=_is_box_vertical(box_pts)
                        ))
                timing_recognition_ms = (
                    (time.perf_counter() - t_rec_start) * 1000
                )
                timing_per_box_ms = per_box_times
            else:
                # Non-Japanese turbo: RapidOCR end-to-end
                t0 = time.perf_counter()
                rapid = _get_rapid_ocr()
                t1 = time.perf_counter()
                if rapid is None:
                    raise HTTPException(
                        status_code=500, detail="RapidOCR not available"
                    )
                _log_ocr_run(
                    f"RapidOCR handle ready in {t1 - t0:.2f}s (turbo)"
                )
                _log_ocr_run("Recognizing text positions...")

                t2 = time.perf_counter()
                out = rapid(
                    np_img_bgr, use_det=True, use_cls=False, use_rec=True
                )
                t3 = time.perf_counter()
                _log_ocr_run(f"RapidOCR e2e {t3 - t2:.2f}s")
                timing_detection_ms = (t3 - t2) * 1000
                timing_detection_engine = "RapidOCR"
                timing_recognition_ms = (t3 - t2) * 1000
                timing_recognition_engine = "RapidOCR"

                lines = _extract_rapid_ocr_boxes(out)
                _log_ocr_run(f"Extracted {len(lines)} lines (e2e)")
                for i, (pts, txt, scr) in enumerate(lines):
                    if pts is None:
                        continue
                    if i % 25 == 0:
                        _log_ocr_run(
                            f"Recognition progress {i + 1}/{len(lines)}"
                        )
                    box_pts = [[float(x), float(y)] for x, y in pts]
                    results.append(OcrBox(
                        box=box_pts,
                        text=str(txt or ''),
                        score=(float(scr) if scr is not None else None),
                        is_vertical=_is_box_vertical(box_pts),
                    ))
        else:
            # ── Accurate mode: PaddleOCR ──
            if config.LANGUAGE == 'ja':
                _log_ocr_run(
                    f"Japanese OCR — Turbo OFF (PaddleOCR), "
                    f"Ram Saver {'ON' if use_ram_saver else 'OFF'}"
                )
                H, W = int(np_img.shape[0]), int(np_img.shape[1])

                if use_ram_saver:
                    import cv2 as _cv2
                    np_img_bgr = _cv2.cvtColor(np_img, _cv2.COLOR_RGB2BGR)
                    t2 = time.perf_counter()
                    initial_boxes = _opencv_detect_text_regions(
                        np_img_bgr,
                        prefer_vertical=config.SUPPORTS_VERTICAL_TEXT
                    )
                    t3 = time.perf_counter()
                    _log_ocr_run(
                        f"OpenCV detection {t3 - t2:.2f}s, "
                        f"{len(initial_boxes)} boxes"
                    )
                    timing_detection_ms = (t3 - t2) * 1000
                    timing_detection_engine = "OpenCV"
                else:
                    t0 = time.perf_counter()
                    paddle = _get_paddle_ocr()
                    t1 = time.perf_counter()
                    if paddle is None:
                        raise HTTPException(
                            status_code=500,
                            detail="PaddleOCR not available"
                        )
                    _log_ocr_run(
                        f"PaddleOCR handle ready in {t1 - t0:.2f}s"
                    )

                    det_img = np_img
                    scale = 1.0
                    effective_max_dim = 2000
                    if paddle_max_w is not None and paddle_max_h is not None:
                        effective_max_dim = max(paddle_max_w, paddle_max_h)
                    elif paddle_max_w is not None:
                        effective_max_dim = paddle_max_w
                    elif paddle_max_h is not None:
                        effective_max_dim = paddle_max_h
                    if max(H, W) > effective_max_dim:
                        scale = float(effective_max_dim) / float(max(H, W))
                        new_w = max(1, int(W * scale))
                        new_h = max(1, int(H * scale))
                        _log_ocr_run(
                            f"Downscaling for detection "
                            f"{W}x{H}->{new_w}x{new_h} scale={scale:.3f}"
                        )
                        det_img = np.ascontiguousarray(
                            np.array(
                                image.resize((new_w, new_h)),
                                dtype=np.uint8
                            )
                        )

                    t2 = time.perf_counter()
                    det = _paddle_run_ocr(paddle, det_img)
                    t3 = time.perf_counter()
                    _log_ocr_run(f"PaddleOCR detection {t3 - t2:.2f}s")
                    timing_detection_ms = (t3 - t2) * 1000
                    timing_detection_engine = "PaddleOCR"

                    lines = _extract_lines_from_paddle_result(det)
                    _log_ocr_run(
                        f"Extracted {len(lines)} lines (det stage)"
                    )
                    initial_boxes = [
                        item[0] for item in lines
                        if item and item[0] is not None
                    ]
                    if scale != 1.0 and initial_boxes:
                        inv = 1.0 / scale
                        initial_boxes = [
                            [[float(x) * inv, float(y) * inv]
                             for x, y in pts]
                            for pts in initial_boxes
                        ]
                    _log_ocr_run(
                        f"Found {len(initial_boxes)} boxes after rescale"
                    )

                _log_ocr_run("Recognizing text with MangaOCR...")
                mocr = _get_manga_ocr()
                if mocr is None:
                    raise HTTPException(
                        status_code=500, detail="MangaOCR not available"
                    )
                timing_recognition_engine = "MangaOCR"
                t_rec_start = time.perf_counter()
                per_box_times_acc: list[float] = []
                if not initial_boxes:
                    try:
                        t_box_s = time.perf_counter()
                        full_txt = mocr(image) or ''
                        per_box_times_acc.append(
                            (time.perf_counter() - t_box_s) * 1000
                        )
                        w, h = image.size
                        full_box = [
                            [0.0, 0.0], [float(w), 0.0],
                            [float(w), float(h)], [0.0, float(h)],
                        ]
                        results.append(OcrBox(
                            box=full_box, text=full_txt, score=None,
                            is_vertical=_is_box_vertical(full_box)
                        ))
                        _log_ocr_run(
                            f"Full-image fallback len={len(full_txt)}"
                        )
                    except Exception as e:
                        _log_ocr_run("Full-image fallback error", e)
                else:
                    for i, pts in enumerate(initial_boxes):
                        crop = _crop_by_box(image, pts)
                        t_box_s = time.perf_counter()
                        try:
                            txt = mocr(crop) or ''
                            _log_ocr_run(
                                f"Recognition progress "
                                f"{i + 1}/{len(initial_boxes)}"
                            )
                        except Exception as e:
                            _log_ocr_run(
                                f"MangaOCR error box {i + 1}", e
                            )
                            txt = ''
                        per_box_times_acc.append(
                            (time.perf_counter() - t_box_s) * 1000
                        )
                        box_pts = [[float(x), float(y)] for x, y in pts]
                        results.append(OcrBox(
                            box=box_pts, text=txt, score=None,
                            is_vertical=_is_box_vertical(box_pts)
                        ))
                timing_recognition_ms = (
                    (time.perf_counter() - t_rec_start) * 1000
                )
                timing_per_box_ms = per_box_times_acc
            else:
                # Non-Japanese accurate: PaddleOCR end-to-end
                t0 = time.perf_counter()
                paddle = _get_paddle_ocr()
                t1 = time.perf_counter()
                if paddle is None:
                    raise HTTPException(
                        status_code=500, detail="PaddleOCR not available"
                    )
                _log_ocr_run(
                    f"PaddleOCR handle ready in {t1 - t0:.2f}s"
                )
                _log_ocr_run("Recognizing text positions...")

                H_e2e, W_e2e = int(np_img.shape[0]), int(np_img.shape[1])
                paddle_img = np_img
                paddle_e2e_scale = 1.0
                if (paddle_max_w is not None
                        or paddle_max_h is not None):
                    eff_max = 2000
                    if (paddle_max_w is not None
                            and paddle_max_h is not None):
                        eff_max = max(paddle_max_w, paddle_max_h)
                    elif paddle_max_w is not None:
                        eff_max = paddle_max_w
                    else:
                        eff_max = paddle_max_h
                    if max(H_e2e, W_e2e) > eff_max:
                        paddle_e2e_scale = (
                            float(eff_max) / float(max(H_e2e, W_e2e))
                        )
                        nw = max(1, int(W_e2e * paddle_e2e_scale))
                        nh = max(1, int(H_e2e * paddle_e2e_scale))
                        _log_ocr_run(
                            f"Downscaling for PaddleOCR e2e "
                            f"{W_e2e}x{H_e2e}->{nw}x{nh} "
                            f"scale={paddle_e2e_scale:.3f}"
                        )
                        paddle_img = np.ascontiguousarray(
                            np.array(
                                image.resize((nw, nh)),
                                dtype=np.uint8
                            )
                        )

                t2 = time.perf_counter()
                out = _paddle_run_ocr(paddle, paddle_img)
                t3 = time.perf_counter()
                _log_ocr_run(f"PaddleOCR e2e {t3 - t2:.2f}s")
                timing_detection_ms = (t3 - t2) * 1000
                timing_detection_engine = "PaddleOCR"
                timing_recognition_ms = (t3 - t2) * 1000
                timing_recognition_engine = "PaddleOCR"

                lines = _extract_lines_from_paddle_result(out)
                _log_ocr_run(f"Extracted {len(lines)} lines (e2e)")
                inv_e2e = (
                    1.0 / paddle_e2e_scale
                    if paddle_e2e_scale != 1.0 else 1.0
                )
                for i, (pts, txt, scr) in enumerate(lines):
                    if pts is None:
                        continue
                    if i % 25 == 0:
                        _log_ocr_run(
                            f"Recognition progress {i + 1}/{len(lines)}"
                        )
                    if inv_e2e != 1.0:
                        box_pts = [
                            [float(x) * inv_e2e, float(y) * inv_e2e]
                            for x, y in pts
                        ]
                    else:
                        box_pts = [[float(x), float(y)] for x, y in pts]
                    results.append(OcrBox(
                        box=box_pts,
                        text=str(txt or ''),
                        score=(float(scr) if scr is not None else None),
                        is_vertical=_is_box_vertical(box_pts),
                    ))

        _log_ocr_run(f"Final boxes {len(results)}")
        _process_stats("ocr_done")
        t_total_end = time.perf_counter()
        response_data: dict = {
            "boxes": [r.model_dump(exclude_none=True) for r in results]
        }
        if is_dev:
            times = OcrProcessingTimes(
                total_ms=round((t_total_end - t_total_start) * 1000, 1),
                detection_ms=(round(timing_detection_ms, 1)
                              if timing_detection_ms is not None else None),
                detection_engine=timing_detection_engine,
                recognition_ms=(round(timing_recognition_ms, 1)
                                if timing_recognition_ms is not None
                                else None),
                recognition_engine=timing_recognition_engine,
                per_box_ms=([round(t, 1) for t in timing_per_box_ms]
                            if timing_per_box_ms else None),
            )
            response_data["processing_times"] = times.model_dump(
                exclude_none=True
            )
        return response_data
    except HTTPException:
        _log_ocr_run("/ocr http exception")
        raise
    except Exception as e:
        _log_ocr_run("Unhandled error", e)
        _log_ocr_run(traceback.format_exc())
        raise HTTPException(status_code=500, detail="OCR processing error")
