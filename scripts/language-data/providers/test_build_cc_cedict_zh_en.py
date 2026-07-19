import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
import zlib
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-cc-cedict-zh-en.py")


def _load_builder(root: Path):
    previous = os.environ.get("MLEARN_ROOT_OF_APP")
    os.environ["MLEARN_ROOT_OF_APP"] = str(root)
    try:
        spec = importlib.util.spec_from_file_location("build_cc_cedict_zh_en", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop("MLEARN_ROOT_OF_APP", None)
        else:
            os.environ["MLEARN_ROOT_OF_APP"] = previous


class BuildCcCedictTest(unittest.TestCase):
    def test_builds_variant_lookup_tone_marked_reading_and_hsk_frequency(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            builder = _load_builder(root)
            self.assertEqual(builder.numeric_pinyin_to_marks("ni3 hao3"), "nǐ hǎo")
            self.assertEqual(builder.numeric_pinyin_to_marks("lu:4 se4"), "lǜ sè")
            self.assertEqual(builder.normalize_pinyin("nǐ hǎo"), "ni hao")

            entries = [{
                "traditional": "你好",
                "simplified": "你好",
                "numericPinyin": "ni3 hao3",
                "pinyin": "nǐ hǎo",
                "definitions": ["hello"],
            }, {
                "traditional": "學習",
                "simplified": "学习",
                "numericPinyin": "xue2 xi2",
                "pinyin": "xué xí",
                "definitions": ["to study"],
            }]
            inserted = builder._build_dictionary(entries, "zh-Hans", "2026-07-18T00:00:00+00:00")
            self.assertEqual(inserted, 3)
            conn = sqlite3.connect(root / "dictionaries" / "zh-Hans" / "en" / "dictionary.db")
            try:
                row = conn.execute("SELECT reading, data FROM entries WHERE headword = ?", ("學習",)).fetchone()
                payload = json.loads(zlib.decompress(row[1]).decode("utf-8"))
            finally:
                conn.close()
            self.assertEqual(row[0], "xue xi")
            self.assertEqual(payload["word"], "学习")
            self.assertEqual(payload["pinyin"]["value"], "xué xí")

            hsk_path = Path(temp_dir) / "hsk.json"
            hsk_path.write_text(json.dumps([{
                "s": "学习",
                "l": ["n1", "o1"],
                "q": 10,
                "f": [{"t": "學習", "i": {"y": "xué xí"}}],
            }]), encoding="utf-8")
            counts = builder._write_frequency_files(hsk_path)
            self.assertEqual(counts, (1, 1))
            hans = json.loads((root / "languages" / "zh-Hans.freq.json").read_text(encoding="utf-8"))
            hant = json.loads((root / "languages" / "zh-Hant.freq.json").read_text(encoding="utf-8"))
            self.assertEqual(hans, [["学习", "xué xí", 1]])
            self.assertEqual(hant, [["學習", "xué xí", 1]])


if __name__ == "__main__":
    unittest.main()
