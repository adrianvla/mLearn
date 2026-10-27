"""Same-input retained full Paddle versus detector-only and Manga stage proof."""
from pathlib import Path
import hashlib
import json
import resource
import sys
import time

import numpy as np
import torch
from PIL import Image
from paddleocr import PaddleOCR, TextDetection
from manga_ocr.ocr import MangaOcr, post_process
from transformers import ViTImageProcessor, AutoTokenizer
from manga_ocr.ocr import MangaOcrModel


def main() -> None:
    """All source/model paths are explicit read-only probe inputs."""
    model_root, manga_path, fixtures, output = map(Path,sys.argv[1:])
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    kwargs={"device":"cpu","cpu_threads":1,"enable_mkldnn":False}
    full=PaddleOCR(text_detection_model_name="PP-OCRv6_medium_det",text_detection_model_dir=str(model_root/"PP-OCRv6_medium_det"),
        text_recognition_model_name="PP-OCRv6_medium_rec",text_recognition_model_dir=str(model_root/"PP-OCRv6_medium_rec"),
        textline_orientation_model_name="PP-LCNet_x1_0_textline_ori",textline_orientation_model_dir=str(model_root/"PP-LCNet_x1_0_textline_ori"),
        use_angle_cls=True,use_doc_orientation_classify=False,use_doc_unwarping=False,
        text_det_limit_side_len=64,text_det_limit_type="min",text_det_thresh=0.3,text_det_box_thresh=0.6,text_det_unclip_ratio=1.5,**kwargs)
    detector=TextDetection(model_name="PP-OCRv6_medium_det",model_dir=str(model_root/"PP-OCRv6_medium_det"),
        limit_side_len=64,limit_type="min",thresh=0.3,box_thresh=0.6,unclip_ratio=1.5,**kwargs)
    evidence=[]
    for filename in ["vertical-ruby.png","horizontal-mixed.png","low-contrast-glare.png","spread.png","spread-right-crop.png","no-text.png"]:
        image=Image.open(fixtures/filename).convert("RGB")
        pixels=np.asarray(image,dtype=np.uint8)
        started=time.perf_counter()
        baseline=list(full.predict(pixels))[0]
        full_ms=(time.perf_counter()-started)*1000
        started=time.perf_counter()
        optimized=list(detector.predict(pixels))[0]
        detector_ms=(time.perf_counter()-started)*1000
        original=np.asarray(baseline["dt_polys"])
        actual=np.asarray(optimized["dt_polys"])
        # Pure detector API may order polygons differently. Record both orders;
        # the production worker must retain whichever actual API produced them.
        equivalent=original.shape==actual.shape and np.array_equal(original,actual)
        geometry_equivalent=sorted(tuple(p.ravel()) for p in original)==sorted(tuple(p.ravel()) for p in actual)
        evidence.append({"file":filename,"inputSha256":hashlib.sha256((fixtures/filename).read_bytes()).hexdigest(),
            "fullPolygons":original.tolist(),"detectorPolygons":actual.tolist(),"exactStageEquivalent":equivalent,"geometryEquivalent":geometry_equivalent,"fullMs":full_ms,"detectorMs":detector_ms,
            "fullText":baseline["rec_texts"]})
        print(f"COMPARE {filename} equal={equivalent} full_ms={full_ms:.1f} detector_ms={detector_ms:.1f}",flush=True)
        if not equivalent:
            print("DIFFERENCE "+json.dumps({"full":original.tolist(),"detector":actual.tolist()}),flush=True)
    del full,detector
    baseline=MangaOcr(str(manga_path),force_cpu=True)
    processor=ViTImageProcessor.from_pretrained(str(manga_path),local_files_only=True)
    tokenizer=AutoTokenizer.from_pretrained(str(manga_path),tokenizer_type="bert-japanese",local_files_only=True)
    model=MangaOcrModel.from_pretrained(str(manga_path),local_files_only=True)
    crops=[
        ("vertical-ruby.png",(307,35,348,297)),
        ("horizontal-mixed.png",(40,39,414,74)),
        ("spread.png",(537,55,778,89)),
    ]
    for filename,bounds in crops:
        crop=Image.open(fixtures/filename).convert("RGB").crop(bounds)
        expected=baseline(crop)
        x=processor(crop.convert("L").convert("RGB"),return_tensors="pt").pixel_values.squeeze()
        tokens=model.generate(x[None].to(model.device),max_length=300)[0].cpu()
        raw=tokenizer.decode(tokens,skip_special_tokens=True)
        actual=post_process(raw)
        if expected!=actual: raise RuntimeError("Direct model generation changed retained Manga output")
        evidence.append({"file":filename,"crop":bounds,"rawRecognition":raw,"expectedPostprocess":expected,"directGenerationEquivalent":True})
        print(f"MANGA {filename} equal=True text={actual}",flush=True)
    evidence.append({"maximumRssBytes":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
    output.write_text(json.dumps(evidence,ensure_ascii=False,separators=(",",":")))
    print("STAGES_COMPARED detectorGeometryEquivalent="+str(all(e.get("geometryEquivalent",True) for e in evidence))+" mangaEquivalent=True",flush=True)


if __name__=="__main__":
    main()
