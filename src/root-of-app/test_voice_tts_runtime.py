import sys
import types
import asyncio
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import voice


def _install_fake_kokoro(monkeypatch):
    created = []

    class FakePipeline:
        def __init__(self, lang_code, repo_id):
            self.lang_code = lang_code
            self.repo_id = repo_id
            created.append(self)

    kokoro = types.SimpleNamespace(KPipeline=FakePipeline)
    monkeypatch.setitem(sys.modules, "kokoro", kokoro)
    return created


def test_kokoro_tts_pipeline_cache_is_keyed_by_metadata_lang_code(monkeypatch):
    created = _install_fake_kokoro(monkeypatch)
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {
            "ja": {"kokoroLangCode": "j"},
            "en": {"kokoroLangCode": "a"},
        }.get(language, {}),
    )
    voice._voice_tts_pipelines.clear()

    ja_pipeline = voice._ensure_tts_loaded("ja")
    en_pipeline = voice._ensure_tts_loaded("en")
    second_ja_pipeline = voice._ensure_tts_loaded("ja")

    assert ja_pipeline.lang_code == "j"
    assert en_pipeline.lang_code == "a"
    assert second_ja_pipeline is ja_pipeline
    assert created == [ja_pipeline, en_pipeline]


def test_kokoro_tts_requires_installed_language_runtime(monkeypatch):
    _install_fake_kokoro(monkeypatch)
    monkeypatch.setattr(voice, "_tts_runtime", lambda _language: {})
    voice._voice_tts_pipelines.clear()

    try:
        voice._ensure_tts_loaded("zz")
    except RuntimeError as exc:
        assert "zz" in str(exc)
    else:
        raise AssertionError("expected missing Kokoro runtime config to fail")


def test_kokoro_voice_comes_from_language_runtime(monkeypatch):
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"kokoroVoice": "jf_alpha"} if language == "ja" else {},
    )

    assert voice._kokoro_voice("ja", "j") == "jf_alpha"


def test_kokoro_voice_requires_language_runtime_metadata(monkeypatch):
    monkeypatch.setattr(voice, "_tts_runtime", lambda _language: {})

    try:
        voice._kokoro_voice("zz", "a")
    except RuntimeError as exc:
        assert "Kokoro TTS voice is not configured for language 'zz'" in str(exc)
    else:
        raise AssertionError("expected missing Kokoro voice runtime config to fail")


def test_qwen3_tts_language_name_comes_from_language_runtime(monkeypatch):
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "japanese"} if language == "ja" else {},
    )

    assert voice._qwen3_language_name("ja") == "japanese"


def test_tts_engine_resolver_falls_back_from_kokoro_to_qwen3_for_language(monkeypatch):
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "persian"} if language == "fa" else {},
    )

    assert voice._resolve_tts_engine("fa") == "qwen3"


def test_tts_engine_resolver_normalizes_removed_cloud_provider_to_qwen3(monkeypatch):
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "english"} if language == "en" else {},
    )

    assert voice._resolve_tts_engine("en", "cloud") == "qwen3"


def test_tts_engine_resolver_rejects_unsupported_local_language(monkeypatch):
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(voice, "_tts_runtime", lambda _language: {})

    try:
        voice._resolve_tts_engine("zz")
    except RuntimeError as exc:
        assert "No TTS engine supports language 'zz'" in str(exc)
    else:
        raise AssertionError("expected unsupported language to fail")


def test_reload_tts_settings_normalizes_removed_cloud_provider(tmp_path, monkeypatch):
    settings_path = tmp_path / "settings.json"
    settings_path.write_text('{"ttsProvider":"cloud"}', encoding="utf-8")
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")

    voice._reload_tts_settings()

    assert voice._tts_provider == "qwen3"


