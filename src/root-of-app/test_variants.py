import asyncio
import json
import shutil
import sys
from pathlib import Path

import pytest  # pyright: ignore[reportMissingImports]
import httpx
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).parent))

import config  # pyright: ignore[reportImplicitRelativeImport]
import plugin_registry  # pyright: ignore[reportImplicitRelativeImport]
import variants  # pyright: ignore[reportImplicitRelativeImport]
from generic_language import GenericLanguageModule  # pyright: ignore[reportImplicitRelativeImport]
from routes import convert  # pyright: ignore[reportImplicitRelativeImport]
from variants import VARIANT_OVERLAY_ALLOWLIST, _override_paths, apply_variant_overlay  # pyright: ignore[reportImplicitRelativeImport]


ROOT_OF_APP = Path(__file__).resolve().parent
REPO_ROOT = ROOT_OF_APP.parents[1]
ZH_METADATA_PATH = REPO_ROOT / "scripts" / "language-data" / "source" / "root-of-app" / "languages" / "zh.json"
ZH_T2S_PATH = REPO_ROOT / "scripts" / "language-data" / "source" / "root-of-app" / "languages" / "zh.t2s.json"


def test_apply_variant_overlay_replaces_allowlisted_whole_values():
    metadata = {
        "runtime": {"ocr": {"paddleLang": "ch", "kept": True}},
        "variants": {"variant": {"overrides": {"runtime.ocr.paddleLang": "chinese_cht"}}},
    }

    result = apply_variant_overlay(metadata, "variant")

    assert result["runtime"]["ocr"] == {"paddleLang": "chinese_cht", "kept": True}
    assert metadata["runtime"]["ocr"]["paddleLang"] == "ch"


def test_apply_variant_overlay_skips_unknown_paths(monkeypatch):
    metadata = {"variants": {"variant": {"overrides": {"runtime.unknown": "value"}}}}
    warnings = []
    monkeypatch.setattr(variants.log, "warning", lambda message, path: warnings.append((message, path)))

    assert apply_variant_overlay(metadata, "variant") == metadata
    assert warnings == [("Variant override path not in VARIANT_OVERLAY_ALLOWLIST: %s", "runtime.unknown")]


def test_variant_override_paths_are_allowlisted():
    metadata = json.loads(ZH_METADATA_PATH.read_text(encoding="utf-8"))
    override_paths = {
        path
        for variant in metadata["variants"].values()
        for path, _value in _override_paths(variant["overrides"])
    }

    assert override_paths <= set(VARIANT_OVERLAY_ALLOWLIST)


def _install_zh_metadata(data_root: Path) -> None:
    languages_dir = data_root / "languages"
    languages_dir.mkdir(parents=True)
    shutil.copy(ZH_METADATA_PATH, languages_dir / "zh.json")


def _configure_init(monkeypatch, tmp_path: Path, settings: dict[str, object]) -> None:
    user_data = tmp_path / "user-data"
    language_data = tmp_path / "language-data"
    user_data.mkdir()
    _install_zh_metadata(language_data)
    (user_data / "settings.json").write_text(json.dumps(settings), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", [
        "server.py", "zh", str(ROOT_OF_APP), "true", "true", str(user_data), str(language_data),
    ])
    monkeypatch.setattr(config, "LANGUAGE", "")
    monkeypatch.setattr(config, "RESPATH", "")
    monkeypatch.setattr(config, "USER_DATA_PATH", "")
    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", "")
    monkeypatch.setattr(config, "LANGUAGE_DIR_PATH", "")
    monkeypatch.setattr(config, "LANGUAGE_METADATA", {})
    monkeypatch.setattr(config, "ACTIVE_VARIANT", None)
    monkeypatch.setattr(plugin_registry, "_registry", {})
    monkeypatch.setattr(plugin_registry, "_active_language", "")
    monkeypatch.setattr(config, "get_or_load_language", lambda _language: object())


def test_runtime_config_reflects_variant(tmp_path, monkeypatch):
    _configure_init(monkeypatch, tmp_path, {"languageVariants": {"zh": "zh-Hant"}})

    config.init()

    assert config.ACTIVE_VARIANT == "zh-Hant"
    assert config.language_runtime_config("ocr")["paddleLang"] == "chinese_cht"
    assert config.language_runtime_config("tts")["webSpeechLang"] == "zh-TW"
    assert config.LANGUAGE_METADATA["runtime"]["adapter"]["config"]["pinyinInputConversion"] == "t2s"


