import sys
import json
import io
import logging
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import config
from generic_language import GenericLanguageModule
import logging_utils
import plugin_registry

ROOT_OF_APP = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT_OF_APP.parents[1]


class OneArgLanguage:
    def __init__(self):
        self.calls = []

    def LOAD_MODULE(self, resource_path):
        self.calls.append((resource_path,))


class TwoArgLanguage:
    def __init__(self):
        self.calls = []

    def LOAD_MODULE(self, resource_path, cache_path):
        self.calls.append((resource_path, cache_path))


def test_load_language_module_preserves_one_arg_language_modules():
    language = OneArgLanguage()

    config._load_language_module(language, "/app/resources", "/users/adrian/cache")

    assert language.calls == [("/app/resources",)]


def test_load_language_module_passes_cache_path_when_supported():
    language = TwoArgLanguage()

    config._load_language_module(language, "/app/resources", "/users/adrian/cache")

    assert language.calls == [("/app/resources", "/users/adrian/cache")]


def test_logging_crash_path_is_under_user_data_logs(tmp_path):
    log_dir = logging_utils.set_log_dir(str(tmp_path))

    assert log_dir == str(tmp_path / "logs")
    assert logging_utils.get_crash_log_path() == str(tmp_path / "logs" / "python_crash.log")


def test_atexit_handler_ignores_closed_logging_streams(monkeypatch, capsys):
    root = logging_utils._ensure_root_initialised()
    closed_stream = io.StringIO()
    handler = logging.StreamHandler(closed_stream)
    root.addHandler(handler)
    closed_stream.close()
    monkeypatch.setattr(logging_utils, "_crash_log_fp", None)

    try:
        logging_utils._atexit_handler()
    finally:
        root.removeHandler(handler)

    captured = capsys.readouterr()
    assert "Logging error" not in captured.err


def test_server_faulthandler_uses_configured_crash_log_path():
    server_source = Path(__file__).with_name("server.py").read_text(encoding="utf-8")
    startup_source = server_source[server_source.index("async def startup_event") :]

    assert "get_crash_log_path()" in startup_source
    assert 'os.path.join(config.RESPATH, "python_crash.log")' not in startup_source


def test_language_adapter_imports_search_installed_adapters_only():
    paths = config._language_module_search_paths("/users/adrian/AppData/language-data")

    assert paths == ["/users/adrian/AppData/language-data/adapters"]


def test_app_source_does_not_bundle_language_adapters_or_metadata():
    source_language_dir = ROOT_OF_APP / "languages"
    if not source_language_dir.exists():
        return

    bundled_language_files = [
        path
        for path in source_language_dir.iterdir()
        if path.suffix in {".py", ".json"}
    ]

    assert bundled_language_files == []


def test_app_source_does_not_bundle_dictionary_payloads():
    source_dictionary_dir = ROOT_OF_APP / "dictionaries"
    if not source_dictionary_dir.exists():
        return

    bundled_dictionary_files = [
        path
        for path in source_dictionary_dir.rglob("*")
        if path.is_file() and path.name != ".gitkeep"
    ]

    assert bundled_dictionary_files == []


def test_packaged_app_excludes_language_payloads():
    package_json = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
    root_resource = next(
        resource
        for resource in package_json["build"]["extraResources"]
        if resource.get("to") == "root-of-app/"
    )

    assert "!languages/**" in root_resource["filter"]
    assert "!dictionaries/**" in root_resource["filter"]


def test_metadata_only_language_uses_generic_adapter(tmp_path):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "zz.json").write_text(
        json.dumps({
            "name": "Test",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word", "lowercaseLemma": True}
                }
            },
        }),
        encoding="utf-8",
    )

    module = config._import_language_module("zz", str(tmp_path / "language-data"))

    assert isinstance(module, GenericLanguageModule)


def test_python_language_adapter_requires_explicit_metadata_path(tmp_path):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "yy.json").write_text(
        json.dumps({
            "name": "Adapter Test",
            "runtime": {
                "nlp": {
                    "adapter": {"type": "python-module"}
                }
            },
        }),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Python language adapter path is required"):
        config._import_language_module("yy", str(tmp_path / "language-data"))


def test_stale_python_language_adapter_is_ignored_when_metadata_is_generic(tmp_path):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "yy.json").write_text(
        json.dumps({
            "name": "Generic Test",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"}
                }
            },
        }),
        encoding="utf-8",
    )
    (languages_dir / "yy.py").write_text(
        "def LOAD_MODULE(resource_path, language_data_path=None):\n"
        "    raise RuntimeError('stale adapter should not load')\n",
        encoding="utf-8",
    )

    module_name = config._language_adapter_module_name("yy")
    sys.modules.pop(module_name, None)
    try:
        module = config._import_language_module("yy", str(tmp_path / "language-data"))
    finally:
        sys.modules.pop(module_name, None)

    assert isinstance(module, GenericLanguageModule)


