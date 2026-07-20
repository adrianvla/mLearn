import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-jmdict-ja-multilingual.py")


class BuildJmdictJapaneseMultilingualTest(unittest.TestCase):
    def test_builds_target_specific_sqlite_dictionaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            root_of_app = tmp_dir / "root-of-app"
            source = tmp_dir / "JMdict.xml"
            source.write_text(
                """<?xml version="1.0" encoding="UTF-8"?>
<JMdict>
  <entry>
    <ent_seq>1001</ent_seq>
    <k_ele><keb>赤い</keb></k_ele>
    <r_ele><reb>あかい</reb></r_ele>
    <sense>
      <gloss xml:lang="fre">rouge</gloss>
      <gloss xml:lang="ger">rot</gloss>
      <gloss>red</gloss>
    </sense>
  </entry>
</JMdict>
""",
                encoding="utf-8",
            )

            env = {
                **os.environ,
                "MLEARN_ROOT_OF_APP": str(root_of_app),
            }
            subprocess.run(
                [sys.executable, str(SCRIPT), "--source", str(source), "--targets", "fr", "de"],
                check=True,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            for target, expected_gloss in {"fr": "rouge", "de": "rot"}.items():
                db_path = root_of_app / "dictionaries" / "ja" / target / "dictionary.db"
                metadata_path = root_of_app / "dictionaries" / "ja" / target / "metadata.json"
                self.assertTrue(db_path.exists())
                self.assertTrue(metadata_path.exists())
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                self.assertEqual(metadata["targetLanguage"], target)
                self.assertEqual(metadata["license"], "CC-BY-SA-4.0")

                conn = sqlite3.connect(db_path)
                try:
                    row = conn.execute("SELECT data FROM entries WHERE headword = ?", ("赤い",)).fetchone()
                    self.assertIsNotNone(row)
                    entry = json.loads(zlib.decompress(row[0]).decode("utf-8"))
                    self.assertEqual(entry[0], "赤い")
                    self.assertEqual(entry[1], "あかい")
                    rendered = json.dumps(entry[5], ensure_ascii=False)
                    self.assertIn(expected_gloss, rendered)
                    self.assertNotIn('"content": "red"', rendered)
                finally:
                    conn.close()


if __name__ == "__main__":
    unittest.main()
