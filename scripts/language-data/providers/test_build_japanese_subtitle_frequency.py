import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-japanese-subtitle-frequency.py")
SPEC = importlib.util.spec_from_file_location("japanese_subtitle_frequency", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class JapaneseSubtitleFrequencyTests(unittest.TestCase):
    def test_preserves_source_rank_count_and_distinct_readings(self):
        source = {"entries": [
            {"text": "彼女", "reading": "かのじょ", "rank": 1, "count": 100},
            {"text": "彼女", "reading": "かれおんな", "rank": 1001, "count": 5},
            {"text": "彼女", "reading": "かのじょ", "rank": 3001, "count": 1},
        ]}
        rows = builder.build_rows(source, minimum_rows=0)
        self.assertEqual(rows, [["彼女", "かのじょ", 1, 1, 100], ["彼女", "かれおんな", 2, 1001, 5]])
        self.assertEqual(builder.level_for_rank(3001), 3)
        self.assertEqual(builder.level_for_rank(8001), 5)

    def test_rejects_out_of_order_rank(self):
        with self.assertRaisesRegex(ValueError, "increase strictly"):
            builder.build_rows({"entries": [
                {"text": "一", "reading": "いち", "rank": 2, "count": 3},
                {"text": "二", "reading": "に", "rank": 1, "count": 2},
            ]})


if __name__ == "__main__":
    unittest.main()
