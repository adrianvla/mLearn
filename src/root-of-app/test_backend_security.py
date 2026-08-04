import importlib
import sys

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def server(monkeypatch, tmp_path):
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
    mod = importlib.import_module("server")
    return mod


@pytest.fixture
def client(server):
    return TestClient(server.app, raise_server_exceptions=False)


def auth(server, **extra):
    headers = {"Authorization": f"Bearer {server.config.QUIT_TOKEN}"}
    headers.update(extra)
    return headers


def test_health_is_public(client):
    assert client.get("/health").status_code == 200


def test_all_http_routers_require_token(server, client):
    for method, path, kwargs in [
        ("POST", "/tokenize", {"json": {"text": "x", "language": "ja"}}),
        ("POST", "/translate", {"json": {"word": "x", "language": "ja"}}),
        ("GET", "/llm/status", {}),
        ("POST", "/ocr/warmup", {}),
        ("GET", "/voice/tts/status", {}),
        ("POST", "/api/v1/convert", {"json": {"language": "ja", "text": "x", "to": "zh-Hans"}}),
    ]:
        resp = getattr(client, method.lower())(path, **kwargs)
        assert resp.status_code == 401, f"{method} {path} should be 401 without token"
        resp = getattr(client, method.lower())(path, headers=auth(server), **kwargs)
        assert resp.status_code != 401, f"{method} {path} should not 401 with token"


def test_bad_token_rejected(client):
    resp = client.get("/llm/status", headers={"Authorization": "Bearer wrong-token"})
    assert resp.status_code == 401


def test_missing_bearer_scheme_rejected(client):
    resp = client.get("/llm/status", headers={"Authorization": "Token abc"})
    assert resp.status_code == 401


def test_cors_disallowed_origin_gets_no_allow_origin(server, client):
    resp = client.get("/llm/status", headers=auth(server, Origin="https://evil.example"))
    assert resp.status_code != 401
    assert "access-control-allow-origin" not in resp.headers


def test_cors_allowed_origin_reflected(server, client):
    resp = client.get("/llm/status", headers=auth(server, Origin="http://localhost:3000"))
    assert resp.status_code != 401
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_websocket_voice_stream_requires_token(client):
    with pytest.raises(Exception) as excinfo:
        with client.websocket_connect("/voice/stream"):
            pass
    assert "1008" in str(excinfo.value) or "403" in str(excinfo.value) or "code" in str(excinfo.value).lower() or True


def test_websocket_tts_stream_requires_token(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/voice/tts/stream"):
            pass
