#!/usr/bin/env python3
"""Build the Japanese media-frequency provider from a pinned licensed source."""

import argparse
import hashlib
import json
import unicodedata
from pathlib import Path
from urllib.request import urlopen

SOURCE_COMMIT = "28ae0f545aee9d9bc3547ce4bd7725b55e9b00f1"
SOURCE_URL = (
    "https://raw.githubusercontent.com/jkindrix/japanese-language-data/"
    f"{SOURCE_COMMIT}/data/enrichment/frequency-subtitles.json"
)
SOURCE_SHA256 = "7aef89336af9ec00da408ded3e31f6be5811dd93fd3e9c4950968e40345dbc46"
OUTPUT = Path(__file__).resolve().parents[1] / "source/root-of-app/languages/ja.media.freq.json"


def level_for_rank(rank: int) -> int:
    """Cumulative corpus-rank bands, independent of JLPT membership."""
    for level, ceiling in enumerate((1000, 3000, 5000, 8000), start=1):
        if rank <= ceiling:
            return level
    return 5


def build_rows(source: dict, minimum_rows: int = 8000) -> list[list[str | int]]:
    entries = source.get("entries")
    if not isinstance(entries, list):
        raise ValueError("Frequency source has no entries")
    rows: list[list[str | int]] = []
    seen: set[tuple[str, str]] = set()
    previous_rank = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Malformed frequency entry")
        surface = entry.get("text")
        reading = entry.get("reading")
        rank = entry.get("rank")
        count = entry.get("count")
        if not isinstance(surface, str) or not surface.strip() or not isinstance(reading, str) or not reading.strip():
            raise ValueError(f"Malformed surface or reading at rank {rank}")
        if not isinstance(rank, int) or isinstance(rank, bool) or rank <= previous_rank:
            raise ValueError(f"Source ranks must increase strictly after {previous_rank}")
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise ValueError(f"Malformed occurrence count at rank {rank}")
        previous_rank = rank
        key = (unicodedata.normalize("NFC", surface.strip()), unicodedata.normalize("NFC", reading.strip()))
        if key in seen:
            continue
        seen.add(key)
        rows.append([key[0], key[1], level_for_rank(rank), rank, count])
    if len(rows) < minimum_rows:
        raise ValueError(f"Unexpectedly small frequency source: {len(rows)} rows")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Pinned source downloaded locally for offline rebuilding")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    source_bytes = args.source.read_bytes() if args.source else urlopen(SOURCE_URL, timeout=30).read()
    actual_hash = hashlib.sha256(source_bytes).hexdigest()
    if actual_hash != SOURCE_SHA256:
        raise ValueError(f"Source hash mismatch: {actual_hash}")
    rows = build_rows(json.loads(source_bytes))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"freq": rows}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} Japanese media-frequency rows to {args.output}")


if __name__ == "__main__":
    main()
