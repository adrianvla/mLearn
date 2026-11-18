"""Offline KANJIDIC2/KRADFILE conversion into the existing lexical resource."""

from collections.abc import Callable
from dataclasses import dataclass
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from typing import TypedDict
import xml.etree.ElementTree as ET


class SourcePin(TypedDict):
    sha256: str
    byteLength: int
    expandedSha256: str
    expandedByteLength: int
    encoding: str


class DictionaryPin(SourcePin):
    fileVersion: str
    databaseVersion: str
    dateOfCreation: str


class CharacterValue(TypedDict):
    text: str
    attributes: dict[str, str]


class ReadingMeaningGroup(TypedDict):
    readings: list[CharacterValue]
    meanings: list[CharacterValue]


class CharacterRecord(TypedDict):
    literal: str
    codepoint: str
    codes: list[CharacterValue]
    groups: list[ReadingMeaningGroup]
    nameReadings: list[str]
    strokeCounts: list[int]
    grade: int | None
    frequency: int | None
    legacyJlpt: int | None
    radicals: list[CharacterValue]
    variants: list[CharacterValue]
    components: list[str] | None


@dataclass(frozen=True, slots=True)
class CharacterCounts:
    characters: int
    component_records: int
    component_source_records: int


class CharacterSourceError(RuntimeError):
    def __init__(self, source: Path, reason: str) -> None:
        self.source = source
        self.reason = reason
        super().__init__(f"{source}: {reason}")


def verify_source(source: Path, pin: SourcePin) -> None:
    """Verify both representations before parsing; expansion stays streaming."""
    if source.stat().st_size != pin["byteLength"]:
        raise CharacterSourceError(source, "Compressed byte length differs from pin")
    with source.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != pin["sha256"]:
        raise CharacterSourceError(source, "Compressed digest differs from pin")
    size = 0
    expanded = hashlib.sha256()
    with gzip.open(source, "rb") as stream:
        while chunk := stream.read(65536):
            size += len(chunk)
            if size > pin["expandedByteLength"]:
                raise CharacterSourceError(source, "Expansion exceeds pin")
            expanded.update(chunk)
    if size != pin["expandedByteLength"] or expanded.hexdigest() != pin["expandedSha256"]:
        raise CharacterSourceError(source, "Expanded bytes differ from pin")


def _values(entry: ET.Element, query: str, source: Path) -> list[CharacterValue]:
    values: list[CharacterValue] = []
    for element in entry.findall(query):
        text = (element.text or "").strip()
        if not text:
            raise CharacterSourceError(source, f"Empty {query} value")
        values.append({"text": text, "attributes": dict(element.attrib)})
    return values


def _number(value: str, source: Path) -> int:
    if not value.isascii() or not value.isdecimal() or int(value) <= 0:
        raise CharacterSourceError(source, "Invalid positive numeric field")
    return int(value)


