import asyncio
import importlib
import json
import os
import sys
import time
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import voice


def _install_fake_qwen_tts(monkeypatch):
    """Install a fake qwen_tts module; returns the Qwen3TTSModel class."""
    created = []

    class FakeQwen3TTSModel:
        def __init__(self):
            self.device = None
            created.append(self)

        @classmethod
        def from_pretrained(cls, model_id):
            assert model_id == "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
            return cls()

        def to(self, device):
            self.device = device
            return self

    FakeQwen3TTSModel.created = created
    module = types.ModuleType("qwen_tts")
    module.Qwen3TTSModel = FakeQwen3TTSModel
    monkeypatch.setitem(sys.modules, "qwen_tts", module)
    return FakeQwen3TTSModel


def _hide_qwen_tts(monkeypatch):
    """Make qwen_tts unimportable even if it is installed in the test env."""
    monkeypatch.delitem(sys.modules, "qwen_tts", raising=False)
    real_import_module = importlib.import_module

    def _guarded_import(name, *args, **kwargs):
        if name == "qwen_tts":
            raise ImportError(name)
        return real_import_module(name, *args, **kwargs)

    monkeypatch.setattr(voice.importlib, "import_module", _guarded_import)


def _fake_torch(monkeypatch, *, cuda=False, mps=False):
    class FakeCuda:
        @staticmethod
        def is_available():
            return cuda

    class FakeMps:
        @staticmethod
        def is_available():
            return mps

    class FakeBackends:
        mps = FakeMps()

    fake = types.SimpleNamespace(cuda=FakeCuda(), backends=FakeBackends)
    monkeypatch.setattr(voice.config, "torch", fake)
    return fake


def _install_fake_soundfile(monkeypatch):
    writes = []

    class FakeSoundFile:
        @staticmethod
        def write(buf, data, samplerate, format=None, subtype=None):
            writes.append((data, samplerate, format, subtype))
            buf.write(b"RIFF-fake")

    monkeypatch.setitem(sys.modules, "soundfile", FakeSoundFile)
    return writes


def _qwen3_japanese_runtime(monkeypatch):
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "Japanese"} if language == "ja" else {},
    )


# ── Engine resolution chain ──


def test_resolve_tts_engine_prefers_mlx_qwen3_on_apple_silicon(monkeypatch):
    monkeypatch.setattr(voice, "_is_apple_silicon", lambda: True)
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "japanese"} if language == "ja" else {},
    )

    assert voice._resolve_tts_engine("ja", "qwen3") == "qwen3"


def test_resolve_tts_engine_uses_qwen3_torch_when_qwen_tts_installed(monkeypatch):
    monkeypatch.setattr(voice, "_is_apple_silicon", lambda: False)
    _install_fake_qwen_tts(monkeypatch)
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "japanese"} if language == "ja" else {},
    )

    assert voice._resolve_tts_engine("ja", "qwen3") == "qwen3-torch"


def test_resolve_tts_engine_falls_back_to_kokoro_without_qwen_tts(monkeypatch):
    monkeypatch.setattr(voice, "_is_apple_silicon", lambda: False)
    _hide_qwen_tts(monkeypatch)
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {
            "qwen3LanguageName": "japanese",
            "kokoroLangCode": "j",
        }
        if language == "ja"
        else {},
    )

    assert voice._resolve_tts_engine("ja", "qwen3") == "kokoro"


def test_resolve_tts_engine_raises_without_any_backend(monkeypatch):
    monkeypatch.setattr(voice, "_is_apple_silicon", lambda: False)
    _hide_qwen_tts(monkeypatch)
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "japanese"} if language == "ja" else {},
    )

    try:
        voice._resolve_tts_engine("ja", "qwen3")
    except RuntimeError as exc:
        assert "no Kokoro fallback" in str(exc)
    else:
        raise AssertionError("expected missing qwen3 backend to fail")


def test_resolve_tts_engine_cloud_provider_maps_to_qwen3_torch_on_non_apple(monkeypatch):
    monkeypatch.setattr(voice, "_is_apple_silicon", lambda: False)
    _install_fake_qwen_tts(monkeypatch)
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "english"} if language == "en" else {},
    )

    assert voice._resolve_tts_engine("en", "cloud") == "qwen3-torch"


# ── Loader ──


