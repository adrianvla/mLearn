import csv
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-smartool-ru.py")


def _load_builder(root: Path):
    previous = os.environ.get("MLEARN_ROOT_OF_APP")
    os.environ["MLEARN_ROOT_OF_APP"] = str(root)
    try:
        spec = importlib.util.spec_from_file_location("build_smartool_ru", SCRIPT)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop("MLEARN_ROOT_OF_APP", None)
        else:
            os.environ["MLEARN_ROOT_OF_APP"] = previous


class BuildSmartoolRussianTest(unittest.TestCase):
    def test_parses_csvs_into_unique_explicit_level_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            builder = _load_builder(root)
            csv_paths = {}
            for level, rows in {
                "A1": [("слово", "1"), ("слово", "2")],
                "A2": [("учиться", "3")],
            }.items():
                csv_path = Path(temp_dir) / f"SMARTool_data_{level}.csv"
                with csv_path.open("w", encoding="utf-8", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=["Target language lemma", "Level", "Ex. ID"])
                    writer.writeheader()
                    for lemma, example_id in rows:
                        writer.writerow({"Target language lemma": lemma, "Level": level, "Ex. ID": example_id})
                    writer.writerow({"Target language lemma": "1305 deleted", "Level": "", "Ex. ID": ""})
                csv_paths[level] = csv_path

            rows = builder._parse_frequency_rows(csv_paths)
            self.assertEqual(rows, [["слово", "слово", 1], ["учиться", "учиться", 2]])

            builder._write_frequency(rows)
            payload = json.loads((root / "languages" / "ru.smartool.freq.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["freq"], rows)


if __name__ == "__main__":
    unittest.main()
