import importlib
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def _import_qwen3_with_lightweight_deps(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", types.ModuleType("torch"))
    monkeypatch.setitem(sys.modules, "torchaudio", types.ModuleType("torchaudio"))
    sys.modules.pop("qwen3_tts_server", None)
    return importlib.import_module("qwen3_tts_server")


def _import_moss_with_lightweight_deps(monkeypatch):
    fake_torch = types.ModuleType("torch")
    fake_torch.dtype = object
    fake_torch.float16 = object()
    fake_torch.bfloat16 = object()
    fake_torch.float32 = object()
    fake_torch.cuda = types.SimpleNamespace(
        is_available=lambda: False,
        get_device_capability=lambda: (0, 0),
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "torchaudio", types.ModuleType("torchaudio"))
    sys.modules.pop("moss_tts_server", None)
    return importlib.import_module("moss_tts_server")


def test_qwen3_remote_splitter_uses_language_metadata_terminators(tmp_path, monkeypatch):
    qwen3 = _import_qwen3_with_lightweight_deps(monkeypatch)
    language_data_path = tmp_path / "language-data"
    languages_dir = language_data_path / "languages"
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
    qwen3._set_language_data_path(str(language_data_path))

    text = "नमस्ते। फिर मिलेंगे। Hello. Still one segment."

    assert qwen3._split_into_sentences(text, "hi") == [
        "नमस्ते।",
        "फिर मिलेंगे।",
        "Hello. Still one segment.",
    ]


def test_qwen3_remote_splitter_falls_back_to_multilingual_defaults(monkeypatch):
    qwen3 = _import_qwen3_with_lightweight_deps(monkeypatch)

    assert qwen3._split_into_sentences("مرحبا؟ 你好。Hello.") == [
        "مرحبا؟",
        "你好。",
        "Hello.",
    ]


def test_moss_remote_splitter_uses_language_metadata_terminators(tmp_path, monkeypatch):
    moss = _import_moss_with_lightweight_deps(monkeypatch)
    language_data_path = tmp_path / "language-data"
    languages_dir = language_data_path / "languages"
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
    moss._set_language_data_path(str(language_data_path))

    text = "नमस्ते। फिर मिलेंगे। Hello. Still one segment."

    assert moss._split_into_sentences(text, "hi") == [
        "नमस्ते।",
        "फिर मिलेंगे।",
        "Hello. Still one segment.",
    ]


def test_moss_remote_splitter_falls_back_to_multilingual_defaults(monkeypatch):
    moss = _import_moss_with_lightweight_deps(monkeypatch)

    assert moss._split_into_sentences("مرحبا؟ 你好。Hello.") == [
        "مرحبا؟",
        "你好。",
        "Hello.",
    ]
