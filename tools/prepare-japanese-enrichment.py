"""Reproduce the frozen supplemental source from an explicitly selected reference.

Normal package builds consume the checked-in snapshot offline, not the reference
checkout. Every input is verified before parsing. No learner profile is opened.
"""
import argparse
from collections import defaultdict
import gzip
import hashlib
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIN = json.loads((ROOT / "language-plugins/japanese/enrichment-pin.json").read_text())
OUTPUT = ROOT / "language-plugins/japanese/assets/enrichment-v1.json.gz"


def verified(path, pin):
    data = path.read_bytes()
    if len(data) != pin["byteLength"] or hashlib.sha256(data).hexdigest() != pin["sha256"]:
        raise RuntimeError(f"Supplemental source pin mismatch: {pin['path']}")
    return json.loads(data)


def snapshot(reference):
    pitch = defaultdict(dict)
    records = 0
    for pin in PIN["pitch"]["banks"]:
        rows = verified(reference / "dictionaries/jitendex-yomitan" / pin["path"], pin)
        for written, kind, value in rows:
            if kind != "pitch" or not isinstance(written, str) or not isinstance(value.get("reading"), str):
                raise RuntimeError("Unexpected pitch source record")
            for variant in value["pitches"]:
                if set(variant) - {"position", "tags"}:
                    raise RuntimeError("Unsupported source pitch fields; do not silently discard linguistic information")
                if type(variant["position"]) is not int or variant["position"] < 0:
                    raise RuntimeError("Invalid pitch position")
                tags = variant.get("tags", [])
                if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
                    raise RuntimeError("Invalid pitch tags")
                normalized = {"position": variant["position"], "tags": sorted(set(tags))}
                identity = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
                pitch[(written, value["reading"])][identity] = normalized
            records += 1
    levels = verified(reference / PIN["levels"]["path"], PIN["levels"])["freq"]
    for row in levels:
        if len(row) != 3 or not all(isinstance(v, str) for v in row[:2]) or type(row[2]) is not int or row[2] not in range(1, 6):
            raise RuntimeError("Unexpected JLPT vocabulary record")
    result = {
        "schemaVersion": 1,
        "sources": {key: PIN[key] for key in ("referenceRevision", "pitch", "levels")},
        "pitch": [[written, reading, [variants[key] for key in sorted(variants)]]
                  for (written, reading), variants in sorted(pitch.items())],
        "levels": sorted(levels),
    }
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    buffer = io.BytesIO()
    # GzipFile fixes the filename, timestamp and OS header across supported hosts.
    with gzip.GzipFile(fileobj=buffer, mode="wb", filename="", mtime=0, compresslevel=9) as stream:
        stream.write(encoded)
    return buffer.getvalue(), records, len(pitch), len(levels)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, type=Path, help="read-only reference root-of-app source directory")
    arguments = parser.parse_args()
    data, records, pairs, levels = snapshot(arguments.reference)
    pin = {"path": OUTPUT.name, "byteLength": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    if "artifact" in PIN and pin != PIN["artifact"]:
        raise RuntimeError("Frozen enrichment snapshot changed; review its source/recipe pin explicitly")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if not OUTPUT.exists() or OUTPUT.read_bytes() != data:
        OUTPUT.write_bytes(data)
    print(json.dumps({"artifact": pin, "sourceRecords": records, "pitchPairs": pairs, "levelRows": levels}))


if __name__ == "__main__":
    main()
