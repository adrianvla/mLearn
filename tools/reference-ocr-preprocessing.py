"""Offline reference only. Never imported or launched by the application.

Capture the installed original MangaOCR processor without loading model weights.
The synthetic color/scale cases expose luminance, antialiasing and rounding.
"""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, __version__ as pillow_version
from transformers import ViTImageProcessor

processor = ViTImageProcessor.from_pretrained(Path(sys.argv[1]), local_files_only=True)
cases = []
for width, height in [(2, 1), (7, 13), (451, 229), (224, 224)]:
    pixels = bytes(
        value
        for y in range(height)
        for x in range(width)
        for value in [(17*x + 31*y) % 256, (97*x + 3*y) % 256, (7*x + 113*y) % 256]
    )
    image = Image.frombytes("RGB", (width, height), pixels).convert("L").convert("RGB")
    resized = image.resize((224, 224), Image.Resampling.BILINEAR)
    gray = bytes(resized.getdata(0))
    tensor = processor(image, return_tensors="np").pixel_values.astype("<f4")
    cases.append({
        "width": width, "height": height,
        "graySha256": hashlib.sha256(gray).hexdigest(),
        "tensorSha256": hashlib.sha256(tensor.tobytes()).hexdigest(),
    })
print(json.dumps({"pillow": pillow_version, "processor": type(processor).__name__, "cases": cases}, indent=2))
