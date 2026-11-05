"""Owned high-frequency original-pixel fixture and exact display verification."""
import base64
import hashlib
import io
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops


def main() -> None:
    mode,path=sys.argv[1:]
    target=Path(path)
    match mode:
        case "prepare":
            target.parent.mkdir(parents=True,exist_ok=True)
            image=Image.new("RGB",(3000,1000))
            row=bytes([0,0,0,255,255,255])*1500
            image.frombytes(row*1000)
            image.save(target)
            Image.new("RGB",(600,300),"white").save(target.parent/"blank.png")
            print("PIXEL_FIXTURE "+hashlib.sha256(target.read_bytes()).hexdigest(),flush=True)
        case "check":
            report=json.loads(target.read_text())
            source=Image.open(target.parent/"large-native.png").convert("RGB")
            expected=source.crop((2250,250,2625,500))
            actual=Image.open(io.BytesIO(base64.b64decode(report["nativePixelDisplayUri"].split(",",1)[1]))).convert("RGB")
            if actual.size!=expected.size or ImageChops.difference(actual,expected).getbbox() is not None:
                raise RuntimeError("Magnifier is not an exact crop of original source pixels")
            actual.save(target.parent/"native-pixel-display.png")
            print(f"NATIVE_PIXELS_VERIFIED {actual.width}x{actual.height} exact=True",flush=True)
        case _:
            raise RuntimeError("Usage: desktop_ocr.py prepare|check PATH")


if __name__=="__main__":
    main()