def test_tts_status_reports_qwen3_when_kokoro_provider_falls_back(monkeypatch):
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(voice, "_qwen3_tts_model", object())
    monkeypatch.setattr(voice, "_tts_runtime", lambda language: {"qwen3LanguageName": "persian"} if language == "fa" else {})
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)
    mlx_audio = types.ModuleType("mlx_audio")
    mlx_audio_tts = types.ModuleType("mlx_audio.tts")
    mlx_audio_tts.load_model = lambda _repo_id: object()
    monkeypatch.setitem(sys.modules, "mlx_audio", mlx_audio)
    monkeypatch.setitem(sys.modules, "mlx_audio.tts", mlx_audio_tts)

    result = asyncio.run(voice.voice_tts_status("fa"))

    assert result["downloaded"] is True
    assert result["loaded"] is True
    assert result["modelName"] == "Qwen3-TTS-12Hz-0.6B-MLX"


def test_qwen3_reference_pair_requires_transcript_for_voice_clone(tmp_path, monkeypatch):
    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"RIFF")
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))

    try:
        voice._qwen3_reference_pair(str(audio_path))
    except RuntimeError as exc:
        assert "transcribed voice sample" in str(exc)
    else:
        raise AssertionError("expected missing transcript to fail")


def test_qwen3_stream_chunks_use_mlx_generate_contract(tmp_path, monkeypatch):
    audio_path = tmp_path / "sample.wav"
    transcript_path = tmp_path / "sample.txt"
    audio_path.write_bytes(b"RIFF")
    transcript_path.write_text("exact reference transcript", encoding="utf-8")
    monkeypatch.setattr(voice.config, "USER_DATA_PATH", str(tmp_path))
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"qwen3LanguageName": "Japanese"} if language == "ja" else {},
    )

    class Result:
        audio = [0.0, 0.5, -0.5]
        sample_rate = 24000
        token_count = 3
        is_final_chunk = True

    class Model:
        def __init__(self):
            self.kwargs = None

        def generate(self, text, **kwargs):
            self.kwargs = {"text": text, **kwargs}
            yield Result()

    model = Model()
    monkeypatch.setattr(voice, "_ensure_qwen3_tts_loaded", lambda: model)

    req = voice.TTSRequest(
        text="こんにちは。",
        language="ja",
        provider="qwen3",
        voiceSamplePath=str(audio_path),
        speed=1.1,
    )
    chunks = list(voice._iter_qwen3_tts_chunks(req, "ja", stream=True))

    assert chunks[0]["audio"].dtype.name == "float32"
    assert chunks[0]["sampleRate"] == 24000
    assert model.kwargs["stream"] is True
    assert model.kwargs["streaming_interval"] == voice._QWEN3_TTS_STREAMING_INTERVAL
    assert model.kwargs["ref_audio"] == str(audio_path)
    assert model.kwargs["ref_text"] == "exact reference transcript"
    assert model.kwargs["lang_code"] == "Japanese"
    assert model.kwargs["speed"] == 1.1


def test_voice_tts_stream_websocket_emits_qwen3_audio_chunks(monkeypatch):
    monkeypatch.setattr(voice, "_resolve_tts_engine", lambda _language, _provider=None: "qwen3")
    monkeypatch.setattr(voice, "_qwen3_tts_model", object())

    def fake_chunks(_req, _language, stream=True):
        assert stream is True
        yield {
            "audio": voice.np.asarray([0.0, 0.25, -0.25], dtype=voice.np.float32),
            "sampleRate": 24000,
            "chunkIndex": 0,
            "tokenCount": 3,
            "isFinal": True,
        }

    monkeypatch.setattr(voice, "_iter_qwen3_tts_chunks", fake_chunks)
    app = FastAPI()
    app.include_router(voice.router)

    with TestClient(app).websocket_connect("/voice/tts/stream") as websocket:
        websocket.send_json({"text": "Hello.", "language": "en", "provider": "qwen3"})
        status = websocket.receive_json()
        audio_meta = websocket.receive_json()
        audio_bytes = websocket.receive_bytes()
        done = websocket.receive_json()

    assert status["type"] == "status"
    assert status["generating"] is True
    assert audio_meta == {
        "type": "audio",
        "sampleRate": 24000,
        "sentenceIndex": 0,
        "sentenceText": "Hello.",
        "totalSentences": 1,
        "sampleOffset": 0,
        "sampleCount": 3,
        "chunkIndex": 0,
        "tokenCount": 3,
        "isFinal": True,
        "encoding": "f32le",
        "byteLength": 12,
        "channels": 1,
    }
    assert voice.np.frombuffer(audio_bytes, dtype="<f4").tolist() == [0.0, 0.25, -0.25]
    assert done == {"type": "done"}


