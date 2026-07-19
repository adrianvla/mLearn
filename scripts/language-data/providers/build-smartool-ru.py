#!/usr/bin/env python3

import csv
import json
import os
import ssl
import tempfile
import urllib.request
import unicodedata
from pathlib import Path


SOURCE_COMMIT = "c20223c008c278c9399d8442f52948fae9c82c1c"
SOURCE_BASE_URL = f"https://raw.githubusercontent.com/smartool/data-rus-eng/{SOURCE_COMMIT}"
LEVELS = {"A1": 1, "A2": 2, "B1": 3, "B2": 4}
ROOT_OF_APP_DIR = Path(os.environ.get(
    "MLEARN_ROOT_OF_APP",
    Path(__file__).resolve().parents[1] / "source" / "root-of-app",
))
FREQUENCY_PATH = ROOT_OF_APP_DIR / "languages" / "ru.smartool.freq.json"


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl._create_unverified_context()


def _download(url: str, destination: Path) -> None:
    print(f"Downloading {url}", flush=True)
    with urllib.request.urlopen(url, context=_ssl_context()) as response, destination.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)


def _normalize(value: str | None) -> str:
    return unicodedata.normalize("NFC", " ".join((value or "").split()).strip())


def _parse_frequency_rows(csv_paths: dict[str, Path]) -> list[list[str | int]]:
    entries: dict[str, tuple[str, int]] = {}
    for declared_level, numeric_level in LEVELS.items():
        csv_path = csv_paths.get(declared_level)
        if not csv_path:
            continue
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                lemma = _normalize(row.get("Target language lemma"))
                row_level = _normalize(row.get("Level"))
                level = LEVELS.get(row_level)
                if not lemma or level is None:
                    continue
                key = lemma.casefold()
                existing = entries.get(key)
                if existing is None or level < existing[1]:
                    entries[key] = (lemma, level)
    return [
        [lemma, lemma, level]
        for lemma, level in sorted(entries.values(), key=lambda entry: (entry[1], entry[0].casefold(), entry[0]))
    ]


def _write_frequency(rows: list[list[str | int]]) -> None:
    FREQUENCY_PATH.parent.mkdir(parents=True, exist_ok=True)
    FREQUENCY_PATH.write_text(
        json.dumps({"freq": rows}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def _write_source_license(temp_dir: Path) -> None:
    license_dir = ROOT_OF_APP_DIR / "licenses"
    license_dir.mkdir(parents=True, exist_ok=True)
    _download(f"{SOURCE_BASE_URL}/LICENSE", license_dir / "smartool-LICENSE")
    source_readme = temp_dir / "SMARTool-README.md"
    _download(f"{SOURCE_BASE_URL}/README.md", source_readme)
    attribution = (
        "# SMARTool Russian frequency levels\n\n"
        f"mLearn derives `languages/ru.smartool.freq.json` from the four SMARTool Russian CSV files at `{SOURCE_COMMIT}`. "
        "The transformation keeps each unique target-language lemma and its easiest declared A1-B2 level; examples, forms, translations, and other columns are omitted.\n\n"
        "Source: https://github.com/smartool/data-rus-eng\n\n"
        "Dataset DOI: https://doi.org/10.18710/QNAPNE\n\n"
        "License: Creative Commons Attribution 4.0 International.\n\n"
        "## Original dataset metadata\n\n"
    )
    (license_dir / "smartool-README.md").write_text(
        attribution + source_readme.read_text(encoding="utf-8"),
        encoding="utf-8",
    )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="mlearn-smartool-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        csv_paths: dict[str, Path] = {}
        for level in LEVELS:
            csv_path = temp_dir / f"SMARTool_data_{level}.csv"
            _download(f"{SOURCE_BASE_URL}/{csv_path.name}", csv_path)
            csv_paths[level] = csv_path
        rows = _parse_frequency_rows(csv_paths)
        _write_frequency(rows)
        _write_source_license(temp_dir)
    print(f"Wrote {len(rows)} SMARTool Russian lemmas to {FREQUENCY_PATH}", flush=True)


if __name__ == "__main__":
    main()
