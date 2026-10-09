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


def test_unrelated_source_language_does_not_borrow_ambient_variant(tmp_path, monkeypatch):
    (tmp_path / 'languages').mkdir()
    metadata = {'name': 'Base', 'variants': {'future-register': {'overrides': {'name': 'Wrong ambient variant'}}}}
    (tmp_path / 'languages/qb.json').write_text(json.dumps(metadata))
    monkeypatch.setattr(config, 'LANGUAGE_DATA_PATH', str(tmp_path))
    monkeypatch.setattr(config, 'LANGUAGE', 'qa')
    monkeypatch.setattr(config, 'ACTIVE_VARIANT', 'future-register')
    assert config.get_or_load_language('qb').metadata['name'] == 'Base'


def test_explicit_source_variants_are_independent_of_ambient_and_each_other(tmp_path, monkeypatch):
    (tmp_path / 'languages').mkdir()
    metadata = {'name': 'Base', 'variants': {key: {'overrides': {'name': key}} for key in ['future-first', 'future-second']}}
    (tmp_path / 'languages/qv.json').write_text(json.dumps(metadata))
    monkeypatch.setattr(config, 'LANGUAGE_DATA_PATH', str(tmp_path))
    monkeypatch.setattr(config, 'LANGUAGE', 'qv')
    monkeypatch.setattr(config, 'ACTIVE_VARIANT', 'future-second')
    first = config.get_or_load_language('qv', variant='future-first')
    second = config.get_or_load_language('qv', variant='future-second')
    base = config.get_or_load_language('qv', variant=None)
    assert [module.metadata['name'] for module in [first, second, base]] == ['future-first', 'future-second', 'Base']
    assert len({module.__mlearn_metadata_fingerprint for module in [first, second, base]}) == 3
    assert config.get_or_load_language('qv', variant='future-first') is first
    assert config.get_or_load_language('qv', variant='unknown-declared-nowhere') is None


def test_nlp_http_admits_explicit_base_and_package_variant(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes import nlp
    (tmp_path / 'languages').mkdir()
    (tmp_path / 'adapters').mkdir()
    (tmp_path / 'adapters/source.py').write_text("metadata = {}\ndef LOAD_MODULE(resource, language_data, metadata=None):\n globals()['metadata'] = metadata\ndef LANGUAGE_TOKENIZE(text):\n return [{'word': metadata['runtime']['adapter']['config']['label']}]\n")
    metadata = {'runtime': {'adapter': {'type': 'python-module', 'path': 'adapters/source.py', 'config': {'label': 'base'}}},
                'variants': {key: {'overrides': {'runtime.adapter.config': {'label': key}}} for key in ['future-first', 'future-second']}}
    (tmp_path / 'languages/qh.json').write_text(json.dumps(metadata))
    monkeypatch.setattr(config, 'LANGUAGE_DATA_PATH', str(tmp_path))
    monkeypatch.setattr(config, 'LANGUAGE', 'qh')
    monkeypatch.setattr(config, 'ACTIVE_VARIANT', 'future-second')
    app = FastAPI(); app.include_router(nlp.router)
    client = TestClient(app)
    for variant, expected in [('future-first', 'future-first'), (None, 'base'), ('future-second', 'future-second'), ('future-first', 'future-first')]:
        response = client.post('/tokenize', json={'text': 'term', 'language': 'qh', 'variant': variant})
        assert response.status_code == 200, response.text
        assert response.json()['tokens'][0]['word'] == expected
    response = client.post('/tokenize', json={'text': 'term', 'language': 'qh', 'variant': 'unknown'})
    assert response.status_code == 503


def test_runtime_source_scope_survives_ambient_changes_and_worker_handoff(tmp_path, monkeypatch):
    import asyncio
    from language_scope import scoped_language_request, run_in_executor_scoped
    (tmp_path / 'languages').mkdir()
    metadata = {'runtime': {'adapter': {'config': {'label': 'base'}}}, 'variants': {
        key: {'overrides': {'runtime.adapter.config': {'label': key}}} for key in ['first', 'second']}}
    (tmp_path / 'languages/qs.json').write_text(json.dumps(metadata))
    monkeypatch.setattr(config, 'LANGUAGE_DATA_PATH', str(tmp_path))
    monkeypatch.setattr(config, 'LANGUAGE', 'qs'); monkeypatch.setattr(config, 'ACTIVE_VARIANT', 'second')
    @scoped_language_request
    async def operation(language=None, variant=None):
        config.ACTIVE_VARIANT = 'second'
        return await run_in_executor_scoped(asyncio.get_running_loop(), None,
            lambda: config._metadata_for_language(language)['runtime']['adapter']['config']['label'])
    assert asyncio.run(operation(language='qs', variant='first')) == 'first'
    assert asyncio.run(operation(language='qs', variant=None)) == 'base'
    assert config._metadata_for_language('qs')['runtime']['adapter']['config']['label'] == 'second'


def test_normal_nlp_http_honors_retained_generation_after_publication(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes import nlp
    old = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    new = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    for generation, label in [(old, 'old'), (new, 'new')]:
        root = tmp_path / '.generations' / generation
        (root / 'languages').mkdir(parents=True)
        (root / 'adapters').mkdir()
        (root / 'languages/qg.json').write_text(json.dumps({'runtime': {'adapter': {'type': 'python-module', 'path': 'adapters/source.py'}}}))
        (root / 'adapters/source.py').write_text(
            f"def LOAD_MODULE(*args, **kwargs): pass\ndef LANGUAGE_TOKENIZE(text): return [{{'word': '{label}'}}]\ndef LANGUAGE_TRANSLATE(word): return {{'data': [{{'definitions': '{label}'}}]}}\ndef LANGUAGE_DICTIONARY_WORDS(): return {{'words': [['{label}', '']]}}\n")
    (tmp_path / '.active-generation.json').write_text(json.dumps({'generation': new}))
    monkeypatch.setattr(config, 'LANGUAGE_DATA_PATH', str(tmp_path))
    app = FastAPI(); app.include_router(nlp.router)
    client = TestClient(app)
    for route, payload, field in [('tokenize', {'text': 'term'}, 'tokens'), ('translate', {'word': 'term'}, 'data'), ('dictionary-words', {}, 'words')]:
        response = client.post('/' + route, json={**payload, 'language': 'qg', 'generation': old})
        assert response.status_code == 200, response.text
        assert 'old' in json.dumps(response.json()[field])
        assert 'new' not in json.dumps(response.json()[field])
        unavailable = client.post('/' + route, json={**payload, 'language': 'qg', 'generation': 'cccccccc-cccc-cccc-cccc-cccccccccccc'})
        assert unavailable.status_code == 409
    assert resolve_language_data_root(str(tmp_path)).endswith(new)
