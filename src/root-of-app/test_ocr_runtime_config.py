import asyncio
import base64
import io
import sys
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi import HTTPException
from PIL import Image
import routes.ocr as ocr


def _tiny_png_base64() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_missing_ocr_runtime_metadata_does_not_enable_runtime_ocr(monkeypatch):
    monkeypatch.setattr(ocr.config, "LANGUAGE", "ja")
    monkeypatch.setattr(ocr.config, "LANGUAGE_METADATA", {})

    assert ocr.config.language_runtime_config_for_language("ja", "ocr") == {}
    assert ocr._uses_manga_ocr_recognition("ja") is False
    assert ocr.config.language_supports_vertical_text_for_language("ja") is False


def test_explicit_ocr_runtime_metadata_controls_runtime_ocr(monkeypatch):
    monkeypatch.setattr(ocr.config, "LANGUAGE", "sample")
    monkeypatch.setattr(ocr.config, "LANGUAGE_METADATA", {
        "runtime": {
            "ocr": {
                "recognitionEngine": "rapidocr",
                "rapidLangType": "CYRILLIC",
            },
        },
    })

    assert ocr.config.language_runtime_config_for_language("sample", "ocr") == {
        "recognitionEngine": "rapidocr",
        "rapidLangType": "CYRILLIC",
    }
    assert ocr._uses_manga_ocr_recognition("sample") is False


def test_vertical_text_support_comes_from_ocr_runtime_metadata(monkeypatch):
    monkeypatch.setattr(ocr.config, "LANGUAGE", "sample")
    monkeypatch.setattr(ocr.config, "LANGUAGE_METADATA", {
        "runtime": {
            "ocr": {
                "supportsVerticalText": False,
            },
        },
    })

    assert ocr.config.language_supports_vertical_text_for_language("sample") is False

    monkeypatch.setattr(ocr.config, "LANGUAGE_METADATA", {
        "runtime": {
            "ocr": {
                "supportsVerticalText": True,
            },
        },
    })

    assert ocr.config.language_supports_vertical_text_for_language("sample") is True


def test_ocr_ram_saver_support_can_be_disabled_by_runtime_metadata(monkeypatch):
    monkeypatch.setattr(ocr.config, "LANGUAGE", "sample")
    monkeypatch.setattr(ocr.config, "LANGUAGE_METADATA", {
        "runtime": {
            "ocr": {
                "recognitionEngine": "mangaocr",
                "supportsRamSaver": False,
            },
        },
    })

    assert ocr.config.language_supports_ocr_ram_saver_for_language("sample") is False

    monkeypatch.setattr(ocr.config, "LANGUAGE_METADATA", {
        "runtime": {
            "ocr": {
                "recognitionEngine": "mangaocr",
            },
        },
    })

    assert ocr.config.language_supports_ocr_ram_saver_for_language("sample") is False


def test_manga_ocr_selection_comes_from_runtime_metadata(monkeypatch):
    def runtime(language: str, section: str | None = None):
        assert section == "ocr"
        if language == "sample-manga":
            return {"recognitionEngine": "mangaocr"}
        return {"recognitionEngine": "paddleocr"}

    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", runtime)

    assert ocr._uses_manga_ocr_recognition("sample-manga") is True
    assert ocr._uses_manga_ocr_recognition("sample-latin") is False


def test_builtin_ocr_recognition_engines_are_case_insensitive(monkeypatch):
    def runtime(language: str, section: str | None = None):
        assert section == "ocr"
        if language == "sample-manga":
            return {"recognitionEngine": "MangaOCR"}
        return {"recognitionEngine": "PaddleOCR"}

    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", runtime)

    assert ocr._uses_manga_ocr_recognition("sample-manga") is True
    assert ocr._require_ocr_recognition_engine("sample-manga", runtime("sample-manga", "ocr")) == "mangaocr"
    assert ocr._require_ocr_recognition_engine("sample-paddle", runtime("sample-paddle", "ocr")) == "paddleocr"


def test_custom_ocr_recognition_engine_names_are_preserved():
    config = {"recognitionEngine": "VendorSpecificOCR"}

    assert ocr._require_ocr_recognition_engine("sample", config) == "VendorSpecificOCR"
    assert ocr._is_builtin_ocr_recognition_engine("VendorSpecificOCR") is False


def test_ocr_warmup_skips_languages_that_do_not_use_manga_ocr(monkeypatch):
    called = False

    def runtime(language: str, section: str | None = None):
        assert section == "ocr"
        return {"recognitionEngine": "paddleocr"}

    def start_warmup():
        nonlocal called
        called = True

    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "sample-latin")
    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", runtime)
    monkeypatch.setattr(ocr, "_ensure_warmup_started", start_warmup)

    result = asyncio.run(ocr.ocr_warmup("sample-latin"))

    assert result == {"status": "not_needed", "language": "sample-latin"}
    assert called is False


