import logging
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
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

    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda _language, **_scope: Module())
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

    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda _language, **_scope: Module())
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
    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda language, **_scope: module if language == "xx" else None)

    response = nlp.get_translation(
        nlp.TranslationRequest(word="字", language="xx", dictionaryTargetLanguage="fr")
    )

    assert response == {"data": [{"word": "字", "target": "fr"}]}
    assert _dictionary_target_for_language("xx") is None


def test_tokenize_route_does_not_fall_back_to_active_module_for_missing_requested_language(monkeypatch):
    class ActiveModule:
        def LANGUAGE_TOKENIZE(self, _text):
            return [{"word": "active-language-token"}]

    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda _language, **_scope: None)
    monkeypatch.setattr(nlp.plugin_registry, "get_active", lambda: ActiveModule())

    with pytest.raises(HTTPException) as error:
        nlp.tokenize(nlp.TokenizeRequest(text="مرحبا", language="ar"))
    assert error.value.status_code == 503


def test_translate_route_does_not_fall_back_to_active_module_for_missing_requested_language(monkeypatch):
    class ActiveModule:
        def LANGUAGE_TRANSLATE(self, _word):
            return {"data": [{"word": "active-language-definition"}]}

    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda _language, **_scope: None)
    monkeypatch.setattr(nlp.plugin_registry, "get_active", lambda: ActiveModule())

    with pytest.raises(HTTPException) as error:
        nlp.get_translation(nlp.TranslationRequest(word="سلام", language="fa"))
    assert error.value.status_code == 503


def test_translate_route_invokes_optional_resolver_and_preserves_unknown_candidate_data(monkeypatch):
    context = {"surface": "X", "hints": {"new::category": {"values": ["a", "b"]}}}
    expected = {"data": [], "resolution": {"selectedId": "package-owned", "basis": "package-owned-basis", "candidates": [{"id": "package-owned", "label": "X", "data": [], "metadata": {"new::category": {"values": ["a", "b"]}}}]}}
    class Module:
        language = "zz"
        def LANGUAGE_RESOLVE(self, word, received):
            assert word == "X"
            assert received == context
            assert _dictionary_target_for_language("zz") == "fr"
            return expected
    monkeypatch.setattr(nlp.config, "get_or_load_language", lambda language, **_scope: Module())
    result = nlp.get_translation(nlp.TranslationRequest(word="X", language="zz", dictionaryTargetLanguage="fr", context=context))
    assert result == expected
    assert nlp.TranslationResponse(**result).model_dump()["resolution"] == expected["resolution"]


@pytest.mark.parametrize("endpoint,payload,empty", [
    ("/tokenize", {"text": ".", "language": "future-package"}, {"tokens": []}),
    ("/translate", {"word": "no-match", "language": "future-package"}, {"data": [], "resolution": None}),
    ("/dictionary-words", {"language": "future-package"}, {"words": []}),
])
def test_http_unavailable_then_ready_preserves_legitimate_empty(monkeypatch, endpoint, payload, empty):
    class Module:
        def LANGUAGE_TOKENIZE(self, text):
            return []
        def LANGUAGE_TRANSLATE(self, word):
            return {"data": []}
        def LANGUAGE_DICTIONARY_WORDS(self):
            return {"words": []}
    app = FastAPI()
    app.include_router(nlp.router)
    with TestClient(app) as client:
        monkeypatch.setattr(nlp.config, "get_or_load_language", lambda language, **_scope: None)
        unavailable = client.post(endpoint, json=payload)
        assert unavailable.status_code == 503
        assert unavailable.json()["detail"]["code"] == "language_unavailable"
        monkeypatch.setattr(nlp.config, "get_or_load_language", lambda language, **_scope: Module())
        ready = client.post(endpoint, json=payload)
        assert ready.status_code == 200
        assert ready.json() == empty


def test_ready_route_acknowledges_exact_external_voice_provider(monkeypatch):
    import language_generation
    from routes import voice
    calls = []
    monkeypatch.setattr(language_generation, 'admit_language_generation', lambda *_args: object())
    monkeypatch.setattr(language_generation, 'release_language_generation', lambda _token: calls.append('released'))
    monkeypatch.setattr(nlp, '_resolve_module', lambda *_args: object())
    monkeypatch.setattr(nlp.config, '_read_language_metadata', lambda _: {})
    monkeypatch.setattr(voice, 'ensure_language_voice_ready', lambda language, provider=None: calls.append((language, provider)))
    result = nlp.language_ready(nlp.LanguageReadyRequest(language='future-package', generation='candidate-generation', components=['core', 'voice'], variant='package-variant', ttsProvider='system'))
    assert result == {'language': 'future-package', 'generation': 'candidate-generation', 'components': ['core', 'voice'], 'variant': 'package-variant', 'ttsProvider': 'system', 'ready': True}
    assert calls == [('future-package', 'system'), 'released']
