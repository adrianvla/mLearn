#!/usr/bin/env python3

import argparse
import json
import os
import re
import sqlite3
import ssl
import tarfile
import tempfile
import urllib.request
import unicodedata
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CEDICT_VERSION = "20260403"
CEDICT_URL = f"https://deb.debian.org/debian/pool/main/c/cc-cedict/cc-cedict_0.0~repack{CEDICT_VERSION}.orig.tar.xz"
HSK_COMMIT = "7ac65bf1a6387d35f1ade478906172a19311c7f9"
HSK_URL = f"https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/{HSK_COMMIT}/complete.min.json"
HSK_LICENSE_URL = f"https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/{HSK_COMMIT}/LICENSE"
SCHEMA_VERSION = "1"
ROOT_OF_APP_DIR = Path(os.environ.get(
    "MLEARN_ROOT_OF_APP",
    Path(__file__).resolve().parents[1] / "source" / "root-of-app",
))
ENTRY_PATTERN = re.compile(r"^(\S+)\s+(\S+)\s+\[(.+)]\s+/(.*)/$")
BRACKETED_TEXT_PATTERN = re.compile(r"\[([^\[\]]+)]")
NUMBERED_PINYIN_PATTERN = re.compile(r"[A-Za-zÜüVv:]+[1-5]")
TONE_MARKS = {
    "a": "āáǎàa", "e": "ēéěèe", "i": "īíǐìi", "o": "ōóǒòo",
    "u": "ūúǔùu", "ü": "ǖǘǚǜü",
    "A": "ĀÁǍÀA", "E": "ĒÉĚÈE", "I": "ĪÍǏÌI", "O": "ŌÓǑÒO",
    "U": "ŪÚǓÙU", "Ü": "ǕǗǙǛÜ",
}


def _log(message: str) -> None:
    print(message, flush=True)


def _ssl_context():
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl._create_unverified_context()


def _download(url: str, destination: Path) -> None:
    _log(f"Downloading {url}")
    with urllib.request.urlopen(url, context=_ssl_context()) as response, destination.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)


def _mark_syllable(syllable: str) -> str:
    match = re.match(r"^(.*?)([1-5])$", syllable)
    if not match:
        return syllable.replace("u:", "ü").replace("U:", "Ü").replace("v", "ü").replace("V", "Ü")
    body, tone_text = match.groups()
    tone = int(tone_text)
    body = body.replace("u:", "ü").replace("U:", "Ü").replace("v", "ü").replace("V", "Ü")
    if tone == 5:
        return body

    lower = body.lower()
    if "a" in lower:
        index = lower.index("a")
    elif "e" in lower:
        index = lower.index("e")
    elif "ou" in lower:
        index = lower.index("o")
    else:
        vowel_indexes = [index for index, char in enumerate(lower) if char in "aeiouü"]
        if not vowel_indexes:
            return body
        index = vowel_indexes[-1]
    marked = TONE_MARKS.get(body[index])
    if not marked:
        return body
    return body[:index] + marked[tone - 1] + body[index + 1:]


def numeric_pinyin_to_marks(reading: str) -> str:
    normalized = re.sub(r"([uU])\s*:\s*([1-5])", r"\1:\2", reading)
    return NUMBERED_PINYIN_PATTERN.sub(lambda match: _mark_syllable(match.group(0)), normalized)


def _is_numbered_pinyin(reading: str) -> bool:
    normalized = re.sub(r"([uU])\s*:\s*([1-5])", r"\1:\2", reading)
    if not NUMBERED_PINYIN_PATTERN.search(normalized):
        return False
    remainder = NUMBERED_PINYIN_PATTERN.sub("", normalized)
    remainder = re.sub(r"\b[A-Z]{1,5}\b", "", remainder)
    return re.fullmatch(r"[\s\d,·.'’:/-]*", remainder) is not None