def test_qwen3_torch_loader_uses_cuda_when_available(monkeypatch):
    FakeModel = _install_fake_qwen_tts(monkeypatch)
    _fake_torch(monkeypatch, cuda=True)
    monkeypatch.setitem(sys.modules, "sox", types.ModuleType("sox"))
    monkeypatch.setattr(voice, "_qwen3_torch_download_info", lambda: (0, None))
    monkeypatch.setattr(voice, "_qwen3_torch_model", None)
    monkeypatch.setattr(voice, "_qwen3_torch_model_loading", False)
    monkeypatch.setattr(voice, "_voice_tts_progress", 0.0)

    model = voice._ensure_qwen3_torch_loaded()

    assert isinstance(model, FakeModel)
    assert model.device == "cuda"
    assert voice._qwen3_torch_model is model
    assert voice._qwen3_torch_model_loading is False


def test_qwen3_torch_loader_falls_back_to_cpu(monkeypatch):
    FakeModel = _install_fake_qwen_tts(monkeypatch)
    _fake_torch(monkeypatch, cuda=False)
    monkeypatch.setitem(sys.modules, "sox", types.ModuleType("sox"))
    monkeypatch.setattr(voice, "_qwen3_torch_download_info", lambda: (0, None))
    monkeypatch.setattr(voice, "_qwen3_torch_model", None)
    monkeypatch.setattr(voice, "_qwen3_torch_model_loading", False)
    monkeypatch.setattr(voice, "_voice_tts_progress", 0.0)

    model = voice._ensure_qwen3_torch_loaded()

    assert model.device == "cpu"


def test_qwen3_torch_loader_is_cached(monkeypatch):
    _install_fake_qwen_tts(monkeypatch)
    _fake_torch(monkeypatch, cuda=False)
    sentinel = object()
    monkeypatch.setattr(voice, "_qwen3_torch_model", sentinel)

    assert voice._ensure_qwen3_torch_loaded() is sentinel


# ── Voice clone prompt cache ──


def test_qwen3_torch_voice_prompt_cache_is_keyed_by_path_and_mtime(tmp_path):
    audio_path = tmp_path / "sample.wav"
    (tmp_path / "sample.txt").write_text("reference transcript", encoding="utf-8")
    audio_path.write_bytes(b"RIFF")
    voice._qwen3_torch_voice_prompts.clear()

    calls = []

    class FakeModel:
        def create_voice_clone_prompt(self, ref_audio, ref_text):
            calls.append((ref_audio, ref_text))
            return {"prompt": len(calls)}

    model = FakeModel()

    first = voice._qwen3_torch_voice_prompt(model, str(audio_path))
    second = voice._qwen3_torch_voice_prompt(model, str(audio_path))

    assert first == second
    assert calls == [(str(audio_path), "reference transcript")]

    future = time.time() + 30
    os.utime(audio_path, (future, future))

    third = voice._qwen3_torch_voice_prompt(model, str(audio_path))

    assert third != first
    assert len(calls) == 2
    assert voice._qwen3_torch_voice_prompts


def test_qwen3_torch_voice_prompt_is_none_without_sample():
    voice._qwen3_torch_voice_prompts.clear()

    assert voice._qwen3_torch_voice_prompt(object(), None) is None


# ── Full WAV generation ──


def test_qwen3_torch_full_wav_uses_plain_generate_without_voice_sample(monkeypatch):
    _fake_torch(monkeypatch, cuda=False)
    _install_fake_soundfile(monkeypatch)
    _qwen3_japanese_runtime(monkeypatch)

    generated = []

    class FakeModel:
        def generate(self, text, speed):
            generated.append((text, speed))
            return np.array([[0.1, -0.2, 0.3]], dtype=np.float32)

        def generate_voice_clone(self, **_kwargs):
            raise AssertionError("voice clone must not run without a voice sample")

    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: FakeModel())
    req = voice.TTSRequest(text="Hello.", language="ja", provider="qwen3")

    response = asyncio.run(voice._generate_tts_qwen3_torch(req, "ja"))

    assert generated == [("<|Japanese|>Hello.", 1.0)]
    assert response.body == b"RIFF-fake"
    assert response.media_type == "audio/wav"
    assert response.headers["x-sample-rate"] == "24000"
    assert json.loads(response.headers["x-sentence-boundaries"]) == [
        {"index": 0, "text": "Hello.", "sampleOffset": 0, "sampleCount": 3}
    ]


