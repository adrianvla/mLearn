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
    """Install a fake qwen_tts module mirroring the real qwen-tts==0.1.1 API.

    Real API (wheel source): Qwen3TTSModel.from_pretrained(repo, **kwargs)
    forwards kwargs to AutoModel.from_pretrained (device_map=, dtype=) and the
    wrapper has NO .to() — so the fake deliberately omits it to catch drift.
    """
    created = []

    class FakeQwen3TTSModel:
        def __init__(self):
            self.from_pretrained_kwargs = None
            created.append(self)

        @classmethod
        def from_pretrained(cls, model_id, **kwargs):
            assert model_id == "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
            instance = cls()
            instance.from_pretrained_kwargs = dict(kwargs)
            return instance

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

    fake = types.SimpleNamespace(
        cuda=FakeCuda(),
        backends=FakeBackends(),
        bfloat16="bf16-sentinel",
        float32="f32-sentinel",
    )
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


class FakeCloneModel:
    """Fake mirroring the real qwen-tts==0.1.1 generation surface.

    Real API: create_voice_clone_prompt(ref_audio, ref_text) ->
    List[VoiceClonePromptItem]; generate_voice_clone(text, language=None,
    ref_audio=None, ref_text=None, x_vector_only_mode=False,
    voice_clone_prompt=None, non_streaming_mode=False, **kwargs) ->
    Tuple[List[np.ndarray], int]. There is no `speed` and no bare generate().
    """

    sample_rate = 24000

    def __init__(self):
        self.prompt_calls = []
        self.clone_calls = []

    def create_voice_clone_prompt(self, ref_audio, ref_text=None, x_vector_only_mode=False):
        self.prompt_calls.append({"ref_audio": ref_audio, "ref_text": ref_text})
        return [{"ref_audio": ref_audio, "ref_text": ref_text}]

    def generate_voice_clone(
        self,
        text,
        language=None,
        ref_audio=None,
        ref_text=None,
        x_vector_only_mode=False,
        voice_clone_prompt=None,
        non_streaming_mode=False,
        **kwargs,
    ):
        self.clone_calls.append(
            {
                "text": text,
                "language": language,
                "voice_clone_prompt": voice_clone_prompt,
                "non_streaming_mode": non_streaming_mode,
                **kwargs,
            }
        )
        texts = text if isinstance(text, list) else [text]
        wavs = [
            np.full(4, float(i + 1), dtype=np.float32) for i in range(len(texts))
        ]
        return wavs, self.sample_rate


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


def test_qwen3_torch_loader_passes_device_and_dtype_to_from_pretrained(monkeypatch):
    FakeModel = _install_fake_qwen_tts(monkeypatch)
    _fake_torch(monkeypatch, cuda=True)
    monkeypatch.setitem(sys.modules, "sox", types.ModuleType("sox"))
    monkeypatch.setattr(voice, "_qwen3_torch_download_info", lambda: (0, None))
    monkeypatch.setattr(voice, "_qwen3_torch_model", None)
    monkeypatch.setattr(voice, "_qwen3_torch_model_loading", False)
    monkeypatch.setattr(voice, "_voice_tts_progress", 0.0)

    model = voice._ensure_qwen3_torch_loaded()

    assert isinstance(model, FakeModel)
    # Real API: placement happens in from_pretrained kwargs, there is no .to().
    assert model.from_pretrained_kwargs == {"device_map": "cuda", "dtype": "bf16-sentinel"}
    assert voice._qwen3_torch_model is model
    assert voice._qwen3_torch_model_loading is False


def test_qwen3_torch_loader_falls_back_to_cpu_fp32(monkeypatch):
    _install_fake_qwen_tts(monkeypatch)
    _fake_torch(monkeypatch, cuda=False)
    monkeypatch.setitem(sys.modules, "sox", types.ModuleType("sox"))
    monkeypatch.setattr(voice, "_qwen3_torch_download_info", lambda: (0, None))
    monkeypatch.setattr(voice, "_qwen3_torch_model", None)
    monkeypatch.setattr(voice, "_qwen3_torch_model_loading", False)
    monkeypatch.setattr(voice, "_voice_tts_progress", 0.0)

    model = voice._ensure_qwen3_torch_loaded()

    assert model.from_pretrained_kwargs == {"device_map": "cpu", "dtype": "f32-sentinel"}


