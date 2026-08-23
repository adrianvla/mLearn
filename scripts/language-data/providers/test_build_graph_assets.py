import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).with_name("build-graph-assets.py")
ENTITY_KINDS = {"dictionary-entry", "lexeme", "surface", "sense", "pronunciation", "character", "morpheme", "grammar-pattern"}
RELATION_TYPES = {"inflection-of", "lemma-of", "realizes", "has-sense", "has-pronunciation", "has-gender", "has-prosodic-pattern", "has-character", "has-reading", "has-morpheme", "orthographic-variant-of", "component-of", "derived-from", "semantically-related", "morphologically-related"}


def _load_builder(root: Path):
    previous = os.environ.get("MLEARN_ROOT_OF_APP")
    os.environ["MLEARN_ROOT_OF_APP"] = str(root)
    try:
        spec = importlib.util.spec_from_file_location("build_graph_assets_test", SCRIPT)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop("MLEARN_ROOT_OF_APP", None)
        else:
            os.environ["MLEARN_ROOT_OF_APP"] = previous


def _write_dictionary(root: Path, language: str, columns: str, rows: list[tuple[Any, ...]]):
    output = root / "dictionaries" / language / "en"
    output.mkdir(parents=True)
    connection = sqlite3.connect(output / "dictionary.db")
    connection.execute(f"CREATE TABLE entries ({columns})")
    placeholders = ",".join("?" for _ in rows[0])
    connection.executemany(f"INSERT INTO entries VALUES ({placeholders})", rows)
    connection.commit()
    connection.close()


def _payload(value: dict[str, Any]) -> bytes:
    return zlib.compress(json.dumps(value, separators=(",", ":")).encode("utf-8"))


class BuildGraphAssetsTest(unittest.TestCase):
    def test_supported_dictionary_shapes_conform_to_graph_schema(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            _write_dictionary(root, "zh-Hans", "headword TEXT, reading TEXT, data BLOB", [
                ("simplified", "pin-yin", _payload({"word": "simplified", "simplified": "simplified", "traditional": "traditional", "pinyin": {"value": "pin-yin", "numeric": "pin1-yin1"}, "definitions": ["meaning"]})),
                ("traditional", "pin-yin", _payload({"word": "simplified", "simplified": "simplified", "traditional": "traditional", "pinyin": {"value": "pin-yin", "numeric": "pin1-yin1"}, "definitions": ["meaning"]})),
            ])
            _write_dictionary(root, "es", "id INTEGER, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB", [
                (1, "lemma", "lemma", "noun", _payload({"pos": "noun", "glosses": ["meaning"], "notes": [], "examples": []})),
            ])
            _write_dictionary(root, "cu", "headword TEXT, reading TEXT, data BLOB", [
                ("form", "reading", _payload({"word": "form", "lemma": "lemma", "reading": "reading", "definitions": ["meaning"], "partOfSpeech": [], "common": False, "score": 0})),
            ])
            builder = _load_builder(root)
            for language, build in (("zh", builder.build_zh), ("es", builder.build_es), ("cu", builder.build_cu)):
                self.assertGreater(build()[0], 0)
                graph = json.loads((root / "languages" / f"{language}.graph.json").read_text(encoding="utf-8"))
                ids = {entity["id"] for entity in graph["entities"]}
                self.assertEqual(graph["schemaVersion"], 1)
                self.assertTrue(all(entity["kind"] in ENTITY_KINDS for entity in graph["entities"]))
                self.assertTrue(all(relation["type"] in RELATION_TYPES and relation["from"] in ids and relation["to"] in ids for relation in graph["relations"]))


if __name__ == "__main__":
    unittest.main()
