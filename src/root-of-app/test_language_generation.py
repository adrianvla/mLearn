import json
import sqlite3
from pathlib import Path

import config
from language_generation import admit_language_generation, release_language_generation, resolve_language_data_root


def test_identical_metadata_dictionary_update_uses_admitted_generation(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "LANGUAGE_DATA_PATH", str(tmp_path))
    metadata = {"runtime": {"nlp": {"dictionary": {"type": "sqlite", "schema": "headword-json", "path": "dictionaries/source.db"}}}}
    roots = []
    for generation, translation in [("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "old"), ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "new")]:
        root = tmp_path / ".generations" / generation
        (root / "languages").mkdir(parents=True)
        (root / "dictionaries").mkdir()
        (root / "languages" / "qx.json").write_text(json.dumps(metadata))
        with sqlite3.connect(root / "dictionaries" / "source.db") as db:
            db.execute("create table dictionary (headword text, data text)")
            db.execute("insert into dictionary values (?, ?)", ("term", translation))
        roots.append((generation, root))
    pointer = tmp_path / ".active-generation.json"
    pointer.write_text(json.dumps({"generation": roots[0][0]}))
    first = config.get_or_load_language("qx")
    token = admit_language_generation(str(tmp_path))
    try:
        pointer.write_text(json.dumps({"generation": roots[1][0]}))
        assert Path(resolve_language_data_root(str(tmp_path))) == roots[0][1]
        assert config.get_or_load_language("qx") is first
    finally:
        release_language_generation(token)
    second = config.get_or_load_language("qx")
    assert second is not first
    assert first.language_data_dir == roots[0][1]
    assert second.language_data_dir == roots[1][1]
    assert (roots[0][1] / "dictionaries/source.db").is_file()


def test_missing_declared_adapter_does_not_prevent_backend_bootstrap(tmp_path):
    import subprocess
    import sys
    root = tmp_path / 'language-data'
    (root / 'languages').mkdir(parents=True)
    (root / 'languages/qx.json').write_text(json.dumps({'runtime': {'adapter': {'type': 'python-module', 'path': 'adapters/missing.py'}}}))
    process = subprocess.run([sys.executable, '-c', 'import config; config.init(); print("BOOTSTRAP_AVAILABLE")', 'qx', str(tmp_path), 'false', 'false', str(tmp_path), str(root)],
        cwd=Path(__file__).parent, text=True, capture_output=True)
    assert process.returncode == 0, process.stderr
    assert 'BOOTSTRAP_AVAILABLE' in process.stdout


def test_missing_declared_adapter_is_an_explicit_nlp_unavailability(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes import nlp
    (tmp_path / 'languages').mkdir()
    (tmp_path / 'languages/qx.json').write_text(json.dumps({'runtime': {'adapter': {'type': 'python-module', 'path': 'adapters/missing.py'}}}))
    monkeypatch.setattr(config, 'LANGUAGE_DATA_PATH', str(tmp_path))
    app = FastAPI(); app.include_router(nlp.router)
    response = TestClient(app).post('/tokenize', json={'text': 'term', 'language': 'qx'})
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'language_unavailable'