def normalize_definition_readings(definition: str) -> str:
    def replace_reading(match: re.Match[str]) -> str:
        reading = match.group(1)
        if not _is_numbered_pinyin(reading):
            return match.group(0)
        prefix = "" if match.start() == 0 or definition[match.start() - 1].isspace() else " "
        return f"{prefix}({numeric_pinyin_to_marks(reading)})"

    return BRACKETED_TEXT_PATTERN.sub(replace_reading, definition)


def normalize_pinyin(reading: str) -> str:
    decomposed = unicodedata.normalize("NFD", reading.casefold())
    without_marks = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return " ".join(without_marks.replace("u:", "u").replace("ü", "u").split())


def _compress(payload: dict[str, Any]) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return zlib.compress(raw)


def _read_cedict(archive_path: Path, extract_dir: Path) -> list[dict[str, Any]]:
    source_path = extract_dir / "cedict_ts.u8"
    with tarfile.open(archive_path, "r:xz") as archive:
        member = next((item for item in archive.getmembers() if Path(item.name).name == "cedict_ts.u8"), None)
        if member is None:
            raise RuntimeError("CC-CEDICT archive does not contain cedict_ts.u8")
        source = archive.extractfile(member)
        if source is None:
            raise RuntimeError("CC-CEDICT archive entry is not a regular file")
        source_path.write_bytes(source.read())

    entries: list[dict[str, Any]] = []
    with source_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line or line.startswith("#"):
                continue
            match = ENTRY_PATTERN.match(line.rstrip("\n"))
            if not match:
                continue
            traditional, simplified, numeric_pinyin, definition_text = match.groups()
            definitions = [part.strip() for part in definition_text.split("/") if part.strip()]
            if not definitions:
                continue
            entries.append({
                "traditional": traditional,
                "simplified": simplified,
                "numericPinyin": numeric_pinyin,
                "pinyin": numeric_pinyin_to_marks(numeric_pinyin),
                "definitions": definitions,
            })
    return entries


