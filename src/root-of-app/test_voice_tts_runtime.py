import sys
import types
import asyncio
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

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


def test_tts_engine_resolver_rejects_unsupported_local_language(monkeypatch):
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(voice, "_tts_runtime", lambda _language: {})

    try:
        voice._resolve_tts_engine("zz")
    except RuntimeError as exc:
        assert "No TTS engine supports language 'zz'" in str(exc)
    else:
        raise AssertionError("expected unsupported language to fail")


def test_tts_status_reports_qwen3_when_kokoro_provider_falls_back(monkeypatch):
    monkeypatch.setattr(voice, "_tts_provider", "kokoro")
    monkeypatch.setattr(voice, "_qwen3_tts_model", object())
    monkeypatch.setattr(voice, "_tts_runtime", lambda language: {"qwen3LanguageName": "persian"} if language == "fa" else {})
    monkeypatch.setattr(voice, "_reload_tts_settings", lambda: None)
    monkeypatch.setattr(voice, "_install_sox_shim", lambda: None)
    monkeypatch.setitem(sys.modules, "qwen_tts", types.SimpleNamespace(Qwen3TTSModel=object))

    result = asyncio.run(voice.voice_tts_status("fa"))

    assert result["downloaded"] is True
    assert result["loaded"] is True
    assert result["modelName"] == "Qwen3-TTS-1.7B"


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