def prepare_characters(
    db: sqlite3.Connection,
    *,
    dictionary: Path,
    dictionary_pin: DictionaryPin,
    components: Path,
    components_pin: SourcePin,
    encode: Callable[[CharacterRecord], bytes],
) -> CharacterCounts:
    """Append records; the caller owns the resource transaction/publication.

    KRAD keys describe visual lookup elements, including representative kanji.
    They deliberately have no lexical target or inherited learner state.
    """
    verify_source(dictionary, dictionary_pin)
    verify_source(components, components_pin)
    parts: dict[str, list[str]] = {}
    with gzip.open(components, "rt", encoding=components_pin["encoding"]) as stream:
        for line in stream:
            if not line.strip() or line.startswith("#"):
                continue
            literal, separator, value = line.strip().partition(" : ")
            elements = value.split()
            if not separator or len(literal) != 1 or not elements or any(len(item) != 1 for item in elements):
                raise CharacterSourceError(components, "Invalid lookup-element row")
            if literal in parts:
                raise CharacterSourceError(components, "Duplicate component source character")
            parts[literal] = elements
    count = 0
    covered = 0
    header_seen = False
    with gzip.open(dictionary, "rb") as stream:
        context = ET.iterparse(stream, events=("start", "end"))
        _, root = next(context)
        if root.tag != "kanjidic2":
            raise CharacterSourceError(dictionary, "Unexpected document root")
        for event, entry in context:
            match event, entry.tag:
                case "end", "header":
                    if (header_seen
                            or entry.findtext("file_version") != dictionary_pin["fileVersion"]
                            or entry.findtext("database_version") != dictionary_pin["databaseVersion"]
                            or entry.findtext("date_of_creation") != dictionary_pin["dateOfCreation"]):
                        raise CharacterSourceError(dictionary, "Header differs from pinned edition")
                    header_seen = True
                    root.clear()
                case "end", "character":
                    if not header_seen:
                        raise CharacterSourceError(dictionary, "Character precedes edition header")
                    literal = entry.findtext("literal", "")
                    if len(literal) != 1:
                        raise CharacterSourceError(dictionary, "Character must have one literal scalar")
                    codepoint = format(ord(literal), "x")
                    declared = entry.findall("codepoint/cp_value[@cp_type='ucs']")
                    if len(declared) != 1 or (declared[0].text or "").lower() != codepoint:
                        raise CharacterSourceError(dictionary, "Literal and UCS identity disagree")
                    numbers = {}
                    for name in ("grade", "freq", "jlpt"):
                        value = entry.findtext(f"misc/{name}")
                        numbers[name] = None if value is None else _number(value, dictionary)
                    record: CharacterRecord = {
                        "literal": literal,
                        "codepoint": codepoint,
                        "codes": _values(entry, "codepoint/cp_value", dictionary),
                        "groups": [
                            {"readings": _values(group, "reading", dictionary),
                             "meanings": _values(group, "meaning", dictionary)}
                            for group in entry.findall("reading_meaning/rmgroup")
                        ],
                        "nameReadings": [value["text"] for value in _values(entry, "reading_meaning/nanori", dictionary)],
                        "strokeCounts": [_number(value["text"], dictionary)
                                         for value in _values(entry, "misc/stroke_count", dictionary)],
                        "grade": numbers["grade"],
                        "frequency": numbers["freq"],
                        "legacyJlpt": numbers["jlpt"],
                        "radicals": _values(entry, "radical/rad_value", dictionary),
                        "variants": _values(entry, "misc/variant", dictionary),
                        "components": parts.get(literal),
                    }
                    db.execute("INSERT INTO resource_entries VALUES (?,?)", ("character/" + codepoint, encode(record)))
                    count += 1
                    covered += literal in parts
                    entry.clear()
                    root.clear()
                case _:
                    # Nested/unknown XML elements are not a closed variant set.
                    continue
    if not header_seen or not count:
        raise CharacterSourceError(dictionary, "Character source is empty")
    return CharacterCounts(characters=count, component_records=covered, component_source_records=len(parts))


def freeze_source(source: Path, destination: Path, pin: SourcePin) -> None:
    """Publish verified bytes without overwriting another source artifact."""
    verify_source(source, pin)
    if destination.exists():
        verify_source(destination, pin)
        return
    with tempfile.TemporaryDirectory(dir=destination.parent, prefix=".character-") as scratch:
        staged = Path(scratch) / "snapshot.gz"
        shutil.copyfile(source, staged)
        verify_source(staged, pin)
        os.link(staged, destination)


def main() -> None:
    """Freeze explicitly supplied, verified source snapshots for offline builds."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kanjidic2", required=True, type=Path)
    parser.add_argument("--kradfile", required=True, type=Path)
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    package = root / "language-plugins/japanese"
    pins = json.loads((package / "data-pin.json").read_text(encoding="utf-8"))
    output = package / "assets"
    output.mkdir(parents=True, exist_ok=True)
    frozen = []
    for name, source in (("kanjidic2", arguments.kanjidic2), ("kradfile", arguments.kradfile)):
        pin = pins[name]
        filename = pin["artifactPath"]
        if not isinstance(filename, str) or Path(filename).name != filename:
            raise CharacterSourceError(source, "Artifact must have a local filename")
        destination = output / filename
        freeze_source(source, destination, pin)
        frozen.append({"path": str(destination), "sha256": pin["sha256"], "byteLength": pin["byteLength"]})
    print(json.dumps({"frozen": frozen}))


if __name__ == "__main__":
    main()
