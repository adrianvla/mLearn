"""Offline historical reference only; never a v3 model-test executor."""
import contextlib
import json
import os
from pathlib import Path
import sys
import time


def main() -> None:
    with os.fdopen(os.dup(1),"w",encoding="utf-8") as protocol, contextlib.redirect_stdout(sys.stderr):
        os.dup2(2,1)
        import numpy as np
        import torch
        import manga_ocr
        from manga_ocr.ocr import MangaOcrModel
        from paddleocr import TextDetection
        from PIL import Image
        from transformers import ViTImageProcessor,AutoTokenizer

        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        models=Path(sys.argv[1])
        started=time.perf_counter()
        image=Image.open(Path(manga_ocr.__file__).parent/"assets/example.jpg").convert("RGB")
        detector=TextDetection(model_name="PP-OCRv6_medium_det",model_dir=str(models/"detector"),
            limit_side_len=64,limit_type="min",thresh=0.3,box_thresh=0.6,unclip_ratio=1.5,
            device="cpu",cpu_threads=1,enable_mkldnn=False)
        detected=list(detector.predict(np.asarray(image,dtype=np.uint8)))[0]
        processor=ViTImageProcessor.from_pretrained(str(models/"manga"),local_files_only=True)
        tokenizer=AutoTokenizer.from_pretrained(str(models/"manga"),tokenizer_type="bert-japanese",local_files_only=True)
        model=MangaOcrModel.from_pretrained(str(models/"manga"),local_files_only=True)
        pixels=processor(image.convert("L").convert("RGB"),return_tensors="pt").pixel_values.squeeze()
        tokens=model.generate(pixels[None].to(model.device),max_length=300)[0].cpu()
        text=tokenizer.decode(tokens,skip_special_tokens=True)
        if not text:
            raise RuntimeError("Explicit model test returned no recognition")
        protocol.write(json.dumps({"detectedRegions":len(detected["dt_polys"]),"rawRecognition":text,"elapsedMs":(time.perf_counter()-started)*1000},ensure_ascii=False))
        protocol.flush()


if __name__=="__main__":
    main()