def test_config_init_allows_backend_start_without_active_language_data(tmp_path, monkeypatch):
    user_data = tmp_path / "user-data"
    language_data = tmp_path / "language-data"
    user_data.mkdir()
    language_data.mkdir()

    monkeypatch.setattr(sys, "argv", [
        "server.py",
        "zz",
        str(ROOT_OF_APP),
        "true",
        "true",
        str(user_data),
        str(language_data),
    ])
    monkeypatch.setattr(config, "LANGUAGE", "")
    monkeypatch.setattr(config, "RESPATH", "")
    monkeypatch.setattr(config, "USER_DATA_PATH", "")
    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", "")
    monkeypatch.setattr(config, "LANGUAGE_DIR_PATH", "")
    monkeypatch.setattr(config, "LANGUAGE_METADATA", {})
    monkeypatch.setattr(plugin_registry, "_registry", {})
    monkeypatch.setattr(plugin_registry, "_active_language", "")

    config.init()

    assert config.LANGUAGE == "zz"
    assert config.LANGUAGE_DATA_PATH == str(language_data)
    assert plugin_registry.get_active() is None


def test_declared_python_language_adapter_can_use_custom_safe_path(tmp_path):
    language_data_root = tmp_path / "language-data"
    languages_dir = language_data_root / "languages"
    adapters_dir = language_data_root / "adapters"
    languages_dir.mkdir(parents=True)
    adapters_dir.mkdir(parents=True)
    (languages_dir / "yy.json").write_text(
        json.dumps({
            "name": "Custom Adapter Test",
            "runtime": {
                "nlp": {
                    "adapter": {
                        "type": "python-module",
                        "path": "adapters/custom_yy.py",
                    }
                }
            },
        }),
        encoding="utf-8",
    )
    (adapters_dir / "custom_yy.py").write_text(
        "def LOAD_MODULE(resource_path, language_data_path=None):\n"
        "    pass\n"
        "def LANGUAGE_TOKENIZE(text):\n"
        "    return [{'word': text, 'actual_word': text, 'type': 'CUSTOM'}]\n"
        "def LANGUAGE_TRANSLATE(word):\n"
        "    return {'data': []}\n",
        encoding="utf-8",
    )

    module_name = config._language_adapter_module_name("yy")
    sys.modules.pop(module_name, None)
    try:
        module = config._import_language_module("yy", str(language_data_root))
    finally:
        sys.modules.pop(module_name, None)

    assert not isinstance(module, GenericLanguageModule)
    assert module.LANGUAGE_TOKENIZE("x") == [
        {"word": "x", "actual_word": "x", "type": "CUSTOM"}
    ]


def test_runtime_level_python_adapter_can_power_non_nlp_capabilities(tmp_path):
    language_data_root = tmp_path / "language-data"
    languages_dir = language_data_root / "languages"
    adapters_dir = language_data_root / "adapters"
    languages_dir.mkdir(parents=True)
    adapters_dir.mkdir(parents=True)
    (languages_dir / "ar.json").write_text(
        json.dumps({
            "name": "Arabic",
            "runtime": {
                "adapter": {
                    "type": "python-module",
                    "path": "adapters/arabic_runtime.py",
                },
                "ocr": {
                    "recognitionEngine": "arabic-transformer-ocr",
                },
                "tts": {
                    "engine": "arabic-tts-adapter",
                },
            },
        }),
        encoding="utf-8",
    )
    (adapters_dir / "arabic_runtime.py").write_text(
        "def LOAD_MODULE(resource_path, language_data_path=None):\n"
        "    pass\n"
        "def LANGUAGE_OCR(image, options):\n"
        "    return {'boxes': [{'box': [[0, 0], [1, 0], [1, 1], [0, 1]], 'text': options['engine'], 'score': 1.0}]}\n"
        "def LANGUAGE_TTS(text, options):\n"
        "    return {'audio': text.encode('utf-8'), 'mediaType': 'audio/wav'}\n",
        encoding="utf-8",
    )

    module_name = config._language_adapter_module_name("ar")
    sys.modules.pop(module_name, None)
    try:
        module = config._import_language_module("ar", str(language_data_root))
    finally:
        sys.modules.pop(module_name, None)

    assert not isinstance(module, GenericLanguageModule)
    assert module.LANGUAGE_OCR(None, {"engine": "arabic-transformer-ocr"})["boxes"][0]["text"] == "arabic-transformer-ocr"
    assert module.LANGUAGE_TTS("مرحبا", {"engine": "arabic-tts-adapter"})["audio"] == "مرحبا".encode("utf-8")