def test_config_init_without_variant_preserves_base_metadata(tmp_path, monkeypatch):
    _configure_init(monkeypatch, tmp_path, {})

    config.init()

    assert config.ACTIVE_VARIANT is None
    assert config.language_runtime_config("ocr")["paddleLang"] == "ch"
    assert config.language_runtime_config("tts")["webSpeechLang"] == "zh-CN"
    assert "config" not in config.LANGUAGE_METADATA["runtime"]["adapter"]


def test_generic_language_module_uses_active_variant_adapter_config(tmp_path, monkeypatch):
    data_root = tmp_path / "language-data"
    _install_zh_metadata(data_root)
    monkeypatch.setattr(config, "ACTIVE_VARIANT", "zh-Hant")

    module = GenericLanguageModule("zh")
    module.LOAD_MODULE(str(tmp_path), str(data_root))

    assert module.metadata["runtime"]["adapter"]["config"]["pinyinInputConversion"] == "t2s"


async def _post_convert(payload: dict[str, object]) -> httpx.Response:
    app = FastAPI()
    app.include_router(convert.get_router())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/api/v1/convert", json=payload)


@pytest.fixture(autouse=True)
def _reset_convert_table_cache():
    convert._reset_cache_for_tests()
    yield
    convert._reset_cache_for_tests()


def _configure_convert_table(monkeypatch, data_root: Path) -> None:
    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(data_root))
    monkeypatch.setattr(convert, "ROOT_OF_APP_DIR", data_root)


def _block_opencc_import(monkeypatch) -> None:
    original_import = convert.importlib.import_module

    def fail_opencc(name, *args, **kwargs):
        if name == "opencc":
            raise ImportError("opencc unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(convert.importlib, "import_module", fail_opencc)


def test_convert_endpoint_uses_packaged_table_before_opencc(tmp_path, monkeypatch):
    data_root = tmp_path / "language-data"
    languages_dir = data_root / "languages"
    languages_dir.mkdir(parents=True)
    shutil.copy(ZH_T2S_PATH, languages_dir / "zh.t2s.json")
    _configure_convert_table(monkeypatch, data_root)
    _block_opencc_import(monkeypatch)

    response = asyncio.run(_post_convert({"language": "zh", "text": "學習", "to": "simplified"}))

    assert response.status_code == 200
    assert response.json() == {"converted": "学习"}


def test_convert_endpoint_falls_back_to_opencc_when_table_is_missing(tmp_path, monkeypatch):
    pytest.importorskip("opencc")
    _configure_convert_table(monkeypatch, tmp_path / "language-data")

    response = asyncio.run(_post_convert({"language": "zh", "text": "學習", "to": "simplified"}))

    assert response.status_code == 200
    assert response.json() == {"converted": "学习"}


def test_convert_endpoint_returns_503_when_table_and_opencc_are_unavailable(tmp_path, monkeypatch):
    _configure_convert_table(monkeypatch, tmp_path / "language-data")
    _block_opencc_import(monkeypatch)

    response = asyncio.run(_post_convert({"language": "zh", "text": "學習", "to": "simplified"}))

    assert response.status_code == 503
    assert response.json() == {"error": "OpenCC is unavailable"}


def test_convert_endpoint_converts_simplified_to_traditional():
    pytest.importorskip("opencc")

    response = asyncio.run(_post_convert({"language": "zh", "text": "学习", "to": "traditional"}))

    assert response.status_code == 200
    assert response.json() == {"converted": "學習"}


def test_convert_endpoint_returns_503_for_traditional_when_opencc_is_unavailable(monkeypatch):
    _block_opencc_import(monkeypatch)

    response = asyncio.run(_post_convert({"language": "zh", "text": "学习", "to": "traditional"}))

    assert response.status_code == 503
    assert response.json() == {"error": "OpenCC is unavailable"}


def test_convert_endpoint_rejects_unknown_language():
    response = asyncio.run(_post_convert({"language": "ja", "text": "学習", "to": "simplified"}))

    assert response.status_code == 422