def test_qwen3_torch_full_wav_clones_voice_and_unwraps_sample_rate(tmp_path, monkeypatch):
    audio_path = tmp_path / "sample.wav"
    (tmp_path / "sample.txt").write_text("exact reference transcript", encoding="utf-8")
    audio_path.write_bytes(b"RIFF")
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    _fake_torch(monkeypatch, cuda=False)
    _install_fake_soundfile(monkeypatch)
    _qwen3_japanese_runtime(monkeypatch)
    voice._qwen3_torch_voice_prompts.clear()

    class FakeModel:
        def __init__(self):
            self.clone_kwargs = None

        def create_voice_clone_prompt(self, ref_audio, ref_text):
            return {"ref_audio": ref_audio, "ref_text": ref_text}

        def generate_voice_clone(self, text, voice_clone_prompt, speed):
            self.clone_kwargs = {
                "text": text,
                "voice_clone_prompt": voice_clone_prompt,
                "speed": speed,
            }
            return (np.array([0.5, -0.5, 0.25, -0.25]), 32000)

        def generate(self, **_kwargs):
            raise AssertionError("plain generate must not run when a clone prompt exists")

    model = FakeModel()
    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: model)
    req = voice.TTSRequest(
        text="こんにちは。",
        language="ja",
        provider="qwen3",
        voiceSamplePath=str(audio_path),
        speed=0.9,
    )

    response = asyncio.run(voice._generate_tts_qwen3_torch(req, "ja"))

    assert model.clone_kwargs["text"] == "<|Japanese|>こんにちは。"
    assert model.clone_kwargs["voice_clone_prompt"] == {
        "ref_audio": str(audio_path),
        "ref_text": "exact reference transcript",
    }
    assert model.clone_kwargs["speed"] == 0.9
    assert response.headers["x-sample-rate"] == "32000"
    assert json.loads(response.headers["x-sentence-boundaries"]) == [
        {"index": 0, "text": "こんにちは。", "sampleOffset": 0, "sampleCount": 4}
    ]


def test_qwen3_torch_full_wav_requires_transcript_for_cloning(tmp_path, monkeypatch):
    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"RIFF")
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    _fake_torch(monkeypatch, cuda=False)
    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: object())
    req = voice.TTSRequest(
        text="Hello.",
        language="ja",
        provider="qwen3",
        voiceSamplePath=str(audio_path),
    )

    try:
        asyncio.run(voice._generate_tts_qwen3_torch(req, "ja"))
    except RuntimeError as exc:
        assert "transcribed voice sample" in str(exc)
    else:
        raise AssertionError("expected missing transcript to fail")


# ── Sentence-level streaming ──


def test_qwen3_torch_streaming_yields_per_sentence_chunks(monkeypatch):
    _fake_torch(monkeypatch, cuda=False)
    _qwen3_japanese_runtime(monkeypatch)
    monkeypatch.setattr(
        voice.config,
        "language_text_processing_config_for_language",
        lambda language: {"sentenceTerminators": ["。"]} if language == "ja" else {},
    )

    texts = []

    class FakeModel:
        def generate(self, text, speed):
            texts.append((text, speed))
            return np.array([float(len(texts))] * 4, dtype=np.float32)

    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: FakeModel())
    req = voice.TTSRequest(
        text="こんにちは。元気ですか。はい。",
        language="ja",
        provider="qwen3",
        speed=1.2,
    )

    chunks = list(voice._iter_qwen3_torch_tts_chunks(req, "ja"))

    assert [chunk["chunkIndex"] for chunk in chunks] == [0, 1, 2]
    assert [chunk["isFinal"] for chunk in chunks] == [False, False, True]
    assert all(chunk["sampleRate"] == 24000 for chunk in chunks)
    assert all(chunk["audio"].dtype.name == "float32" for chunk in chunks)
    assert texts == [
        ("<|Japanese|>こんにちは。", 1.2),
        ("<|Japanese|>元気ですか。", 1.2),
        ("<|Japanese|>はい。", 1.2),
    ]


def test_qwen3_torch_streaming_uses_clone_prompt_per_sentence(tmp_path, monkeypatch):
    audio_path = tmp_path / "sample.wav"
    (tmp_path / "sample.txt").write_text("reference transcript", encoding="utf-8")
    audio_path.write_bytes(b"RIFF")
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    _fake_torch(monkeypatch, cuda=False)
    _qwen3_japanese_runtime(monkeypatch)
    monkeypatch.setattr(
        voice.config,
        "language_text_processing_config_for_language",
        lambda language: {"sentenceTerminators": ["。"]} if language == "ja" else {},
    )
    voice._qwen3_torch_voice_prompts.clear()

    class FakeModel:
        def __init__(self):
            self.clone_calls = 0

        def create_voice_clone_prompt(self, ref_audio, ref_text):
            return {"ref_audio": ref_audio}

        def generate_voice_clone(self, text, voice_clone_prompt, speed):
            self.clone_calls += 1
            return np.zeros(2, dtype=np.float32)

        def generate(self, **_kwargs):
            raise AssertionError("plain generate must not run when cloning")

    model = FakeModel()
    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: model)
    req = voice.TTSRequest(
        text="こんにちは。はい。",
        language="ja",
        provider="qwen3",
        voiceSamplePath=str(audio_path),
    )

    chunks = list(voice._iter_qwen3_torch_tts_chunks(req, "ja"))

    assert model.clone_calls == 2
    assert [chunk["isFinal"] for chunk in chunks] == [False, True]