def test_qwen3_torch_loader_is_cached(monkeypatch):
    _install_fake_qwen_tts(monkeypatch)
    sentinel = object()
    monkeypatch.setattr(voice, "_qwen3_torch_model", sentinel)

    assert voice._ensure_qwen3_torch_loaded() is sentinel


# ── Voice clone prompt cache ──


def test_qwen3_torch_voice_prompt_cache_is_keyed_by_path_and_mtime(tmp_path):
    audio_path = tmp_path / "sample.wav"
    (tmp_path / "sample.txt").write_text("reference transcript", encoding="utf-8")
    audio_path.write_bytes(b"RIFF")
    voice._qwen3_torch_voice_prompts.clear()

    model = FakeCloneModel()

    first = voice._qwen3_torch_voice_prompt(model, str(audio_path))
    second = voice._qwen3_torch_voice_prompt(model, str(audio_path))

    # Real API returns List[VoiceClonePromptItem]; the cache stores it as-is.
    assert first == second
    assert isinstance(first, list)
    assert model.prompt_calls == [
        {"ref_audio": str(audio_path), "ref_text": "reference transcript"}
    ]

    future = time.time() + 30
    os.utime(audio_path, (future, future))

    third = voice._qwen3_torch_voice_prompt(model, str(audio_path))
    assert third is not first  # distinct cache entry (equal payload, new key)
    assert len(model.prompt_calls) == 2
    assert len(voice._qwen3_torch_voice_prompts) == 2


def test_qwen3_torch_voice_sample_is_required(tmp_path, monkeypatch):
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    req = voice.TTSRequest(text="Hello.", language="ja", provider="qwen3")
    try:
        voice._qwen3_torch_voice_sample(req)
    except RuntimeError as exc:
        assert "Qwen3-TTS voice cloning requires a voice sample" in str(exc)
    else:
        raise AssertionError("expected missing voice sample to fail")

    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"RIFF")
    req_with_sample = voice.TTSRequest(
        text="Hello.",
        language="ja",
        provider="qwen3",
        voiceSamplePath=str(audio_path),
    )

    assert voice._qwen3_torch_voice_sample(req_with_sample) == str(audio_path)


# ── Full WAV generation ──


def test_qwen3_torch_full_wav_uses_real_generate_voice_clone_contract(
    tmp_path, monkeypatch
):
    audio_path = tmp_path / "sample.wav"
    (tmp_path / "sample.txt").write_text("exact reference transcript", encoding="utf-8")
    audio_path.write_bytes(b"RIFF")
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    _install_fake_soundfile(monkeypatch)
    _qwen3_japanese_runtime(monkeypatch)
    voice._qwen3_torch_voice_prompts.clear()

    model = FakeCloneModel()
    # Two wavs from one batched call must be concatenated into one WAV.
    model.sample_rate = 32000

    def _two_wav_generate(text, language=None, voice_clone_prompt=None,
                          non_streaming_mode=False, **kwargs):
        model.clone_calls.append(
            {
                "text": text,
                "language": language,
                "voice_clone_prompt": voice_clone_prompt,
                "non_streaming_mode": non_streaming_mode,
                **kwargs,
            }
        )
        return [np.full(4, 1.0, dtype=np.float32), np.full(4, 2.0, dtype=np.float32)], 32000

    model.generate_voice_clone = _two_wav_generate
    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: model)
    req = voice.TTSRequest(
        text="こんにちは。",
        language="ja",
        provider="qwen3",
        voiceSamplePath=str(audio_path),
        speed=0.9,
    )

    response = asyncio.run(voice._generate_tts_qwen3_torch(req, "ja"))

    call = model.clone_calls[0]
    assert call["text"] == "こんにちは。"  # no <|Lang|> prefix — qwen_tts wraps text itself
    assert call["language"] == "Japanese"  # language is an argument, not a prefix
    assert call["voice_clone_prompt"] == [
        {"ref_audio": str(audio_path), "ref_text": "exact reference transcript"}
    ]
    assert call["non_streaming_mode"] is True
    assert "speed" not in call  # qwen_tts has no speed parameter
    assert model.prompt_calls == [
        {"ref_audio": str(audio_path), "ref_text": "exact reference transcript"}
    ]

    assert response.body == b"RIFF-fake"
    assert response.media_type == "audio/wav"
    assert response.headers["x-sample-rate"] == "32000"
    assert json.loads(response.headers["x-sentence-boundaries"]) == [
        {"index": 0, "text": "こんにちは。", "sampleOffset": 0, "sampleCount": 8}
    ]