def test_runtime_level_python_adapter_is_preferred_over_legacy_nlp_adapter(tmp_path):
    language_data_root = tmp_path / "language-data"
    languages_dir = language_data_root / "languages"
    adapters_dir = language_data_root / "adapters"
    languages_dir.mkdir(parents=True)
    adapters_dir.mkdir(parents=True)
    (languages_dir / "fa.json").write_text(
        json.dumps({
            "name": "Persian",
            "runtime": {
                "adapter": {
                    "type": "python-module",
                    "path": "adapters/runtime_adapter.py",
                },
                "nlp": {
                    "adapter": {
                        "type": "python-module",
                        "path": "adapters/nlp_adapter.py",
                    }
                },
            },
        }),
        encoding="utf-8",
    )
    (adapters_dir / "runtime_adapter.py").write_text(
        "def LOAD_MODULE(resource_path, language_data_path=None):\n"
        "    pass\n"
        "SOURCE = 'runtime'\n",
        encoding="utf-8",
    )
    (adapters_dir / "nlp_adapter.py").write_text(
        "def LOAD_MODULE(resource_path, language_data_path=None):\n"
        "    pass\n"
        "SOURCE = 'nlp'\n",
        encoding="utf-8",
    )

    module_name = config._language_adapter_module_name("fa")
    sys.modules.pop(module_name, None)
    try:
        module = config._import_language_module("fa", str(language_data_root))
    finally:
        sys.modules.pop(module_name, None)

    assert module.SOURCE == "runtime"


def test_declared_python_language_adapter_rejects_unsafe_paths(tmp_path):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "yy.json").write_text(
        json.dumps({
            "name": "Unsafe Adapter Test",
            "runtime": {
                "nlp": {
                    "adapter": {
                        "type": "python-module",
                        "path": "../outside.py",
                    }
                }
            },
        }),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Invalid language adapter path"):
        config._import_language_module("yy", str(tmp_path / "language-data"))


def test_declared_python_language_adapter_rejects_symlink_escape(tmp_path):
    language_data_root = tmp_path / "language-data"
    languages_dir = language_data_root / "languages"
    adapters_dir = language_data_root / "adapters"
    outside_dir = tmp_path / "outside"
    languages_dir.mkdir(parents=True)
    adapters_dir.mkdir()
    outside_dir.mkdir()
    (outside_dir / "escaped.py").write_text(
        "def LOAD_MODULE(resource_path, language_data_path=None):\n"
        "    pass\n",
        encoding="utf-8",
    )
    (adapters_dir / "escaped.py").symlink_to(outside_dir / "escaped.py")
    (languages_dir / "yy.json").write_text(
        json.dumps({
            "name": "Symlink Adapter Test",
            "runtime": {
                "nlp": {
                    "adapter": {
                        "type": "python-module",
                        "path": "adapters/escaped.py",
                    }
                }
            },
        }),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Invalid language adapter path"):
        config._import_language_module("yy", str(language_data_root))


def test_declared_python_language_adapter_missing_file_is_install_error(tmp_path):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "yy.json").write_text(
        json.dumps({
            "name": "Missing Adapter Test",
            "runtime": {
                "nlp": {
                    "adapter": {
                        "type": "python-module",
                        "path": "adapters/missing_yy.py",
                    }
                }
            },
        }),
        encoding="utf-8",
    )

    with pytest.raises(RuntimeError, match="Declared Python adapter"):
        config._import_language_module("yy", str(tmp_path / "language-data"))


def test_installed_python_language_adapter_supports_hyphenated_language_ids_when_declared(tmp_path):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "zh-Hant.json").write_text(
        json.dumps({
            "name": "Traditional Chinese",
            "runtime": {
                "nlp": {
                    "adapter": {
                        "type": "python-module",
                        "path": "adapters/zh_hant.py",
                    }
                }
            },
        }),
        encoding="utf-8",
    )
    adapters_dir = tmp_path / "language-data" / "adapters"
    adapters_dir.mkdir()
    (adapters_dir / "zh_hant.py").write_text(
        "def LOAD_MODULE(resource_path, language_data_path=None):\n"
        "    pass\n"
        "def LANGUAGE_TOKENIZE(text):\n"
        "    return [{'word': text, 'actual_word': text, 'type': 'WORD'}]\n"
        "def LANGUAGE_TRANSLATE(word):\n"
        "    return {'data': [{'definitions': word}]}\n",
        encoding="utf-8",
    )

    module_name = config._language_adapter_module_name("zh-Hant")
    sys.modules.pop(module_name, None)
    try:
        module = config._import_language_module("zh-Hant", str(tmp_path / "language-data"))
    finally:
        sys.modules.pop(module_name, None)

    assert not isinstance(module, GenericLanguageModule)
    assert module.__name__ == module_name
    assert module.LANGUAGE_TOKENIZE("繁體") == [
        {"word": "繁體", "actual_word": "繁體", "type": "WORD"}
    ]