def test_voice_tts_stream_websocket_rejects_cloud_provider():
    app = FastAPI()
    app.include_router(voice.router)

    with TestClient(app).websocket_connect("/voice/tts/stream") as websocket:
        websocket.send_json({"text": "Hello.", "language": "en", "provider": "cloud"})
        message = websocket.receive_json()

    assert message["type"] == "error"
    assert "Cloud realtime TTS is disabled" in message["message"]


def test_voice_tts_generate_rejects_cloud_provider():
    app = FastAPI()
    app.include_router(voice.router)

    response = TestClient(app).post(
        "/voice/tts",
        json={"text": "Hello.", "language": "en", "provider": "cloud"},
    )

    assert response.status_code == 400
    assert "Cloud realtime TTS is disabled" in response.json()["detail"]


def test_voice_stream_vad_mode_uses_silero_vad_for_speech_start(monkeypatch):
    calls = []

    class FakeProbability:
        def __init__(self, value):
            self.value = value

        def item(self):
            return self.value

    class FakeVadModel:
        def __call__(self, tensor, sample_rate):
            calls.append((tensor, sample_rate))
            return FakeProbability(0.9)

    class FakeTorch:
        @staticmethod
        def from_numpy(samples):
            return samples

    class FakeSttModel:
        def transcribe(self, *_args, **_kwargs):
            return [], {}

    monkeypatch.setattr(voice.config, "torch", FakeTorch())
    monkeypatch.setattr(voice, "_ensure_vad_loaded", lambda: {"model": FakeVadModel(), "utils": ()})
    monkeypatch.setattr(voice, "_ensure_stt_loaded", lambda: FakeSttModel())
    monkeypatch.setattr(voice, "_resolve_tts_engine", lambda _language, _provider=None: "unavailable")
    monkeypatch.setattr(voice, "_stt_runtime", lambda _language: {})

    app = FastAPI()
    app.include_router(voice.router)
    audio = voice.np.ones(512, dtype=voice.np.float32).tobytes()

    with TestClient(app).websocket_connect("/voice/stream?language=en&mode=vad&silence=10") as websocket:
        assert websocket.receive_json() == {"type": "ready"}
        websocket.send_bytes(audio)
        assert websocket.receive_json() == {"type": "vad", "event": "speech-start"}

    assert len(calls) == 1
    assert calls[0][1] == 16000


def test_voice_download_models_uses_resolved_qwen3_fallback(monkeypatch):
    calls = []
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(voice, "_tts_runtime", lambda language: {"qwen3LanguageName": "persian"} if language == "fa" else {})
    monkeypatch.setattr(voice, "_ensure_stt_loaded", lambda: calls.append("stt"))
    monkeypatch.setattr(voice, "_ensure_qwen3_tts_loaded", lambda: calls.append("qwen3"))
    monkeypatch.setattr(voice, "_ensure_tts_loaded", lambda _language: calls.append("kokoro"))

    result = asyncio.run(voice.voice_download_models("fa"))

    assert result == {"success": True}
    assert calls == ["stt", "qwen3"]


