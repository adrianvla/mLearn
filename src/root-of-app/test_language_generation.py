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