# ── WebSocket streaming dispatch ──


def test_voice_tts_stream_websocket_dispatches_to_torch_generator(monkeypatch):
    used = []
    monkeypatch.setattr(
        voice, "_resolve_tts_engine", lambda _language, _provider=None: "qwen3-torch"
    )
    monkeypatch.setattr(voice, "_qwen3_torch_model", object())

    def fake_torch_chunks(_req, _language):
        used.append("torch")
        yield {
            "audio": voice.np.asarray([0.25, -0.25], dtype=voice.np.float32),
            "sampleRate": 24000,
            "chunkIndex": 0,
            "isFinal": True,
        }

    def fail_mlx_chunks(*_args, **_kwargs):
        raise AssertionError("mlx generator must not run for qwen3-torch")

    monkeypatch.setattr(voice, "_iter_qwen3_torch_tts_chunks", fake_torch_chunks)
    monkeypatch.setattr(voice, "_iter_qwen3_tts_chunks", fail_mlx_chunks)

    app = FastAPI()
    app.include_router(voice.router)

    with TestClient(app).websocket_connect("/voice/tts/stream") as websocket:
        websocket.send_json({"text": "Hello.", "language": "en", "provider": "qwen3"})
        status = websocket.receive_json()
        audio_meta = websocket.receive_json()
        audio_bytes = websocket.receive_bytes()
        done = websocket.receive_json()

    assert used == ["torch"]
    assert status["type"] == "status"
    assert status["generating"] is True
    assert status["modelLoading"] is False
    assert audio_meta["sampleRate"] == 24000
    assert audio_meta["chunkIndex"] == 0
    assert audio_meta["tokenCount"] == 0
    assert audio_meta["isFinal"] is True
    assert voice.np.frombuffer(audio_bytes, dtype="<f4").tolist() == [0.25, -0.25]
    assert done == {"type": "done"}


# ── Status endpoints ──


def test_tts_status_reports_qwen3_torch_engine(monkeypatch):
    _install_fake_qwen_tts(monkeypatch)
    _fake_torch(monkeypatch, cuda=True)
    monkeypatch.setattr(
        voice, "_resolve_tts_engine", lambda _language, _provider=None: "qwen3-torch"
    )
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)
    monkeypatch.setattr(voice, "_qwen3_torch_model", object())
    monkeypatch.setattr(voice, "_qwen3_torch_model_loading", False)
    monkeypatch.setattr(voice, "_voice_tts_downloading", False)
    monkeypatch.setattr(voice, "_voice_tts_progress", 1.0)

    result = asyncio.run(voice.voice_tts_status("ja"))

    assert result["downloaded"] is True
    assert result["loaded"] is True
    assert result["downloading"] is False
    assert result["modelLoading"] is False
    assert result["modelName"] == "Qwen3-TTS-12Hz-1.7B-Torch"
    assert result["device"] == "cuda"


def test_tts_status_reports_qwen3_torch_not_downloaded_without_qwen_tts(monkeypatch):
    _hide_qwen_tts(monkeypatch)
    _fake_torch(monkeypatch, cuda=False)
    monkeypatch.setattr(
        voice, "_resolve_tts_engine", lambda _language, _provider=None: "qwen3-torch"
    )
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)
    monkeypatch.setattr(voice, "_qwen3_torch_model", None)
    monkeypatch.setattr(voice, "_qwen3_torch_model_loading", False)
    monkeypatch.setattr(voice, "_voice_tts_downloading", False)
    monkeypatch.setattr(voice, "_voice_tts_progress", 0.0)

    result = asyncio.run(voice.voice_tts_status("ja"))

    assert result["downloaded"] is False
    assert result["loaded"] is False
    assert result["modelName"] == "Qwen3-TTS-12Hz-1.7B-Torch"
    assert result["device"] == "cpu"


def test_tts_status_reports_kokoro_device_from_torch(monkeypatch):
    _fake_torch(monkeypatch, cuda=False, mps=True)
    monkeypatch.setattr(
        voice, "_resolve_tts_engine", lambda _language, _provider=None: "kokoro"
    )
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)
    monkeypatch.setattr(voice, "_kokoro_lang_code", lambda _language: "a")
    monkeypatch.setattr(voice, "_voice_tts_downloading", False)
    monkeypatch.setattr(voice, "_voice_tts_progress", 0.5)

    result = asyncio.run(voice.voice_tts_status("ja"))

    assert result["modelName"] == "Kokoro-82M"
    assert result["device"] == "mps"
