import importlib
import sys

from fastapi.testclient import TestClient


def import_server(monkeypatch, tmp_path):
    language_data_path = tmp_path / "language-data"
    language_data_path.mkdir()
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "server.py",
            "ja",
            str(tmp_path),
            "false",
            "false",
            str(tmp_path),
            str(language_data_path),
        ],
    )
    sys.modules.pop("server", None)
    return importlib.import_module("server")


def test_tokenize_errors_include_cors_headers(monkeypatch, tmp_path):
    server = import_server(monkeypatch, tmp_path)

    class FailingLanguageModule:
        def LANGUAGE_TOKENIZE(self, _text):
            raise RuntimeError("required tokenizer missing")

    monkeypatch.setattr(
        server.nlp.config,
        "get_or_load_language",
        lambda _language: FailingLanguageModule(),
    )

    client = TestClient(server.app, raise_server_exceptions=False)
    response = client.post(
        "/tokenize",
        headers={"Origin": "http://localhost:3000"},
        json={"text": "漢字", "language": "ja"},
    )

    assert response.status_code >= 500
    assert response.headers["access-control-allow-origin"] == "*"


def test_tokenize_preflight_includes_cors_headers(monkeypatch, tmp_path):
    server = import_server(monkeypatch, tmp_path)

    client = TestClient(server.app, raise_server_exceptions=False)
    response = client.options(
        "/tokenize",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "content-type" in response.headers["access-control-allow-headers"].lower()


def test_middleware_errors_include_cors_headers(monkeypatch, tmp_path):
    server = import_server(monkeypatch, tmp_path)

    def fail_info(*_args, **_kwargs):
        raise RuntimeError("logging backend unavailable")

    monkeypatch.setattr(server.log, "info", fail_info)

    client = TestClient(server.app, raise_server_exceptions=False)
    response = client.post(
        "/tokenize",
        headers={"Origin": "http://localhost:3000"},
        json={"text": "漢字", "language": "ja"},
    )

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "*"
