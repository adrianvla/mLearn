import importlib.util
import sys
import types
import unittest
from pathlib import Path


ADAPTERS_DIR = Path(__file__).resolve().parents[1] / "source" / "root-of-app" / "adapters"


class _GenericLanguageModule:
    def __init__(self, _language):
        self.metadata = {}


def _load_adapter(name: str, stubs: dict[str, types.ModuleType]):
    previous = {module_name: sys.modules.get(module_name) for module_name in stubs}
    try:
        sys.modules.update(stubs)
        spec = importlib.util.spec_from_file_location(name, ADAPTERS_DIR / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module
    finally:
        for module_name, old_module in previous.items():
            if old_module is None:
                sys.modules.pop(module_name, None)
            else:
                sys.modules[module_name] = old_module


def _generic_language_stub():
    module = types.ModuleType("generic_language")
    module.GenericLanguageModule = _GenericLanguageModule
    return module


class _TokenBackend:
    def __init__(self, tokens):
        self.tokens = tokens

    def LANGUAGE_TOKENIZE(self, _text):
        return self.tokens


class LanguageAdapterTest(unittest.TestCase):
    def test_russian_uses_contextual_stress_and_dictionary_fallback(self):
        silero = types.ModuleType("silero_stress")
        silero.load_accentor = lambda: None
        adapter = _load_adapter("russian_adapter", {
            "generic_language": _generic_language_stub(),
            "silero_stress": silero,
        })
        adapter._backend = _TokenBackend([
            {"word": "Все", "actual_word": "весь", "type": "DET"},
            {"word": "замки", "actual_word": "замок", "type": "NOUN"},
            {"word": "редкость", "actual_word": "редкость", "type": "NOUN"},
        ])
        adapter._accentor = lambda _text: "Вс+е замк+и — р+едкость"
        adapter._pronunciations = {"редкость": "ре́дкость"}

        tokens = adapter.LANGUAGE_TOKENIZE("Все замки — редкость")

        self.assertEqual([token.get("reading") for token in tokens], ["Все́", "замки́", "ре́дкость"])
        self.assertEqual(adapter._alignment_key("Лева"), adapter._alignment_key("Л+ёва"))

    def test_mandarin_adds_tone_marked_pinyin_only_to_han_tokens(self):
        pypinyin = types.ModuleType("pypinyin")
        pypinyin.Style = types.SimpleNamespace(TONE="tone")
        pypinyin.lazy_pinyin = lambda text, **_kwargs: {
            "重庆": ["chóng", "qìng"],
        }.get(text, [text])
        adapter = _load_adapter("mandarin_adapter", {
            "generic_language": _generic_language_stub(),
            "pypinyin": pypinyin,
        })
        adapter._backend = _TokenBackend([
            {"word": "重慶", "actual_word": "重慶", "type": "PROPN"},
            {"word": "2026", "actual_word": "2026", "type": "NUM"},
        ])
        adapter._pinyin_input_converter = types.SimpleNamespace(
            convert=lambda text: "重庆" if text == "重慶" else text,
        )

        tokens = adapter.LANGUAGE_TOKENIZE("重慶 2026")

        self.assertEqual(tokens[0]["reading"], "chóng qìng")
        self.assertNotIn("reading", tokens[1])


if __name__ == "__main__":
    unittest.main()
