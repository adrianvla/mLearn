import sys
from pathlib import Path
import asyncio
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))

from routes import voice


def test_stt_transcribe_options_use_metadata_whisper_language(monkeypatch):
    monkeypatch.setattr(
        voice,
        "_stt_runtime",
        lambda language: {"whisperLanguage": "fa"} if language == "farsi" else {},
    )

    options = voice._stt_transcribe_options("farsi", beam_size=5, vad_filter=True)

    assert options == {
        "language": "fa",
        "beam_size": 5,
        "vad_filter": True,
    }


def test_stt_transcribe_options_can_request_auto_detection(monkeypatch):
    monkeypatch.setattr(
        voice,
        "_stt_runtime",
        lambda language: {"whisperLanguage": "auto"} if language == "mixed" else {},
    )

    options = voice._stt_transcribe_options("mixed", beam_size=1)

    assert options == {"beam_size": 1}


def test_stt_transcribe_options_use_auto_detection_without_runtime_language(monkeypatch):
    monkeypatch.setattr(voice, "_stt_runtime", lambda _language: {})

    options = voice._stt_transcribe_options("ja", beam_size=1)

    assert options == {"beam_size": 1}


def test_stt_transcribe_options_use_auto_detection_without_selected_language(monkeypatch):
    monkeypatch.setattr(voice.config, "LANGUAGE", "")

    options = voice._stt_transcribe_options(None, beam_size=1)

    assert options == {"beam_size": 1}


def test_stt_status_reports_selected_language_whisper_hint(monkeypatch):
    monkeypatch.setattr(
        voice,
        "_stt_runtime",
        lambda language: {"whisperLanguage": "ar"} if language == "arabic" else {},
    )

    status = asyncio.run(voice.voice_stt_status("arabic"))

    assert status["language"] == "arabic"
    assert status["whisperLanguage"] == "ar"


def test_stt_status_reports_auto_detection_when_language_metadata_requests_it(monkeypatch):
    monkeypatch.setattr(
        voice,
        "_stt_runtime",
        lambda language: {"whisperLanguage": "auto"} if language == "mixed" else {},
    )

    status = asyncio.run(voice.voice_stt_status("mixed"))

    assert status["language"] == "mixed"
    assert status["whisperLanguage"] == "auto"


def test_stt_hallucination_normalization_uses_language_sentence_terminators(monkeypatch):
    monkeypatch.setattr(
        voice.config,
        "language_text_processing_config_for_language",
        lambda language: {"sentenceTerminators": ["।"]} if language == "hi" else {},
    )

    assert voice._normalize_stt_hallucination_text(" धन्यवाद। ", "hi") == "धन्यवाद"
    assert voice._normalize_stt_hallucination_text("Thanks?", "en") == "thanks"


def test_voice_transcribe_uses_request_language_for_stt_options(monkeypatch):
    captured_languages = []
    captured_options = []

    class FakeSttModel:
        def transcribe(self, audio_path, **options):
            captured_options.append((audio_path, options))
            return [SimpleNamespace(text="سلام")], SimpleNamespace(language="fa")

    monkeypatch.setattr(voice, "_validate_voice_sample_path", lambda _path: "/tmp/sample.wav")
    monkeypatch.setattr(voice, "_ensure_stt_loaded", lambda: FakeSttModel())
    monkeypatch.setattr(voice, "_voice_touch", lambda: None)

    def fake_stt_transcribe_options(language, **options):
        captured_languages.append(language)
        return {"language": "fa", **options}

    monkeypatch.setattr(voice, "_stt_transcribe_options", fake_stt_transcribe_options)

    result = asyncio.run(
        voice.voice_transcribe(
            voice.TranscribeRequest(voiceSamplePath="/tmp/sample.wav", language="farsi")
        )
    )

    assert captured_languages == ["farsi"]
    assert captured_options == [
        ("/tmp/sample.wav", {"language": "fa", "beam_size": 5, "vad_filter": True})
    ]
    assert result == {"text": "سلام", "language": "fa"}