def test_qwen3_torch_full_wav_requires_voice_sample(tmp_path, monkeypatch):
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    _qwen3_japanese_runtime(monkeypatch)
    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: FakeCloneModel())
    req = voice.TTSRequest(text="Hello.", language="ja", provider="qwen3")

    try:
        asyncio.run(voice._generate_tts_qwen3_torch(req, "ja"))
    except RuntimeError as exc:
        assert "Qwen3-TTS voice cloning requires a voice sample" in str(exc)
    else:
        raise AssertionError("expected missing voice sample to fail")


# ── Chunked generation (WS streaming) ──


def test_qwen3_torch_streaming_batches_sentences_and_yields_per_item(
    tmp_path, monkeypatch
):
    audio_path = tmp_path / "sample.wav"
    (tmp_path / "sample.txt").write_text("reference transcript", encoding="utf-8")
    audio_path.write_bytes(b"RIFF")
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    _qwen3_japanese_runtime(monkeypatch)
    monkeypatch.setattr(
        voice.config,
        "language_text_processing_config_for_language",
        lambda language: {"sentenceTerminators": ["。"]} if language == "ja" else {},
    )

    model = FakeCloneModel()
    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: model)
    req = voice.TTSRequest(
        text="こんにちは。元気ですか。はい。",
        language="ja",
        provider="qwen3",
        voiceSamplePath=str(audio_path),
        speed=1.2,
    )

    chunks = list(voice._iter_qwen3_torch_tts_chunks(req, "ja"))

    call = model.clone_calls[0]
    # One batched call: text is the sentence list, language passed once.
    assert call["text"] == ["こんにちは。", "元気ですか。", "はい。"]
    assert call["language"] == "Japanese"
    assert call["non_streaming_mode"] is True
    assert "speed" not in call
    assert all("<|" not in part for part in call["text"])

    assert [chunk["chunkIndex"] for chunk in chunks] == [0, 1, 2]
    assert [chunk["isFinal"] for chunk in chunks] == [False, False, True]
    assert all(chunk["sampleRate"] == 24000 for chunk in chunks)
    assert all(chunk["audio"].dtype.name == "float32" for chunk in chunks)
    assert [chunk["audio"].tolist() for chunk in chunks] == [
        [1.0, 1.0, 1.0, 1.0],
        [2.0, 2.0, 2.0, 2.0],
        [3.0, 3.0, 3.0, 3.0],
    ]


def test_qwen3_torch_streaming_requires_voice_sample(tmp_path, monkeypatch):
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    _qwen3_japanese_runtime(monkeypatch)
    monkeypatch.setattr(voice, "_ensure_qwen3_torch_loaded", lambda: FakeCloneModel())
    req = voice.TTSRequest(text="Hello.", language="ja", provider="qwen3")

    try:
        list(voice._iter_qwen3_torch_tts_chunks(req, "ja"))
    except RuntimeError as exc:
        assert "Qwen3-TTS voice cloning requires a voice sample" in str(exc)
    else:
        raise AssertionError("expected missing voice sample to fail")


# ── HTTP/WS endpoint dispatch ──