def test_ocr_warmup_starts_for_manga_ocr_languages(monkeypatch):
    called = False

    def runtime(language: str, section: str | None = None):
        assert section == "ocr"
        return {"recognitionEngine": "mangaocr"}

    def start_warmup():
        nonlocal called
        called = True

    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "sample-manga")
    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", runtime)
    monkeypatch.setattr(ocr._transformers_preimport_done, "is_set", lambda: False)
    monkeypatch.setattr(ocr, "_warmup_started", False)
    monkeypatch.setattr(ocr, "_ensure_warmup_started", start_warmup)

    result = asyncio.run(ocr.ocr_warmup("sample-manga"))

    assert result == {"status": "started", "language": "sample-manga"}
    assert called is True


def test_ocr_endpoint_rejects_missing_language_runtime_metadata(monkeypatch):
    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "sample")
    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", lambda _language, _section=None: {})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(ocr.ocr_endpoint(
            file=None,
            image_base64=_tiny_png_base64(),
            language="sample",
            dev_mode="true",
            detection_max_width=None,
            detection_max_height=None,
        ))

    assert exc.value.status_code == 400
    assert "OCR runtime language data is required for sample" in str(exc.value.detail)


def test_ocr_endpoint_rejects_language_without_runtime_metadata(monkeypatch):
    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "sample")
    monkeypatch.setattr(ocr.config, "LANGUAGE_METADATA", {})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(ocr.ocr_endpoint(
            file=None,
            image_base64=_tiny_png_base64(),
            language="sample",
            dev_mode="true",
            detection_max_width=None,
            detection_max_height=None,
        ))

    assert exc.value.status_code == 400
    assert "OCR runtime language data is required for sample" in str(exc.value.detail)
    assert "legacy OCR flags" not in str(exc.value.detail)
    assert "reinstall or update" not in str(exc.value.detail)


def test_ocr_endpoint_delegates_custom_ocr_engine_to_language_adapter(monkeypatch):
    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "sample")
    monkeypatch.setattr(
        ocr.config,
        "language_runtime_config_for_language",
        lambda _language, _section=None: {"recognitionEngine": "arabic-transformer-ocr"},
    )
    monkeypatch.setattr(ocr, "_get_paddle_ocr", lambda _language: pytest.fail("custom OCR must not fall back to PaddleOCR"))
    monkeypatch.setattr(ocr, "_get_rapid_ocr", lambda _language: pytest.fail("custom OCR must not fall back to RapidOCR"))
    monkeypatch.setattr(ocr, "_get_manga_ocr", lambda: pytest.fail("custom OCR must not fall back to MangaOCR"))

    calls = []

    class CustomOcrModule:
        def LANGUAGE_OCR(self, image, options):
            calls.append((image.size, options))
            return {
                "boxes": [
                    {
                        "box": [[0, 0], [2, 0], [2, 2], [0, 2]],
                        "text": "سلام",
                        "score": 0.98,
                    }
                ]
            }

    monkeypatch.setattr(ocr.config, "get_or_load_language", lambda language: CustomOcrModule() if language == "sample" else None)
    monkeypatch.setattr(ocr, "_process_stats", lambda _name: None)
    monkeypatch.setattr(ocr, "_ocr_touch", lambda: None)

    result = asyncio.run(ocr.ocr_endpoint(
        file=None,
        image_base64=_tiny_png_base64(),
        language="sample",
        dev_mode="true",
        detection_max_width=None,
        detection_max_height=None,
    ))

    assert calls == [
        ((2, 2), {
            "language": "sample",
            "recognitionEngine": "arabic-transformer-ocr",
            "devMode": True,
        })
    ]
    assert result["boxes"] == [
        {
            "box": [[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]],
            "text": "سلام",
            "score": 0.98,
            "is_vertical": False,
        }
    ]
    assert result["processing_times"]["recognition_engine"] == "arabic-transformer-ocr"
    assert result["processing_times"]["detection_engine"] == "LanguageAdapter"


def test_ocr_endpoint_rejects_missing_selected_language(monkeypatch):
    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(ocr.ocr_endpoint(
            file=None,
            image_base64=_tiny_png_base64(),
            language=None,
            dev_mode="true",
            detection_max_width=None,
            detection_max_height=None,
        ))

    assert exc.value.status_code == 400
    assert exc.value.detail == "No language selected for OCR"


def test_ocr_warmup_without_selected_language_does_not_probe_english(monkeypatch):
    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "")

    result = asyncio.run(ocr.ocr_warmup())

    assert result == {"status": "not_needed", "language": ""}


def test_rapid_and_paddle_initializers_do_not_default_to_english_without_runtime_language(monkeypatch):
    class DummyLangRec:
        EN = "EN"

    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", lambda _language, _section=None: {"recognitionEngine": "rapidocr"})
    monkeypatch.setitem(sys.modules, "rapidocr", SimpleNamespace(
        RapidOCR=lambda **_kwargs: object(),
        LangRec=DummyLangRec,
    ))
    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(
        PaddleOCR=lambda **_kwargs: object(),
    ))

    assert ocr._init_rapid_ocr("sample") is None

    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", lambda _language, _section=None: {"recognitionEngine": "paddleocr"})
    assert ocr._init_paddle_ocr("sample") is None


