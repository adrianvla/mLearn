import json
import sys
from pathlib import Path


ROOT_OF_APP = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT_OF_APP.parents[1]
sys.path.insert(0, str(ROOT_OF_APP))


def test_japanese_runtime_uses_on_demand_sqlite_read_only():
    source = (ROOT_OF_APP / "languages" / "ja.py").read_text(encoding="utf-8")

    assert 'DB_FILENAME = "dictionary.db"' in source
    assert 'DICTIONARY_DIRNAME = "ja"' in source
    assert "mode=ro" in source
    assert "PRAGMA query_only=1" in source
    assert "def load_dictionary(resource_folder, language_data_folder=None)" in source
    assert "def _rebuild_database" not in source
    assert "def _populate_entries" not in source
    assert "term_bank_*.json" not in source


def test_language_dictionary_builds_are_not_part_of_app_prebuild():
    package_json = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))

    assert "build:japanese-dict" in package_json["scripts"]
    assert "build:language-data" in package_json["scripts"]
    assert "build:japanese-dict" not in package_json["scripts"]["prebuild"]
    assert "build:german-dict" not in package_json["scripts"]["prebuild"]


def test_packaged_app_excludes_language_dictionary_payloads():
    package_json = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
    root_resource = next(
        resource
        for resource in package_json["build"]["extraResources"]
        if resource.get("to") == "root-of-app/"
    )

    assert "!dictionaries/**" in root_resource["filter"]
