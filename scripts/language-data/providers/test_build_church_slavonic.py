import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import zlib
from pathlib import Path


CHURCH_SCRIPT = Path(__file__).with_name("build-church-slavonic.py")
FREEDICT_SCRIPT = Path(__file__).with_name("build-freedict-deu-eng.py")


def _load_builder(script: Path, module_name: str, root: Path):
    previous = os.environ.get("MLEARN_ROOT_OF_APP")
    os.environ["MLEARN_ROOT_OF_APP"] = str(root)
    try:
        spec = importlib.util.spec_from_file_location(module_name, script)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop("MLEARN_ROOT_OF_APP", None)
        else:
            os.environ["MLEARN_ROOT_OF_APP"] = previous


class BuildChurchSlavonicTest(unittest.TestCase):
    def test_builds_frequency_and_inflected_dictionary_lookup(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            builder = _load_builder(CHURCH_SCRIPT, "build_church_slavonic_test", root)
            setattr(builder, "FREQUENCY_LIMIT", 3)
            corpus_path = Path(temp_dir) / "corpus.txt"
            corpus_path.write_text("[1:1] И въ началѣ слово. Слово слово.\n", encoding="utf-8")
            frequency_words, token_count = builder._write_frequency(corpus_path)
            self.assertEqual(frequency_words, ["слово", "въ", "и"])
            self.assertEqual(token_count, 6)

            source_path = Path(temp_dir) / "dictionary.jsonl"
            source_path.write_text(json.dumps({
                "word": "слово",
                "pos": "noun",
                "forms": [
                    {"form": "slovo", "tags": ["romanization"]},
                    {"form": "словесе", "roman": "slovese", "tags": ["dative", "singular"]},
                    {"form": "table-tags", "tags": ["table-tags"]},
                ],
                "senses": [{"glosses": ["word", "speech"]}],
            }, ensure_ascii=False) + "\n", encoding="utf-8")
            source_entries, inserted = builder._build_dictionary(
                source_path,
                frequency_words,
                "2026-07-19T00:00:00+00:00",
            )
            self.assertEqual((source_entries, inserted), (1, 2))

            conn = sqlite3.connect(root / "dictionaries" / "cu" / "en" / "dictionary.db")
            try:
                row = conn.execute("SELECT data FROM entries WHERE headword = ?", ("словесе",)).fetchone()
            finally:
                conn.close()
            payload = json.loads(zlib.decompress(row[0]).decode("utf-8"))
            self.assertEqual(payload["lemma"], "слово")
            self.assertEqual(payload["reading"], "slovese")
            self.assertEqual(payload["definitions"], ["word", "speech"])

    def test_shared_freedict_builder_writes_spanish_frequency_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            builder = _load_builder(FREEDICT_SCRIPT, "build_freedict_spanish_test", root)
            setattr(builder, "FREQUENCY_LIMIT", 3)
            source_path = Path(temp_dir) / "es_50k.txt"
            source_path.write_text("hola 50\nqué 40\ngracias 30\nhola 20\n", encoding="utf-8")
            count = builder._write_frequency(source_path, builder.BUILD_CONFIGS["es"])
            self.assertEqual(count, 3)
            payload = json.loads((root / "languages" / "es.freq.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["freq"], [["hola", "hola"], ["qué", "qué"], ["gracias", "gracias"]])

    def test_shared_freedict_builder_inverts_english_spanish_entries(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            builder = _load_builder(FREEDICT_SCRIPT, "build_freedict_inversion_test", root)
            source_path = Path(temp_dir) / "eng-spa.tei"
            source_path.write_text(
                '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><entry>'
                '<form><orth>speak</orth></form><gramGrp><pos>v</pos></gramGrp><sense>'
                '<cit type="trans" xml:lang="es"><quote>hablar</quote></cit>'
                '</sense></entry></body></text></TEI>',
                encoding="utf-8",
            )
            config = builder.BUILD_CONFIGS["es"]
            source_entries, inserted = builder._write_database(
                source_path,
                "test",
                "https://example.invalid/eng-spa.tei",
                "CC-BY-SA-3.0",
                "2026-07-19T00:00:00+00:00",
                config,
            )
            self.assertEqual((source_entries, inserted), (1, 1))
            conn = sqlite3.connect(config.database_path)
            try:
                row = conn.execute("SELECT data FROM entries WHERE headword_lower = ?", ("hablar",)).fetchone()
            finally:
                conn.close()
            payload = json.loads(zlib.decompress(row[0]).decode("utf-8"))
            self.assertEqual(payload["glosses"], ["speak"])
            self.assertEqual(
                builder._resolve_license_from_header(
                    "Licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported license",
                    Path(temp_dir) / "unused-license",
                ),
                "CC-BY-SA-3.0",
            )


if __name__ == "__main__":
    unittest.main()
