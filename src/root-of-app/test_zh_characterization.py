import importlib.util
import json
import shutil
import sqlite3
import sys
import zlib
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from generic_language import GenericLanguageModule

REPO_ROOT = Path(__file__).resolve().parents[2]
PACK_SOURCE = REPO_ROOT / "scripts" / "language-data" / "source" / "root-of-app"
LANGUAGES_SOURCE = PACK_SOURCE / "languages"
ADAPTER_SOURCE = PACK_SOURCE / "adapters" / "mandarin_adapter.py"


def _zjson(value) -> bytes:
    return zlib.compress(json.dumps(value).encode("utf-8"))


def _write_fixture_dictionary(db_path: Path, entries: list[tuple[str, str, dict]]) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO meta VALUES ('version', '1:zh-characterization-fixture')")
    conn.execute("CREATE TABLE entries (id INTEGER PRIMARY KEY, headword TEXT, reading TEXT, data BLOB)")
    for headword, reading, payload in entries:
        conn.execute(
            "INSERT INTO entries (headword, reading, data) VALUES (?, ?, ?)",
            (headword, reading, _zjson(payload)),
        )
    conn.commit()
    conn.close()


def _install_language_metadata(data_root: Path, language: str, mutate=None) -> None:
    target = data_root / "languages"
    target.mkdir(parents=True, exist_ok=True)
    if mutate is None:
        shutil.copy(LANGUAGES_SOURCE / f"{language}.json", target / f"{language}.json")
        return
    metadata = json.loads((LANGUAGES_SOURCE / f"{language}.json").read_text(encoding="utf-8"))
    mutate(metadata)
    (target / f"{language}.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")


def _load_module(tmp_path: Path, language: str, entries: list[tuple[str, str, dict]]) -> GenericLanguageModule:
    data_root = tmp_path / "language-data"
    _install_language_metadata(data_root, language)
    _write_fixture_dictionary(data_root / "dictionaries" / language / "en" / "dictionary.db", entries)
    module = GenericLanguageModule(language)
    module.LOAD_MODULE(str(tmp_path), str(data_root))
    return module


def _load_adapter(module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, ADAPTER_SOURCE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ZH_ENTRY = {
    "word": "学",
    "pinyin": {"value": "xué"},
    "definitions": ["to learn; to study"],
}

DUAL_FORM_ROWS = [("学", "xué", ZH_ENTRY), ("學", "xué", ZH_ENTRY)]


def test_zh_dictionary_serves_both_headword_forms(tmp_path):
    module = _load_module(tmp_path, "zh", DUAL_FORM_ROWS)

    simplified = module.LANGUAGE_TRANSLATE("学")
    traditional = module.LANGUAGE_TRANSLATE("學")

    assert simplified is not None and traditional is not None
    assert simplified["data"], "expected a dictionary hit for 学 under merged zh"
    assert traditional["data"], "expected a dictionary hit for 學 under merged zh"
    assert simplified["data"] == traditional["data"]
    simplified_rows = simplified["data"]
    assert isinstance(simplified_rows, list) and simplified_rows
    assert simplified_rows[0]["reading"] == "xué"
    assert "to learn" in simplified_rows[0]["definitions"]


def test_adapter_language_code_fallback_is_zh():
    adapter = _load_adapter("mandarin_adapter_characterization")

    assert adapter._language_code() == "zh"


def test_adapter_language_code_from_packaged_module_names():
    assert _load_adapter("_mlearn_language_zh")._language_code() == "zh"
    assert _load_adapter("_mlearn_language_zh_Hans")._language_code() == "zh-Hans"
    assert _load_adapter("_mlearn_language_zh_Hant")._language_code() == "zh-Hant"


def test_adapter_opencc_inactive_under_base_zh_metadata(tmp_path):
    data_root = tmp_path / "language-data"
    _install_language_metadata(data_root, "zh")
    adapter = _load_adapter("_mlearn_language_zh")

    adapter.LOAD_MODULE(str(tmp_path), str(data_root))

    assert adapter._pinyin_input_converter is None


def test_adapter_opencc_active_when_metadata_enables_pinyin_input_conversion(tmp_path):
    data_root = tmp_path / "language-data"

    def _enable_conversion(metadata):
        metadata.setdefault("runtime", {}).setdefault("adapter", {}).setdefault("config", {})[
            "pinyinInputConversion"
        ] = "t2s"

    _install_language_metadata(data_root, "zh", mutate=_enable_conversion)
    adapter = _load_adapter("_mlearn_language_zh")

    adapter.LOAD_MODULE(str(tmp_path), str(data_root))

    assert adapter._pinyin_input_converter is not None
    assert adapter._pinyin_input_converter.convert("學習") == "学习"
