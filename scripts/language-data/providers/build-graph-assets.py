#!/usr/bin/env python3
"""Build compact Tier-2 linguistic graph assets from the language-data sources."""

import argparse
import csv
import hashlib
import json
import os
import ssl
import tarfile
import tempfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(os.environ.get("MLEARN_ROOT_OF_APP", Path(__file__).resolve().parents[1] / "source" / "root-of-app"))
JITENDEX_DIR = ROOT / "dictionaries" / "jitendex-yomitan"
OPENRUSSIAN_COMMIT = "50e210c4803237779cb562bc1abcea529066031c"
OPENRUSSIAN_BASE_URL = f"https://raw.githubusercontent.com/Badestrand/russian-dictionary/{OPENRUSSIAN_COMMIT}"
SOURCE_FILES = ("words.csv", "forms.csv")
LEGACY_SOURCE_FILES = {"nouns": 10, "verbs": 6, "adjectives": 4, "others": 4}
FREEDICT_INDEX_URL = "https://freedict.org/freedict-database.json"
TEI_NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def log(message: str) -> None:
    print(message, flush=True)


def ssl_context():
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl._create_unverified_context()


def download(url: str, destination: Path) -> None:
    log(f"Downloading {url}")
    with urllib.request.urlopen(url, context=ssl_context()) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def normalized(value: object) -> str:
    return unicodedata.normalize("NFC", " ".join(str(value or "").replace("*", "").split()))


def unstressed(value: object) -> str:
    return unicodedata.normalize("NFC", "".join(
        char for char in unicodedata.normalize("NFD", normalized(value).replace("'", "")) if char != "\u0301"
    ))


def stressed(value: object) -> str:
    return unicodedata.normalize("NFC", normalized(value).replace("'", "\u0301"))


def surface_id(language: str, surface: str) -> str:
    return f"{language}:surface:{hashlib.sha256(surface.encode('utf-8')).hexdigest()}"


class Graph:
    def __init__(self, language: str, source_versions: dict[str, str]) -> None:
        self.language = language
        self.source_versions = source_versions
        self.entities: dict[str, dict[str, str]] = {}
        self.relations: dict[tuple[str, str, str, str], dict[str, str]] = {}

    def entity(self, entity_id: str, kind: str, label: str = "") -> str:
        if entity_id not in self.entities:
            entity = {"id": entity_id, "kind": kind}
            if label:
                entity["label"] = label
            self.entities[entity_id] = entity
        return entity_id

    def relation(self, source: str, target: str, relation_type: str, provenance: str) -> None:
        self.relations.setdefault((source, target, relation_type, provenance), {
            "from": source, "to": target, "type": relation_type, "provenance": provenance,
        })

    def write(self) -> tuple[int, int, int]:
        asset = {
            "schemaVersion": 1,
            "language": self.language,
            "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "sourceVersions": self.source_versions,
            "entities": list(self.entities.values()),
            "relations": list(self.relations.values()),
        }
        destination = ROOT / "languages" / f"{self.language}.graph.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(asset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        with destination.open(encoding="utf-8") as source:
            loaded = json.load(source)
        assert loaded["schemaVersion"] == 1
        ids = {entity["id"] for entity in loaded["entities"]}
        assert all(relation["from"] in ids and relation["to"] in ids for relation in loaded["relations"])
        size = destination.stat().st_size
        log(f"{self.language}: {len(ids)} entities, {len(loaded['relations'])} relations, {size} bytes")
        return len(ids), len(loaded["relations"]), size