def _build_dictionary(entries: list[dict[str, Any]], language: str, built_at: str) -> int:
    canonical_field = "simplified" if language == "zh-Hans" else "traditional"
    alias_field = "traditional" if language == "zh-Hans" else "simplified"
    output_dir = ROOT_OF_APP_DIR / "dictionaries" / language / "en"
    output_dir.mkdir(parents=True, exist_ok=True)
    db_path = output_dir / "dictionary.db"
    temp_path = output_dir / "dictionary.tmp"
    if temp_path.exists():
        temp_path.unlink()

    conn = sqlite3.connect(temp_path)
    conn.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (headword TEXT NOT NULL, reading TEXT, data BLOB NOT NULL);
    """)
    batch: list[tuple[str, str, bytes]] = []
    inserted = 0
    for entry in entries:
        canonical = entry[canonical_field]
        alias = entry[alias_field]
        payload = {
            "word": canonical,
            "simplified": entry["simplified"],
            "traditional": entry["traditional"],
            "pinyin": {
                "value": entry["pinyin"],
                "numeric": entry["numericPinyin"],
            },
            "definitions": [normalize_definition_readings(definition) for definition in entry["definitions"]],
        }
        reading_key = normalize_pinyin(entry["pinyin"])
        for headword in dict.fromkeys([canonical, alias]):
            batch.append((headword, reading_key, _compress(payload)))
            inserted += 1
            if len(batch) >= 5000:
                conn.executemany("INSERT INTO entries VALUES (?, ?, ?)", batch)
                batch.clear()
    if batch:
        conn.executemany("INSERT INTO entries VALUES (?, ?, ?)", batch)
    conn.executescript("""
        CREATE INDEX idx_entries_headword ON entries(headword);
        CREATE INDEX idx_entries_reading ON entries(reading);
    """)
    conn.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("version", f"{SCHEMA_VERSION}:cc-cedict-{CEDICT_VERSION}"),
        ("source", "CC-CEDICT via Debian source mirror"),
        ("source_url", CEDICT_URL),
        ("built_at", built_at),
    ])
    conn.commit()
    conn.execute("PRAGMA optimize")
    conn.close()
    temp_path.replace(db_path)

    metadata = {
        "version": f"cc-cedict-{CEDICT_VERSION}",
        "source_url": CEDICT_URL,
        "upstream": "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
        "license": "CC-BY-SA-4.0",
        "target_language": "en",
        "entries": inserted,
        "built_at": built_at,
    }
    (output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_dir / "LICENSE").write_text(
        "CC-CEDICT\nCopyright CC-CEDICT contributors\nLicensed under CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/\n",
        encoding="utf-8",
    )
    (output_dir / "README.md").write_text(
        f"# CC-CEDICT for {language}\n\nCC-CEDICT data mirrored by Debian, upstream published by MDBG.\n\nSource: {CEDICT_URL}\nLicense: CC BY-SA 4.0.\n",
        encoding="utf-8",
    )
    return inserted


def _write_frequency_files(hsk_path: Path) -> tuple[int, int]:
    entries = json.loads(hsk_path.read_text(encoding="utf-8"))
    rows = {"zh-Hans": [], "zh-Hant": []}
    (ROOT_OF_APP_DIR / "languages").mkdir(parents=True, exist_ok=True)
    for entry in entries:
        levels = [int(level[1:]) for level in entry.get("l", []) if re.fullmatch(r"n[1-7]", str(level))]
        forms = entry.get("f") or []
        if not levels or not forms:
            continue
        level = min(levels)
        frequency = entry.get("q") if isinstance(entry.get("q"), int) else 10**9
        simplified = str(entry.get("s") or "")
        traditional = str(forms[0].get("t") or simplified)
        pinyin = str((forms[0].get("i") or {}).get("y") or simplified)
        if simplified:
            rows["zh-Hans"].append((frequency, [simplified, pinyin, level]))
        if traditional:
            rows["zh-Hant"].append((frequency, [traditional, pinyin, level]))

    counts = []
    for language in ("zh-Hans", "zh-Hant"):
        ordered = [row for _, row in sorted(rows[language], key=lambda item: (item[0], item[1][0]))]
        (ROOT_OF_APP_DIR / "languages" / f"{language}.freq.json").write_text(
            json.dumps(ordered, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        counts.append(len(ordered))
    return counts[0], counts[1]


def _write_hsk_license(license_path: Path) -> None:
    output_dir = ROOT_OF_APP_DIR / "licenses"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "complete-hsk-vocabulary-LICENSE").write_bytes(license_path.read_bytes())
    (output_dir / "complete-hsk-vocabulary-README.md").write_text(
        f"Complete HSK Vocabulary frequency and level data\n\nSource commit: https://github.com/drkameleon/complete-hsk-vocabulary/commit/{HSK_COMMIT}\nLicense: MIT\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Reserved for parity with the other providers")
    parser.parse_args()

    built_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    with tempfile.TemporaryDirectory(prefix="cc-cedict-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        archive_path = temp_dir / "cc-cedict.tar.xz"
        hsk_path = temp_dir / "complete-hsk.json"
        license_path = temp_dir / "complete-hsk-LICENSE"
        _download(CEDICT_URL, archive_path)
        _download(HSK_URL, hsk_path)
        _download(HSK_LICENSE_URL, license_path)
        entries = _read_cedict(archive_path, temp_dir)
        hans_frequency_count, hant_frequency_count = _write_frequency_files(hsk_path)
        _write_hsk_license(license_path)

    hans_count = _build_dictionary(entries, "zh-Hans", built_at)
    hant_count = _build_dictionary(entries, "zh-Hant", built_at)
    _log(
        f"Built Chinese packages: {len(entries)} CC-CEDICT entries, {hans_count} zh-Hans rows, "
        f"{hant_count} zh-Hant rows, {hans_frequency_count}/{hant_frequency_count} HSK rows"
    )


if __name__ == "__main__":
    main()
