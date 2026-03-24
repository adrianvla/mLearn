#!/usr/bin/env python3
"""
MOSS-TTS-Realtime remote server.

Runs on a CUDA-capable machine and exposes a
simple HTTP endpoint compatible with the mLearn TTS API.

Usage:
    # On the GPU machine (requires MOSS-TTS-Realtime installed):
    pip install --extra-index-url https://download.pytorch.org/whl/cu128 torch torchaudio
    git clone https://github.com/OpenMOSS/MOSS-TTS.git && cd MOSS-TTS && pip install -e .
    python moss_tts_server.py --host 0.0.0.0 --port 7760

    # In the mLearn app settings, set TTS provider to "remote" and
    # enter the server IP:port (e.g. 192.168.1.100:7760).

Endpoints:
    POST /voice/tts        - Generate TTS audio (same contract as mLearn backend)
    GET  /voice/tts/status - Check model status
    GET  /health           - Health check
"""

import argparse
import io
import json
import logging
import os
import time
import importlib.util

import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("moss-tts-server")

app = FastAPI(title="MOSS-TTS Remote Server")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
_model = None
_tokenizer = None
_codec = None
_inferencer = None
_loading = False
CODEC_SAMPLE_RATE = 24000


def _resolve_attn_implementation(device: str, dtype: torch.dtype) -> str:
    if (
        device == "cuda"
        and importlib.util.find_spec("flash_attn") is not None
        and dtype in {torch.float16, torch.bfloat16}
    ):
        major, _ = torch.cuda.get_device_capability()
        if major >= 8:
            return "flash_attention_2"
    if device == "cuda":
        return "sdpa"
    return "eager"


def load_model():
    global _model, _tokenizer, _codec, _inferencer, _loading
    if _model is not None:
        return
    _loading = True
    try:
        from transformers import AutoTokenizer, AutoModel
        from mossttsrealtime.modeling_mossttsrealtime import MossTTSRealtime

        # Import inferencer from the moss_tts_realtime package
        from moss_tts_realtime.inferencer import MossTTSRealtimeInference

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if device == "cuda" else torch.float32
        attn = _resolve_attn_implementation(device, dtype)

        log.info(
            f"Loading MOSS-TTS-Realtime on {device} (dtype={dtype}, attn={attn})..."
        )

        _model = MossTTSRealtime.from_pretrained(
            "OpenMOSS-Team/MOSS-TTS-Realtime",
            attn_implementation=attn,
            torch_dtype=dtype,
        ).to(device)

        _tokenizer = AutoTokenizer.from_pretrained("OpenMOSS-Team/MOSS-TTS-Realtime")

        _codec = (
            AutoModel.from_pretrained(
                "OpenMOSS-Team/MOSS-Audio-Tokenizer",
                trust_remote_code=True,
            )
            .eval()
            .to(device)
        )

        _inferencer = MossTTSRealtimeInference(
            _model,
            _tokenizer,
            max_length=5000,
            codec=_codec,
            codec_sample_rate=CODEC_SAMPLE_RATE,
            codec_encode_kwargs={"chunk_duration": 8},
        )

        log.info("MOSS-TTS-Realtime loaded successfully.")
    except Exception as e:
        log.error(f"Failed to load model: {e}")
        raise
    finally:
        _loading = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _validate_voice_sample_path(path_str: Optional[str]) -> Optional[str]:
    """Reject paths containing traversal sequences; return resolved path or None."""
    if not path_str:
        return None
    resolved = os.path.realpath(path_str)
    if ".." in path_str.split(os.sep):
        raise HTTPException(status_code=400, detail="Invalid voice sample path")
    if not os.path.exists(resolved):
        return None
    return resolved


class TTSRequest(BaseModel):
    text: str
    language: str = "en"
    voiceSamplePath: Optional[str] = None
    speed: float = 1.0


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None}


@app.get("/voice/tts/status")
async def tts_status():
    return {
        "downloaded": True,
        "loaded": _model is not None,
        "downloading": False,
        "progress": 1.0 if _model is not None else 0.0,
        "modelName": "MOSS-TTS-Realtime",
        "loading": _loading,
    }


def _split_into_sentences(text: str) -> list:
    import re

    sentences = re.split(r"(?<=[.!?。！？])\s*", text)
    return [s.strip() for s in sentences if s.strip()]


@app.post("/voice/tts")
async def tts_generate(req: TTSRequest):
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    device = "cuda" if torch.cuda.is_available() else "cpu"

    sentences = _split_into_sentences(req.text)
    if not sentences:
        sentences = [req.text]

    all_wavs = []
    sentence_boundaries = []
    sample_offset = 0

    for i, sentence in enumerate(sentences):
        ref_path = _validate_voice_sample_path(req.voiceSamplePath) or ""

        result = _inferencer.generate(
            text=[sentence],
            reference_audio_path=[ref_path],
            temperature=0.8,
            top_p=0.6,
            top_k=30,
            repetition_penalty=1.1,
            repetition_window=50,
            device=device,
        )

        for generated_tokens in result:
            output = torch.tensor(generated_tokens).to(device)
            decode_result = _codec.decode(output.permute(1, 0), chunk_duration=8)
            wav = decode_result["audio"][0].cpu().detach()

            if wav.dim() == 1:
                wav = wav.unsqueeze(0)

            num_samples = wav.shape[-1]
            sentence_boundaries.append(
                {
                    "index": i,
                    "text": sentence,
                    "sampleOffset": sample_offset,
                    "sampleCount": num_samples,
                }
            )
            sample_offset += num_samples
            all_wavs.append(wav)

    if not all_wavs:
        raise HTTPException(status_code=500, detail="No audio generated")

    combined = torch.cat(all_wavs, dim=-1)
    buf = io.BytesIO()
    torchaudio.save(buf, combined, CODEC_SAMPLE_RATE, format="wav")
    buf.seek(0)

    from starlette.responses import Response

    return Response(
        content=buf.read(),
        media_type="audio/wav",
        headers={
            "X-Sentence-Boundaries": json.dumps(sentence_boundaries),
            "X-Sample-Rate": str(CODEC_SAMPLE_RATE),
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MOSS-TTS-Realtime remote server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--port", type=int, default=7760, help="Port")
    parser.add_argument(
        "--no-preload", action="store_true", help="Don't load model at startup"
    )
    args = parser.parse_args()

    if not args.no_preload:
        load_model()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)
