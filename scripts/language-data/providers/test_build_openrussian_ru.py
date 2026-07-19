import gzip
import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
import zlib
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-openrussian-ru.py")


def _load_builder(root: Path):
    previous = os.environ.get("MLEARN_ROOT_OF_APP")
    os.environ["MLEARN_ROOT_OF_APP"] = str(root)
    try:
        spec = importlib.util.spec_from_file_location("build_openrussian_ru", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop("MLEARN_ROOT_OF_APP", None)
        else:
            os.environ["MLEARN_ROOT_OF_APP"] = previous


class BuildOpenRussianTest(unittest.TestCase):
    def test_builds_stressed_readings_frequency_and_dictionary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            builder = _load_builder(root)
            self.assertEqual(builder._stressed("молоко'"), "молоко́")
            self.assertEqual(builder._unstressed("молоко́"), "молоко")
            self.assertEqual(builder._normalize(["one", "two*"]), "one two")

            records = [{
                "lemma": "молоко",
                "reading": "молоко́",
                "partOfSpeech": "NOUN",
                "rank": 1,
                "forms": [("молоко", "молоко́"), ("молока", "молока́")],
                "definitions": {"en": ["milk"], "de": ["Milch"]},
                "attributes": {"gender": "n"},
            }]

            pronunciation_count, frequency_count = builder._write_core_assets(records)
            builder._write_source_license()
            self.assertEqual((pronunciation_count, frequency_count), (2, 1))
            with gzip.open(root / "languages" / "ru.pronunciation.json.gz", "rt", encoding="utf-8") as handle:
                pronunciations = json.load(handle)
            self.assertEqual(pronunciations["молока"], "молока́")
            self.assertIn(
                "CC BY-SA 4.0",
                (root / "licenses" / "openrussian-LICENSE").read_text(encoding="utf-8"),
            )

            inserted = builder._build_dictionary(records, "en", "2026-07-18T00:00:00+00:00")
            self.assertEqual(inserted, 2)
            conn = sqlite3.connect(root / "dictionaries" / "ru" / "en" / "dictionary.db")
            try:
                row = conn.execute("SELECT data FROM entries WHERE headword = ?", ("молока",)).fetchone()
                payload = json.loads(zlib.decompress(row[0]).decode("utf-8"))
            finally:
                conn.close()
            self.assertEqual(payload["reading"], "молока́")
            self.assertEqual(payload["definitions"], ["milk"])


if __name__ == "__main__":
    unittest.main()
