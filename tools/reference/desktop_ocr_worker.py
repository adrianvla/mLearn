"""Offline reference only: superseded packaged-Python detector/Manga executor.

Never launch this from v3, its installer, a sidecar or an inference fallback.
Preserved for reproducing historical CPU evidence and native-stage comparisons.
"""
from __future__ import annotations

import contextlib
import io
import json
import math
import os
from pathlib import Path
import resource
import sys
import time
from typing import Final

from pydantic import BaseModel, ConfigDict, Field

MAX_MESSAGE: Final = 192 * 1024


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    x: float
    y: float


class Quad(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    topLeft: Point
    topRight: Point
    bottomRight: Point
    bottomLeft: Point


class Crop(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    requestId: str
    sourceId: str
    contentRevision: str
    resourceId: str
    providerId: str
    recognitionLanguages: list[str]
    path: str
    mimeType: str
    pageIndex: int | None
    crop: Crop | None


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    plan: Plan
    modelsDirectory: str
    rasterizedPdf: bool = False


class Group(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    quad: Quad
    sources: list[int]


class Recognition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    groups: list[Group] = Field(max_length=512)


def receive() -> str:
    line = sys.stdin.buffer.readline(MAX_MESSAGE + 1)
    if not line or len(line) > MAX_MESSAGE or not line.endswith(b"\n"):
        raise RuntimeError("Missing or oversized native OCR stage message")
    return line.decode("utf-8")


def emit(protocol: io.TextIOBase, message: str) -> None:
    encoded = message.encode("utf-8")
    if len(encoded) > MAX_MESSAGE:
        raise RuntimeError("Native OCR output exceeds its stage bound")
    protocol.write(message + "\n")
    protocol.flush()


def main() -> None:
    # Framework output is never mixed with the framed JSON protocol. The host
    # concurrently drains stderr and rejects excess instead of deadlocking.
    with os.fdopen(os.dup(1), "w", encoding="utf-8") as protocol, contextlib.redirect_stdout(sys.stderr):
        os.dup2(2, 1)
        import numpy as np
        import torch
        from PIL import Image, ImageOps
        from paddleocr import TextDetection
        from manga_ocr.ocr import MangaOcrModel
        from transformers import AutoTokenizer, ViTImageProcessor

        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        request = Input.model_validate_json(receive())
        plan = request.plan
        models = Path(request.modelsDirectory)
        path = Path(plan.path)
        length = path.stat().st_size
        maximum_bytes = 64 * 1024 * 1024 if request.rasterizedPdf else 8 * 1024 * 1024
        if length <= 0 or length > maximum_bytes:
            raise RuntimeError("Selected source exceeds the 8 MiB byte bound")
        with path.open("rb") as stream:
            source = stream.read(maximum_bytes + 1)
        if len(source) != length:
            raise RuntimeError("Source changed while reading")
        if plan.pageIndex is not None:
            raise RuntimeError("PDF source must be rasterized by the admitted native helper")
        with Image.open(io.BytesIO(source)) as encoded:
            width, height = encoded.size
            if width < 1 or height < 1 or max(width, height) > 32768 or width * height > 16_777_216:
                raise RuntimeError("Decoded source exceeds the 16 megapixel bound")
            if getattr(encoded, "n_frames", 1) != 1:
                raise RuntimeError("OCR requires a single image frame")
            image = ImageOps.exif_transpose(encoded).convert("RGB")
        width, height = image.size
        selected = image
        actual_crop = None
        if plan.crop is not None:
            c = plan.crop
            if c.x + c.width > 1 or c.y + c.height > 1:
                raise RuntimeError("Crop is outside the upright source")
            left, top = math.floor(c.x * width), math.floor(c.y * height)
            right, bottom = math.ceil((c.x + c.width) * width), math.ceil((c.y + c.height) * height)
            selected = image.crop((left, top, right, bottom))
            actual_crop = {"x": left / width, "y": top / height, "width": (right-left) / width, "height": (bottom-top) / height}
        scale = min(1.0, 2000 / max(selected.size))
        detection_image = selected.resize((max(1, int(selected.width*scale)), max(1, int(selected.height*scale)))) if scale < 1 else selected
        initialization = time.perf_counter()
        detections: list[Quad] = []
        detector_ms = 0.0
        if plan.crop is None:
            detector = TextDetection(
                model_name="PP-OCRv6_medium_det", model_dir=str(models / "detector"),
                limit_side_len=64, limit_type="min", thresh=0.3, box_thresh=0.6, unclip_ratio=1.5,
                device="cpu", cpu_threads=1, enable_mkldnn=False,
            )
            initialized_ms = (time.perf_counter() - initialization) * 1000
            started = time.perf_counter()
            results = list(detector.predict(np.asarray(detection_image, dtype=np.uint8)))
            if len(results) != 1:
                raise RuntimeError("Detector did not return exactly one admitted image")
            polygons = results[0]["dt_polys"]
            if len(polygons) > 512:
                raise RuntimeError("Detector exceeded 512 observations")
            for polygon in polygons:
                points = np.asarray(polygon, dtype=float)
                if points.shape != (4, 2) or not np.isfinite(points).all():
                    raise RuntimeError("Detector returned unsupported geometry")
                # Preserve the original polygon and provider order. Recognition
                # grouping is a subsequent installed-package stage.
                mapped = [Point(x=float(x) / scale / width, y=float(y) / scale / height) for x, y in points]
                detections.append(Quad(topLeft=mapped[0], topRight=mapped[1], bottomRight=mapped[2], bottomLeft=mapped[3]))
            detector_ms = (time.perf_counter() - started) * 1000
            del detector
        else:
            initialized_ms = 0.0
        emit(protocol, json.dumps({"type": "detected", "width": width, "height": height, "crop": actual_crop,
            "detections": [q.model_dump() for q in detections],
            "metrics": {"detectorInitializationMs": initialized_ms, "detectorMs": detector_ms, "mode": "detector"}}, separators=(",", ":")))
        groups = Recognition.model_validate_json(receive()).groups
        raw: list[str] = []
        recognition_ms: list[float] = []
        model_initialization_ms = 0.0
        if groups:
            started = time.perf_counter()
            # Same retained model class, processor, tokenizer and generate call,
            # without MangaOcr's hidden example-image warmup or language rules.
            processor = ViTImageProcessor.from_pretrained(str(models / "manga"), local_files_only=True)
            tokenizer = AutoTokenizer.from_pretrained(str(models / "manga"), tokenizer_type="bert-japanese", local_files_only=True)
            model = MangaOcrModel.from_pretrained(str(models / "manga"), local_files_only=True)
            model_initialization_ms = (time.perf_counter() - started) * 1000
            for group in groups:
                points = [group.quad.topLeft, group.quad.topRight, group.quad.bottomRight, group.quad.bottomLeft]
                def pixel(value: float) -> int:
                    return round(value) if abs(value-round(value)) < 1e-7 else int(value)
                left = max(0, pixel(min(p.x for p in points) * width))
                top = max(0, pixel(min(p.y for p in points) * height))
                right = min(width, max(left + 1, pixel(max(p.x for p in points) * width)))
                bottom = min(height, max(top + 1, pixel(max(p.y for p in points) * height)))
                if left >= right or top >= bottom:
                    raise RuntimeError("Package crop lies outside original source")
                crop = image.crop((left, top, right, bottom)).convert("L").convert("RGB")
                started = time.perf_counter()
                x = processor(crop, return_tensors="pt").pixel_values.squeeze()
                generated = model.generate(x[None].to(model.device), max_length=300)[0].cpu()
                text = tokenizer.decode(generated, skip_special_tokens=True)
                raw.append(text)
                if sum(len(t.encode("utf-8")) for t in raw) > 32768:
                    raise RuntimeError("Recognition text exceeds 32 KiB")
                recognition_ms.append((time.perf_counter() - started) * 1000)
        emit(protocol, json.dumps({"type": "recognized", "rawRecognition": raw, "metrics": {
            "recognizerInitializationMs": model_initialization_ms, "recognitionMs": recognition_ms,
            "maximumRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        }}, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    main()