def test_rapid_initializer_rejects_unknown_runtime_language_instead_of_defaulting_to_english(monkeypatch):
    class DummyLangRec:
        EN = "EN"
        JAPAN = "JAPAN"

    rapid_calls = []

    def fake_rapid_ocr(**kwargs):
        rapid_calls.append(kwargs)
        return object()

    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(
        ocr.config,
        "language_runtime_config_for_language",
        lambda _language, _section=None: {
            "recognitionEngine": "rapidocr",
            "rapidLangType": "NOT_A_REAL_RAPIDOCR_LANGUAGE",
        },
    )
    monkeypatch.setitem(sys.modules, "rapidocr", SimpleNamespace(
        RapidOCR=fake_rapid_ocr,
        LangRec=DummyLangRec,
    ))

    assert ocr._init_rapid_ocr("sample") is None
    assert rapid_calls == []


def test_ocr_endpoint_uses_request_language_runtime_for_mangaocr(monkeypatch):
    def runtime(language: str, section: str | None = None):
        assert section == "ocr"
        if language == "ja":
            return {
                "recognitionEngine": "mangaocr",
                "supportsVerticalText": True,
                "supportsRamSaver": True,
                "rapidLangType": "JAPAN",
            }
        return {"recognitionEngine": "rapidocr", "rapidLangType": "EN"}

    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "en")
    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", runtime)
    monkeypatch.setattr(ocr, "_process_stats", lambda _name: None)
    monkeypatch.setattr(ocr, "_ocr_touch", lambda: None)
    monkeypatch.setattr(ocr, "_get_manga_ocr", lambda: (lambda _image: "日本語"))

    result = asyncio.run(ocr.ocr_endpoint(
        file=None,
        image_base64=_tiny_png_base64(),
        language="ja",
        dev_mode="true",
        detection_max_width=None,
        detection_max_height=None,
    ))

    assert result["boxes"][0]["text"] == "日本語"
    assert result["processing_times"]["detection_engine"] == "Crop"
    assert result["processing_times"]["recognition_engine"] == "MangaOCR"


def test_ocr_endpoint_ignores_ram_saver_metadata_for_mangaocr(monkeypatch):
    def runtime(language: str, section: str | None = None):
        assert section == "ocr"
        if language == "sample-manga":
            return {
                "recognitionEngine": "mangaocr",
                "supportsRamSaver": False,
                "rapidLangType": "JAPAN",
            }
        return {"recognitionEngine": "rapidocr", "rapidLangType": "EN"}

    engine_calls = {"rapid": False, "paddle": False}

    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "en")
    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", runtime)
    monkeypatch.setattr(ocr, "_process_stats", lambda _name: None)
    monkeypatch.setattr(ocr, "_ocr_touch", lambda: None)
    monkeypatch.setattr(ocr, "_get_rapid_ocr", lambda _language: engine_calls.__setitem__("rapid", True))
    monkeypatch.setattr(ocr, "_get_paddle_ocr", lambda _language: engine_calls.__setitem__("paddle", True))
    monkeypatch.setattr(ocr, "_get_manga_ocr", lambda: (lambda _image: "日本語"))

    result = asyncio.run(ocr.ocr_endpoint(
        file=None,
        image_base64=_tiny_png_base64(),
        language="sample-manga",
        dev_mode="true",
        detection_max_width=None,
        detection_max_height=None,
    ))

    assert engine_calls == {"rapid": False, "paddle": False}
    assert result["boxes"][0]["text"] == "日本語"
    assert result["processing_times"]["detection_engine"] == "Crop"
    assert result["processing_times"]["recognition_engine"] == "MangaOCR"


def test_ocr_endpoint_keeps_mangaocr_recognition_as_single_image_pass(monkeypatch):
    def runtime(language: str, section: str | None = None):
        assert section == "ocr"
        if language == "ja":
            return {
                "recognitionEngine": "mangaocr",
                "supportsVerticalText": True,
                "rapidLangType": "JAPAN",
                "paddleLang": "japan",
            }
        return {"recognitionEngine": "rapidocr", "rapidLangType": "EN"}

    monkeypatch.setattr(ocr.config, "OCR_ALLOWED", True)
    monkeypatch.setattr(ocr.config, "LANGUAGE", "en")
    monkeypatch.setattr(ocr.config, "language_runtime_config_for_language", runtime)
    monkeypatch.setattr(ocr, "_process_stats", lambda _name: None)
    monkeypatch.setattr(ocr, "_ocr_touch", lambda: None)
    monkeypatch.setattr(ocr, "_get_manga_ocr", lambda: (lambda _image: "日本語"))

    result = asyncio.run(ocr.ocr_endpoint(
        file=None,
        image_base64=_tiny_png_base64(),
        language="ja",
        dev_mode="true",
        detection_max_width=None,
        detection_max_height=None,
    ))

    assert result["boxes"][0]["text"] == "日本語"
    assert result["processing_times"]["detection_engine"] == "Crop"
    assert result["processing_times"]["recognition_engine"] == "MangaOCR"