def test_tts_generate_uses_resolved_qwen3_fallback(monkeypatch):
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(voice, "_tts_runtime", lambda language: {"qwen3LanguageName": "persian"} if language == "fa" else {})
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)

    async def fake_qwen3(req, language):
        return {"engine": "qwen3", "language": language, "request_language": req.language}

    async def fake_kokoro(_req, _language):
        raise AssertionError("Kokoro should not be used for this language")

    monkeypatch.setattr(voice, "_generate_tts_qwen3", fake_qwen3)
    monkeypatch.setattr(voice, "_generate_tts_kokoro", fake_kokoro)

    result = asyncio.run(voice.voice_tts_generate(voice.TTSRequest(text="سلام", language="fa")))

    assert result == {"engine": "qwen3", "language": "fa", "request_language": "fa"}


def test_tts_generate_uses_active_language_for_blank_request_language(monkeypatch):
    monkeypatch.setattr(voice.config, "LANGUAGE", "fa")
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(voice, "_tts_runtime", lambda language: {"qwen3LanguageName": "persian"} if language == "fa" else {})
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)

    async def fake_qwen3(req, language):
        return {"engine": "qwen3", "language": language, "request_language": req.language}

    async def fake_kokoro(_req, _language):
        raise AssertionError("Kokoro should not be used for this language")

    monkeypatch.setattr(voice, "_generate_tts_qwen3", fake_qwen3)
    monkeypatch.setattr(voice, "_generate_tts_kokoro", fake_kokoro)

    result = asyncio.run(voice.voice_tts_generate(voice.TTSRequest(text="سلام")))

    assert result == {"engine": "qwen3", "language": "fa", "request_language": ""}


def test_tts_generate_delegates_package_defined_engine_to_language_adapter(monkeypatch):
    calls = []

    class CustomTtsModule:
        def LANGUAGE_TTS(self, text, options):
            calls.append((text, options))
            return {
                "audio": b"RIFFcustom",
                "sampleRate": 16000,
                "sentenceBoundaries": [
                    {
                        "index": 0,
                        "text": text,
                        "sampleOffset": 0,
                        "sampleCount": 42,
                    }
                ],
            }

    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(
        voice,
        "_tts_runtime",
        lambda language: {"engine": "arabic-tts-adapter"} if language == "ar" else {},
    )
    monkeypatch.setattr(voice.config, "get_or_load_language", lambda language: CustomTtsModule() if language == "ar" else None)
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)

    result = asyncio.run(voice.voice_tts_generate(voice.TTSRequest(text="سلام.", language="ar", speed=0.9)))

    assert calls == [
        ("سلام.", {
            "language": "ar",
            "engine": "arabic-tts-adapter",
            "speed": 0.9,
            "voiceSamplePath": None,
        })
    ]
    assert result.body == b"RIFFcustom"
    assert result.media_type == "audio/wav"
    assert result.headers["x-sample-rate"] == "16000"
    assert json.loads(result.headers["x-sentence-boundaries"]) == [
        {"index": 0, "text": "سلام.", "sampleOffset": 0, "sampleCount": 42}
    ]


def test_split_into_sentences_handles_common_non_latin_punctuation():
    text = "مرحبا؟ أهلا! 你好。再见！Hello. Still here?"

    assert voice._split_into_sentences(text) == [
        "مرحبا؟",
        "أهلا!",
        "你好。",
        "再见！",
        "Hello.",
        "Still here?",
    ]


def test_split_into_sentences_uses_language_metadata_terminators(monkeypatch):
    monkeypatch.setattr(
        voice.config,
        "language_text_processing_config_for_language",
        lambda language: {"sentenceTerminators": ["।"]} if language == "hi" else {},
    )
    text = "नमस्ते। फिर मिलेंगे। Hello. Still one segment."

    assert voice._split_into_sentences(text, "hi") == [
        "नमस्ते।",
        "फिर मिलेंगे।",
        "Hello. Still one segment.",
    ]