def _torch_tts_app(monkeypatch, *, sample):
    app = FastAPI()
    app.include_router(voice.router)
    monkeypatch.setattr(
        voice, "_resolve_tts_engine", lambda _language, _provider=None: "qwen3-torch"
    )
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)
    monkeypatch.setattr(
        voice,
        "_validate_voice_sample_path",
        lambda path: "/validated/sample.wav" if (sample and path) else None,
    )
    return app


def test_tts_generate_with_sample_uses_torch_generator(monkeypatch):
    app = _torch_tts_app(monkeypatch, sample=True)
    calls = []

    async def fake_torch(req, language):
        calls.append(("torch", language, req.voiceSamplePath))
        return {"engine": "torch"}

    async def fail_kokoro(_req, _language):
        raise AssertionError("kokoro must not run when a voice sample exists")

    monkeypatch.setattr(voice, "_generate_tts_qwen3_torch", fake_torch)
    monkeypatch.setattr(voice, "_generate_tts_kokoro", fail_kokoro)

    response = TestClient(app).post(
        "/voice/tts",
        json={
            "text": "Hello.",
            "language": "ja",
            "provider": "qwen3",
            "voiceSamplePath": "/tmp/sample.wav",
        },
    )

    assert response.json() == {"engine": "torch"}
    assert calls == [("torch", "ja", "/tmp/sample.wav")]


def test_tts_generate_without_sample_falls_back_to_kokoro(monkeypatch):
    app = _torch_tts_app(monkeypatch, sample=False)
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"kokoroLangCode": "j"} if language == "ja" else {},
    )
    calls = []

    async def fake_kokoro(req, language):
        calls.append(("kokoro", language))
        return {"engine": "kokoro"}

    async def fail_torch(_req, _language):
        raise AssertionError("torch generation must not run without a voice sample")

    monkeypatch.setattr(voice, "_generate_tts_kokoro", fake_kokoro)
    monkeypatch.setattr(voice, "_generate_tts_qwen3_torch", fail_torch)

    response = TestClient(app).post(
        "/voice/tts",
        json={"text": "こんにちは。", "language": "ja", "provider": "qwen3"},
    )

    assert response.json() == {"engine": "kokoro"}
    assert calls == [("kokoro", "ja")]


def test_tts_generate_without_sample_and_without_kokoro_requires_sample(monkeypatch):
    app = _torch_tts_app(monkeypatch, sample=False)
    monkeypatch.setattr(voice, "_tts_runtime", lambda _language: {})

    response = TestClient(app).post(
        "/voice/tts",
        json={"text": "Hallo.", "language": "de", "provider": "qwen3"},
    )

    assert response.status_code == 500
    assert "Qwen3-TTS voice cloning requires a voice sample" in response.json()["detail"]


def test_voice_tts_stream_websocket_dispatches_to_torch_generator(monkeypatch):
    used = []
    monkeypatch.setattr(
        voice, "_resolve_tts_engine", lambda _language, _provider=None: "qwen3-torch"
    )
    monkeypatch.setattr(voice, "_qwen3_torch_model", object())
    monkeypatch.setattr(
        voice,
        "_validate_voice_sample_path",
        lambda path: "/validated/sample.wav" if path else None,
    )

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
        websocket.send_json(
            {
                "text": "Hello.",
                "language": "en",
                "provider": "qwen3",
                "voiceSamplePath": "/tmp/sample.wav",
            }
        )
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


def test_voice_tts_stream_websocket_requires_voice_sample_for_torch(monkeypatch):
    monkeypatch.setattr(
        voice, "_resolve_tts_engine", lambda _language, _provider=None: "qwen3-torch"
    )
    monkeypatch.setattr(voice, "_qwen3_torch_model", object())

    app = FastAPI()
    app.include_router(voice.router)

    with TestClient(app).websocket_connect("/voice/tts/stream") as websocket:
        websocket.send_json({"text": "Hello.", "language": "ja", "provider": "qwen3"})
        message = websocket.receive_json()

    assert message["type"] == "error"
    assert "Qwen3-TTS voice cloning requires a voice sample" in message["message"]


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
