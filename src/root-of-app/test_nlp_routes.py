import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from generic_language import _dictionary_target_for_language
from routes import nlp


def test_tokenize_logs_counts_without_request_text(monkeypatch, caplog):
    secret = "private learner conversation おはようございます。"

    class Module:
        def LANGUAGE_TOKENIZE(self, text):
            return [{"word": text}]

    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda _language: Module())
    # The production logger owns its handlers instead of propagating to root.
    monkeypatch.setattr(logging.getLogger("mlearn"), "propagate", True)
    with caplog.at_level(logging.INFO, logger="mlearn.nlp"):
        response = nlp.tokenize(nlp.TokenizeRequest(text=secret, language="xx"))

    assert response == {"tokens": [{"word": secret}]}
    assert caplog.records
    assert secret not in caplog.text
    assert f"characters={len(secret)}" in caplog.text


def test_translate_logs_counts_without_request_word(monkeypatch, caplog):
    secret = "private dictionary lookup"

    class Module:
        def LANGUAGE_TRANSLATE(self, word):
            return {"data": [{"word": word}]}

    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda _language: Module())
    monkeypatch.setattr(logging.getLogger("mlearn"), "propagate", True)
    with caplog.at_level(logging.INFO, logger="mlearn.nlp"):
        response = nlp.get_translation(nlp.TranslationRequest(word=secret, language="xx"))

    assert response == {"data": [{"word": secret}]}
    assert caplog.records
    assert secret not in caplog.text
    assert f"characters={len(secret)}" in caplog.text


def test_translate_route_applies_camel_case_dictionary_target(monkeypatch):
    class Module:
        language = "xx"

        def LANGUAGE_TRANSLATE(self, word):
            return {"data": [{"word": word, "target": _dictionary_target_for_language("xx")}]}

    module = Module()
    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda language: module if language == "xx" else None)

    response = nlp.get_translation(
        nlp.TranslationRequest(word="字", language="xx", dictionaryTargetLanguage="fr")
    )

    assert response == {"data": [{"word": "字", "target": "fr"}]}
    assert _dictionary_target_for_language("xx") is None


def test_tokenize_route_does_not_fall_back_to_active_module_for_missing_requested_language(monkeypatch):
    class ActiveModule:
        def LANGUAGE_TOKENIZE(self, _text):
            return [{"word": "active-language-token"}]

    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda _language: None)
    monkeypatch.setattr(nlp.plugin_registry, "get_active", lambda: ActiveModule())

    response = nlp.tokenize(nlp.TokenizeRequest(text="مرحبا", language="ar"))

    assert response == {"tokens": []}


def test_translate_route_does_not_fall_back_to_active_module_for_missing_requested_language(monkeypatch):
    class ActiveModule:
        def LANGUAGE_TRANSLATE(self, _word):
            return {"data": [{"word": "active-language-definition"}]}

    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda _language: None)
    monkeypatch.setattr(nlp.plugin_registry, "get_active", lambda: ActiveModule())

    response = nlp.get_translation(nlp.TranslationRequest(word="سلام", language="fa"))

    assert response == {"data": []}