def text_content(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [text for item in value for text in text_content(item)]
    if isinstance(value, dict):
        if value.get("data", {}).get("content") != "glossary":
            return text_content(value.get("content", []))
        return text_content(value.get("content", []))
    return []


def build_ja() -> tuple[int, int, int]:
    graph = Graph("ja", {"dictionary": "jitendex-2024.10.07.0", "pitchAccent": "pitch1"})
    pitch_by_term_reading: dict[tuple[str, str], set[str]] = {}
    for path in sorted(JITENDEX_DIR.glob("term_meta_bank_*.json")):
        for term, kind, payload, *_ in json.loads(path.read_text(encoding="utf-8")):
            if kind != "pitch" or not isinstance(payload, dict):
                continue
            reading = str(payload.get("reading") or "")
            patterns = {f"p{pitch.get('position')}" for pitch in payload.get("pitches", []) if isinstance(pitch, dict) and isinstance(pitch.get("position"), int)}
            if reading and patterns:
                pitch_by_term_reading.setdefault((str(term), reading), set()).update(patterns)
    for path in sorted(JITENDEX_DIR.glob("term_bank_*.json")):
        for row in json.loads(path.read_text(encoding="utf-8")):
            if len(row) < 7 or not row[6]:
                continue
            term, reading, glosses, sequence = str(row[0]), str(row[1] or row[0]), row[5], row[6]
            entry = graph.entity(f"ja:entry:{sequence}", "dictionary-entry", term)
            surface = graph.entity(surface_id("ja", term), "surface", term)
            pronunciation = graph.entity(f"ja:pron:{reading}", "pronunciation", reading)
            graph.relation(surface, entry, "realizes", "jitendex")
            graph.relation(surface, pronunciation, "has-pronunciation", "jitendex")
            for pattern in pitch_by_term_reading.get((term, reading), set()):
                prosody = graph.entity(f"ja:prosody:{pattern}", "grammar-pattern", pattern)
                graph.relation(surface, prosody, "has-prosodic-pattern", "kanjium-pitch")
            for index, gloss in enumerate(text_content(glosses)[:3], start=1):
                gloss = normalized(gloss)
                if gloss:
                    sense = graph.entity(f"ja:sense:{sequence}:{index}", "sense", gloss)
                    graph.relation(entry, sense, "has-sense", "jitendex")
    return graph.write()


def add_russian_record(graph: Graph, local_id: str, bare: str, reading: str, gender: str, forms: list[str]) -> None:
    lemma = unstressed(bare)
    if not lemma:
        return
    entry = graph.entity(f"ru:entry:{local_id or lemma}", "dictionary-entry", lemma)
    lemma_surface = graph.entity(surface_id("ru", lemma), "surface", lemma)
    graph.relation(lemma_surface, entry, "realizes", "openrussian")
    if gender in {"m", "f", "n"}:
        gender_id = graph.entity(f"ru:gender:{gender}", "grammar-pattern", gender)
        graph.relation(entry, gender_id, "has-gender", "openrussian")
    reading = stressed(reading or bare)
    if reading:
        pronunciation = graph.entity(f"ru:pron:{reading}", "pronunciation", reading)
        graph.relation(lemma_surface, pronunciation, "has-pronunciation", "openrussian")
    for form in forms[:12]:
        form = unstressed(form)
        if form and form != lemma:
            form_surface = graph.entity(surface_id("ru", form), "surface", form)
            graph.relation(form_surface, lemma_surface, "inflection-of", "openrussian-forms")


def build_ru_from_legacy(graph: Graph, temp_dir: Path) -> None:
    for name, first_form_index in LEGACY_SOURCE_FILES.items():
        path = temp_dir / f"{name}.csv"
        download(f"{OPENRUSSIAN_BASE_URL}/{name}.csv", path)
        with path.open(encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source, delimiter="\t")
            form_columns = list(reader.fieldnames or [])[first_form_index:]
            for index, row in enumerate(reader):
                forms = [row.get(column, "") for column in form_columns]
                add_russian_record(graph, f"{name}:{index}", row.get("bare", ""), row.get("accented", ""), normalized(row.get("gender")).lower()[:1], forms)


def build_ru() -> tuple[int, int, int]:
    graph = Graph("ru", {"provider": f"openrussian-{OPENRUSSIAN_COMMIT}"})
    with tempfile.TemporaryDirectory(prefix="mlearn-openrussian-") as temp_name:
        temp_dir = Path(temp_name)
        try:
            paths = []
            for filename in SOURCE_FILES:
                path = temp_dir / filename
                download(f"{OPENRUSSIAN_BASE_URL}/{filename}", path)
                paths.append(path)
            with paths[0].open(encoding="utf-8-sig", newline="") as words_source, paths[1].open(encoding="utf-8-sig", newline="") as forms_source:
                forms_by_word: dict[str, list[str]] = {}
                for row in csv.DictReader(forms_source):
                    forms_by_word.setdefault(str(row.get("word_id") or row.get("word") or ""), []).append(str(row.get("form") or row.get("bare") or ""))
                for row in csv.DictReader(words_source):
                    local_id = str(row.get("id") or row.get("bare") or "")
                    add_russian_record(graph, local_id, row.get("bare", ""), row.get("accented") or row.get("stressed") or "", normalized(row.get("gender")).lower()[:1], forms_by_word.get(local_id, []))
        except Exception as error:
            log(f"Warning: words.csv/forms.csv unavailable ({error}); using pinned OpenRussian source tables")
            build_ru_from_legacy(graph, temp_dir)
    return graph.write()


def build_de() -> tuple[int, int, int] | None:
    try:
        with urllib.request.urlopen(FREEDICT_INDEX_URL, context=ssl_context()) as response:
            index = json.load(response)
        dictionary = next(item for item in index if item.get("name") == "deu-eng")
        releases = [release for release in dictionary.get("releases", []) if str(release.get("URL", "")).endswith(".src.tar.xz")]
        release = sorted(releases, key=lambda item: str(item.get("date", "")))[-1]
        version = str(release.get("software-version") or release.get("version") or release.get("date"))
        graph = Graph("de", {"provider": f"freedict-deu-eng-{version}"})
        with tempfile.TemporaryDirectory(prefix="mlearn-freedict-") as temp_name:
            temp_dir = Path(temp_name)
            archive = temp_dir / "deu-eng.tar.xz"
            download(str(release["URL"]), archive)
            with tarfile.open(archive, "r:xz") as source:
                tei_member = next(member for member in source.getmembers() if member.isfile() and member.name.endswith((".tei", ".tei.xml")))
                source.extract(tei_member, temp_dir)
            entry_index = 0
            for _, entry in ET.iterparse(temp_dir / tei_member.name, events=("end",)):
                if entry.tag != f"{{{TEI_NS['tei']}}}entry":
                    continue
                entry_index += 1
                entry_id = graph.entity(f"de:entry:{entry_index}", "dictionary-entry")
                for orth in entry.findall("./tei:form/tei:orth", TEI_NS):
                    word = normalized("".join(orth.itertext()))
                    if word:
                        surface = graph.entity(surface_id("de", word), "surface", word)
                        graph.relation(surface, entry_id, "realizes", "freedict")
                gender = normalized(entry.findtext("./tei:gramGrp/tei:gen", default="", namespaces=TEI_NS)).lower()[:1]
                if gender in {"m", "f", "n"}:
                    gender_id = graph.entity(f"de:gender:{gender}", "grammar-pattern", gender)
                    graph.relation(entry_id, gender_id, "has-gender", "freedict")
                for sense_index, sense in enumerate(entry.findall("./tei:sense", TEI_NS)[:3], start=1):
                    gloss = next((normalized("".join(node.itertext())) for node in sense.findall(".//tei:quote", TEI_NS) if normalized("".join(node.itertext()))), "")
                    if gloss:
                        sense_id = graph.entity(f"de:sense:{entry_index}:{sense_index}", "sense", gloss)
                        graph.relation(entry_id, sense_id, "has-sense", "freedict")
                entry.clear()
        return graph.write()
    except Exception as error:
        log(f"Warning: skipping de graph asset: {error}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", nargs="+", choices=("ja", "ru", "de"), default=("ja", "ru", "de"))
    args = parser.parse_args()
    builders = {"ja": build_ja, "ru": build_ru, "de": build_de}
    for language in args.languages:
        builders[language]()


if __name__ == "__main__":
    main()
