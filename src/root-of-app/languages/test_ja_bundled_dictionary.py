import json
import sys
from pathlib import Path


ROOT_OF_APP = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT_OF_APP.parents[1]
sys.path.insert(0, str(ROOT_OF_APP))


def test_japanese_runtime_uses_bundled_sqlite_read_only():
    source = (ROOT_OF_APP / "languages" / "ja.py").read_text(encoding="utf-8")

    assert 'DB_FILENAME = "dictionary.db"' in source
    assert 'DICTIONARY_DIRNAME = "ja"' in source
    assert "mode=ro" in source
    assert "PRAGMA query_only=1" in source
    assert "def _rebuild_database" not in source
    assert "def _populate_entries" not in source
    assert "term_bank_*.json" not in source


def test_japanese_dictionary_build_script_is_part_of_prebuild():
    package_json = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))

    assert "build:japanese-dict" in package_json["scripts"]
    assert "build:japanese-dict" in package_json["scripts"]["prebuild"]


def test_packaged_app_excludes_japanese_yomitan_json_inputs():
    package_json = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
    root_resource = next(
        resource
        for resource in package_json["build"]["extraResources"]
        if resource.get("to") == "root-of-app/"
    )

    assert "!dictionaries/jitendex-yomitan/**" in root_resource["filter"]
    assert "!dictionaries/ja/**" not in root_resource["filter"]