def test_get_or_load_language_lazily_registers_metadata_language(tmp_path, monkeypatch):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "ww.json").write_text(
        json.dumps({
            "name": "Lazy Test",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"}
                }
            },
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(tmp_path / "language-data"))

    module = config.get_or_load_language("ww")

    assert isinstance(module, GenericLanguageModule)
    assert plugin_registry.get_language("ww") is module


def test_get_or_load_language_reloads_when_installed_metadata_changes(tmp_path, monkeypatch):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    metadata_path = languages_dir / "ww.json"
    metadata_path.write_text(
        json.dumps({
            "name": "Reload Test",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word"}
                }
            },
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(tmp_path / "language-data"))
    monkeypatch.setattr(plugin_registry, "_registry", {})

    first = config.get_or_load_language("ww")
    assert isinstance(first, GenericLanguageModule)
    assert first._tokenizer_config().get("lowercaseLemma") is None

    metadata_path.write_text(
        json.dumps({
            "name": "Reload Test",
            "runtime": {
                "nlp": {
                    "tokenizer": {"type": "unicode-word", "lowercaseLemma": True}
                }
            },
        }),
        encoding="utf-8",
    )

    second = config.get_or_load_language("ww")

    assert isinstance(second, GenericLanguageModule)
    assert second is not first
    assert second._tokenizer_config()["lowercaseLemma"] is True
    assert plugin_registry.get_language("ww") is second


def test_get_or_load_language_ignores_python_adapter_without_metadata(tmp_path, monkeypatch):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "pyonly.py").write_text(
        "def LOAD_MODULE(resource_path, language_data_path=None):\n"
        "    pass\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(tmp_path / "language-data"))

    assert config.get_or_load_language("pyonly") is None


def test_get_or_load_language_rejects_unsafe_ids(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(tmp_path / "language-data"))

    assert config.get_or_load_language("../os") is None


def test_runtime_config_can_be_read_for_non_active_installed_language(tmp_path, monkeypatch):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "aa.json").write_text(
        json.dumps({
            "name": "Active",
            "runtime": {"tts": {"qwen3LanguageName": "active"}},
        }),
        encoding="utf-8",
    )
    (languages_dir / "bb.json").write_text(
        json.dumps({
            "name": "Other",
            "runtime": {
                "tts": {"qwen3LanguageName": "other"},
                "ocr": {"paddleLang": "other-ocr"},
            },
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(config, "LANGUAGE", "aa")
    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(tmp_path / "language-data"))
    monkeypatch.setattr(config, "LANGUAGE_METADATA", {
        "runtime": {"tts": {"qwen3LanguageName": "active"}}
    })

    assert config.language_runtime_config_for_language("bb", "tts") == {"qwen3LanguageName": "other"}
    assert config.language_runtime_config_for_language("bb", "ocr") == {"paddleLang": "other-ocr"}
    assert not hasattr(config, "language_feature_enabled_for_language")
    assert not hasattr(config, "language_feature_enabled")
    assert config.language_supports_vertical_text_for_language("bb") is False


def test_runtime_config_for_active_language_reflects_installed_metadata_updates(tmp_path, monkeypatch):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    metadata_path = languages_dir / "aa.json"
    metadata_path.write_text(
        json.dumps({
            "name": "Active",
            "runtime": {"ocr": {"rapidLangType": "LATIN"}},
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(config, "LANGUAGE", "aa")
    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(tmp_path / "language-data"))
    monkeypatch.setattr(config, "LANGUAGE_METADATA", {
        "name": "Active",
        "runtime": {"ocr": {"rapidLangType": "OLD"}},
    })

    assert config.language_runtime_config_for_language("aa", "ocr") == {"rapidLangType": "LATIN"}

    metadata_path.write_text(
        json.dumps({
            "name": "Active",
            "runtime": {"ocr": {"rapidLangType": "CYRILLIC"}},
        }),
        encoding="utf-8",
    )

    assert config.language_runtime_config_for_language("aa", "ocr") == {"rapidLangType": "CYRILLIC"}


def test_text_processing_config_can_be_read_for_non_active_installed_language(tmp_path, monkeypatch):
    languages_dir = tmp_path / "language-data" / "languages"
    languages_dir.mkdir(parents=True)
    (languages_dir / "hi.json").write_text(
        json.dumps({
            "name": "Hindi",
            "textProcessing": {
                "sentenceTerminators": ["।"],
            },
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(config, "LANGUAGE", "en")
    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(tmp_path / "language-data"))
    monkeypatch.setattr(config, "LANGUAGE_METADATA", {})

    assert config.language_text_processing_config_for_language("hi") == {
        "sentenceTerminators": ["।"],
    }
