#!/usr/bin/env python3
"""Build compact Tier-2 linguistic graph assets from the language-data sources."""

import argparse
import csv
import hashlib
import json
import os
import sqlite3
import ssl
import tarfile
import tempfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(os.environ.get("MLEARN_ROOT_OF_APP", Path(__file__).resolve().parents[1] / "source" / "root-of-app"))
JITENDEX_DIR = ROOT / "dictionaries" / "jitendex-yomitan"
OPENRUSSIAN_COMMIT = "50e210c4803237779cb562bc1abcea529066031c"
OPENRUSSIAN_BASE_URL = f"https://raw.githubusercontent.com/Badestrand/russian-dictionary/{OPENRUSSIAN_COMMIT}"
SOURCE_FILES = ("words.csv", "forms.csv")
LEGACY_SOURCE_FILES = {"nouns": 10, "verbs": 6, "adjectives": 4, "others": 4}
FREEDICT_INDEX_URL = "https://freedict.org/freedict-database.json"
TEI_NS = {"tei": "http://www.tei-c.org/ns/1.0"}
ENTITY_KINDS = {"dictionary-entry", "lexeme", "surface", "sense", "pronunciation", "character", "morpheme", "grammar-pattern", "analysis"}
RELATION_TYPES = {"inflection-of", "lemma-of", "realizes", "has-sense", "has-pronunciation", "has-gender", "has-pos", "has-prosodic-pattern", "has-character", "has-reading", "has-morpheme", "orthographic-variant-of", "component-of", "derived-from", "semantically-related", "morphologically-related", "analyzes", "analysis-member"}
# Mirror of GraphDomain in src/shared/graph/types.ts: the runtime treats a
# missing `domain` as 'common', and DEFAULT_ENABLED_DOMAINS (['common']) keeps
# specialized domains out of ordinary learning/prediction.
GRAPH_DOMAINS = {"common", "names", "archaic", "technical", "dialectal"}
# Proper-noun/name-domain markers on Jitendex (JMdict-derived) term rows:
# JMdict's name-type misc codes plus Jitendex's mythology badge codes.
# fem/masc ("female/male term or language") are part-of-speech, not names.
NAME_DOMAIN_CODES = frozenset({
    "surname", "place", "unclass", "unc", "company", "product", "organization", "full",
    "given", "person", "station", "deity", "char", "obj", "creat", "leg", "myth",
    "group", "ev", "work", "relg", "chmyth", "grmyth", "jpmyth", "rommyth",
})
# Title text that also identifies a name-domain badge, covering codes Jitendex
# may spell differently across revisions ("unclassified" for `unc` has no
# "name" substring).
NAME_DOMAIN_TITLE_PARTS = ("name", "person", "deity", "mytholog", "legend", "unclassified")


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
        self.entities: dict[str, dict[str, object]] = {}
        self.relations: dict[tuple[str, str, str, str], dict[str, str]] = {}
    def entity(self, entity_id: str, kind: str, label: str = "", grammar: dict[str, object] | None = None, domain: str | None = None) -> str:
        assert kind in ENTITY_KINDS
        assert domain is None or domain in GRAPH_DOMAINS
        if entity_id not in self.entities:
            entity: dict[str, object] = {"id": entity_id, "kind": kind}
            if label:
                entity["label"] = label
            if grammar:
                entity["grammar"] = grammar
            if domain:
                entity["domain"] = domain
            self.entities[entity_id] = entity
        return entity_id

    def relation(self, source: str, target: str, relation_type: str, provenance: str) -> None:
        assert relation_type in RELATION_TYPES
        self.relations.setdefault((source, target, relation_type, provenance), {
            "from": source, "to": target, "type": relation_type, "provenance": provenance,
        })

    def add_entry_sibling_support(self) -> int:
        """Sibling surfaces realizing one dictionary entry share source grouping,
        never learner identity (Tier-2 invariant: dictionary-entry grouping is
        provenance, at most a support relation between siblings). Emits explicit
        `semantically-related` edges in both directions so inspection and
        prediction see related-but-independent kin instead of an implicit
        property hop."""
        entry_siblings: dict[str, tuple[str, set[str]]] = {}
        for source, target, relation_type, provenance in self.relations:
            if relation_type != "realizes":
                continue
            entry = target if self.entities.get(target, {}).get("kind") == "dictionary-entry" else source
            sibling = source if entry == target else target
            entry_siblings.setdefault(entry, (provenance, set()))[1].add(sibling)
        added = 0
        for _entry, (provenance, siblings) in sorted(entry_siblings.items()):
            if len(siblings) < 2:
                continue
            ordered = sorted(siblings)
            for index, first in enumerate(ordered):
                for second in ordered[index + 1:]:
                    self.relation(first, second, "semantically-related", provenance)
                    self.relation(second, first, "semantically-related", provenance)
                    added += 2
        return added

    def write(self) -> tuple[int, int, int]:
        sibling_edges = self.add_entry_sibling_support()
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
        log(f"{self.language}: {len(ids)} entities, {len(loaded['relations'])} relations ({sibling_edges} entry-sibling support), {size} bytes")
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


def is_name_domain(content: object) -> bool:
    """Whether a Yomitan term row's structured content carries proper-noun/name-domain
    markers: JMdict name-type misc codes (person, place, work, unclassified name, ...)
    or Jitendex mythology badges. fem/masc are "female/male term or language" (a
    part-of-speech), so they are deliberately not markers."""

    def visit(node: object) -> bool:
        if isinstance(node, dict):
            data = node.get("data")
            code = data.get("code") if isinstance(data, dict) else None
            title = node.get("title")
            if isinstance(code, str) and code in NAME_DOMAIN_CODES:
                return True
            if isinstance(title, str) and any(part in title.lower() for part in NAME_DOMAIN_TITLE_PARTS):
                return True
            return any(visit(child) for child in node.values())
        if isinstance(node, list):
            return any(visit(child) for child in node)
        return False

    return visit(content)


def grammar_entity_id(language: str, pattern: str) -> str:
    return f"{language}:grammar:{normalized(pattern)}"


def add_grammar_from_metadata(graph: Graph) -> None:
    path = ROOT / "languages" / f"{graph.language}.json"
    if not path.exists():
        return
    for point in json.loads(path.read_text(encoding="utf-8")).get("grammar", []):
        pattern = normalized(point.get("pattern"))
        meaning = normalized(point.get("meaning"))
        level = point.get("level")
        if not pattern or not meaning or not isinstance(level, int):
            continue
        construction: dict[str, object] = {"meaning": meaning, "level": level}
        match = point.get("match")
        if isinstance(match, dict):
            construction["recognitionRules"] = [match]
        elif isinstance(match, list):
            construction["recognitionRules"] = match
        # Optional construction metadata: forward only what the package declares;
        # the TS GrammarConstruction schema treats absent fields as unknown.
        for field in ("category", "function", "formation", "register"):
            value = point.get(field)
            if isinstance(value, str) and value.strip():
                construction[field] = normalized(value)
        for field in ("attachments", "constraints", "variants", "contrasts", "related"):
            value = point.get(field)
            if isinstance(value, list) and all(isinstance(item, str) for item in value):
                construction[field] = [normalized(item) for item in value]
        graph.entity(grammar_entity_id(graph.language, pattern), "grammar-pattern", pattern, construction)


# JMdict short POS codes (Jitendex renders them as structured-content spans
# carrying data.code); anything outside this set is a field/misc tag, not POS.
JMDICT_POS_CODES = frozenset({
    "n", "pn", "n-adv", "n-t", "n-suf", "n-pref", "pron", "ctr",
    "adj-i", "adj-ix", "adj-na", "adj-no", "adj-pref", "adj-t", "adj-f",
    "adj-kari", "adj-ku", "adj-nari", "adj-shiku", "adj-ts",
    "v1", "v1-s", "v2a-s", "v2b-s", "v2c-s", "v2d-s", "v2e-s", "v2f-s", "v2g-s",
    "v2h-s", "v2i-s", "v2j-s", "v2k-s", "v2l-s", "v2m-s", "v2n-s", "v2o-s",
    "v2p-s", "v2q-s", "v2r-s", "v2t-s", "v2w-s", "v2y-s", "v2z-s",
    "v4h", "v4r", "v4t",
    "v5aru", "v5b", "v5g", "v5k", "v5k-s", "v5m", "v5n", "v5r", "v5r-s", "v5s",
    "v5t", "v5u", "v5u-s", "v5uru", "v5z",
    "vz", "vi", "vk", "vn", "vr", "vs", "vs-c", "vs-i", "vs-s", "vt",
    "aux", "aux-v", "aux-adj", "cop", "int", "adv", "adv-to", "conj", "pref", "suf", "exp",
})


def compound_strategy(language: str) -> dict[str, object] | None:
    """Package-declared strategy, or None. Structural emission additionally
    requires the explicit `derivation: "builder"` authorization — declaring a
    runtime splitting strategy alone never causes graph edge inference."""
    path = ROOT / "languages" / f"{language}.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8")).get("compoundSplitting")
    if not isinstance(raw, dict) or raw.get("derivation") != "builder":
        return None
    locale = raw.get("locale")
    linkers = raw.get("linkingElements")
    if not isinstance(locale, str) or not isinstance(linkers, list):
        return None
    suffixes = raw.get("inflectionSuffixes")
    min_part = raw.get("minPartLength")
    return {
        "locale": locale,
        "linkingElements": [str(item) for item in linkers],
        "inflectionSuffixes": [str(item) for item in suffixes] if isinstance(suffixes, list) else [],
        "minPartLength": min_part if isinstance(min_part, int) else 3,
    }


MAX_COMPOUND_LABEL_LENGTH = 48


def emit_compound_component_edges(graph: Graph, strategy: dict[str, object], provenance: str) -> int:
    """Build-time derivation of ATTESTED compound structure: for each surface
    whose label has exactly ONE parse into attested surface leaves under the
    package strategy, emit component-of edges (leaf surface -> compound
    surface). Mirrors the runtime contract: a unique nested split takes
    precedence over an atomic attested surface, an ambiguous nested split
    rejects the candidate, suffix candidates apply to the whole form only.
    Ambiguous forms are skipped — the graph records only facts derived
    uniquely. Build tooling only; nothing here runs in the app runtime.
    Case folding uses Unicode-default casefold (no locale tailoring)."""
    linkers = [str(item) for item in strategy["linkingElements"]]
    suffixes = [str(item) for item in strategy.get("inflectionSuffixes", [])]
    min_part = int(strategy.get("minPartLength", 3))
    ids_by_folded: dict[str, str] = {}
    for entity in graph.entities.values():
        if entity.get("kind") == "surface" and entity.get("label"):
            label = str(entity["label"])
            if len(label) <= MAX_COMPOUND_LABEL_LENGTH:
                ids_by_folded.setdefault(label.casefold(), str(entity["id"]))

    self_id_cell = [""]

    def parse_part(word: str, exclude_self: bool) -> tuple[str, ...] | None:
        """Unique leaf tuple for word, or None. Split precedence over atomic;
        ambiguous nested splits reject; no split -> atomic attested surface."""
        nested: set[tuple[str, ...]] = set()
        for boundary in range(min_part, len(word) - min_part + 1):
            for linker in linkers:
                if word[boundary:boundary + len(linker)].casefold() != linker:
                    continue
                left = word[:boundary]
                right = word[boundary + len(linker):]
                if len(right) < min_part:
                    continue
                if not ids_by_folded.get(left.casefold()):
                    continue
                right_leaves = parse_part(right, False)
                if right_leaves:
                    nested.add((left, *right_leaves))
        if len(nested) == 1:
            return next(iter(nested))
        if len(nested) > 1:
            return None
        own = ids_by_folded.get(word.casefold())
        if own and not (exclude_self and own == self_id_cell[0]):
            return (word,)
        return None

    emitted = 0
    for entity in list(graph.entities.values()):
        if entity.get("kind") != "surface":
            continue
        label = str(entity.get("label") or "")
        if not label or len(label) > MAX_COMPOUND_LABEL_LENGTH:
            continue
        self_id_cell[0] = str(entity["id"])
        distinct: set[tuple[str, ...]] = set()
        candidates = [label]
        folded = label.casefold()
        for suffix in suffixes:
            if folded.endswith(suffix) and len(label) - len(suffix) >= min_part:
                candidates.append(label[: -len(suffix)])
        for candidate in candidates:
            leaves = parse_part(candidate, True)
            if leaves and len(leaves) >= 2 and all(len(leaf) >= min_part for leaf in leaves):
                distinct.add(leaves)
        if len(distinct) != 1:
            continue
        for leaf in next(iter(distinct)):
            leaf_id = ids_by_folded.get(leaf.casefold())
            if leaf_id and leaf_id != self_id_cell[0]:
                graph.relation(leaf_id, self_id_cell[0], "component-of", provenance)
                emitted += 1
    return emitted


def structured_pos_codes(content: object, found: set[str]) -> None:
    if isinstance(content, dict):
        data = content.get("data")
        code = data.get("code") if isinstance(data, dict) else None
        if isinstance(code, str) and code in JMDICT_POS_CODES:
            found.add(code)
        for value in content.values():
            structured_pos_codes(value, found)
    elif isinstance(content, list):
        for value in content:
            structured_pos_codes(value, found)


def build_ja() -> tuple[int, int, int]:
    graph = Graph("ja", {"dictionary": "jitendex-2024.10.07.0", "pitchAccent": "pitch1"})
    add_grammar_from_metadata(graph)
    pitch_by_term_reading: dict[tuple[str, str], set[str]] = {}
    for path in sorted(JITENDEX_DIR.glob("term_meta_bank_*.json")):
        for term, kind, payload, *_ in json.loads(path.read_text(encoding="utf-8")):
            if kind != "pitch" or not isinstance(payload, dict):
                continue
            reading = str(payload.get("reading") or "")
            patterns = {f"p{pitch.get('position')}" for pitch in payload.get("pitches", []) if isinstance(pitch, dict) and isinstance(pitch.get("position"), int)}
            if reading and patterns:
                pitch_by_term_reading.setdefault((str(term), reading), set()).update(patterns)
    surveys: list[tuple[str, str, object, object, bool]] = []
    for path in sorted(JITENDEX_DIR.glob("term_bank_*.json")):
        for row in json.loads(path.read_text(encoding="utf-8")):
            if len(row) < 7 or not row[6]:
                continue
            surveys.append((str(row[0]), str(row[1] or row[0]), row[5], row[6], is_name_domain(row[5])))
    # Name-domain marking is survey-based: a surface shared between a name row and
    # a common row (e.g. レア "Rhea" / レア "rare") stays common so a name sense can
    # never hide a common homograph, while an entry is names when any of its rows
    # (same ent_seq) carries a name marker. Duplicate rows of a name sequence
    # without badges (JMdict re-lists an entry per reading) do not demote it.
    name_sequences = {sequence for _, _, _, sequence, name_domain in surveys if name_domain}
    common_terms = {term for term, _, _, sequence, name_domain in surveys if not name_domain and sequence not in name_sequences}
    for term, reading, glosses, sequence, _ in surveys:
        entry = graph.entity(f"ja:entry:{sequence}", "dictionary-entry", term, domain="names" if sequence in name_sequences else None)
        surface_domain = "names" if sequence in name_sequences and term not in common_terms else None
        surface = graph.entity(surface_id("ja", term), "surface", term, domain=surface_domain)
        pronunciation = graph.entity(f"ja:pron:{reading}", "pronunciation", reading)
        graph.relation(surface, entry, "realizes", "jitendex")
        graph.relation(surface, pronunciation, "has-pronunciation", "jitendex")
        graph.relation(entry, pronunciation, "has-reading", "jitendex")
        for pattern in pitch_by_term_reading.get((term, reading), set()):
            prosody = graph.entity(f"ja:prosody:{pattern}", "grammar-pattern", pattern)
            graph.relation(surface, prosody, "has-prosodic-pattern", "kanjium-pitch")
        pos_codes: set[str] = set()
        structured_pos_codes(glosses, pos_codes)
        for code in sorted(pos_codes):
            pos_entity = graph.entity(f"ja:pos:{code}", "grammar-pattern", code)
            graph.relation(entry, pos_entity, "has-pos", "jitendex")
        for index, gloss in enumerate(text_content(glosses)[:3], start=1):
            gloss = normalized(gloss)
            if gloss:
                sense = graph.entity(f"ja:sense:{sequence}:{index}", "sense", gloss, domain="names" if sequence in name_sequences else None)
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
        graph.relation(entry, pronunciation, "has-reading", "openrussian")
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
    add_grammar_from_metadata(graph)
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
        add_grammar_from_metadata(graph)
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
                entry_words = []
                for orth in entry.findall("./tei:form/tei:orth", TEI_NS):
                    word = normalized("".join(orth.itertext()))
                    if word:
                        entry_words.append(word)
                entry_id = graph.entity(f"de:entry:{entry_index}", "dictionary-entry", entry_words[0] if entry_words else "")
                for word in entry_words:
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
        strategy = compound_strategy("de")
        if strategy:
            edges = emit_compound_component_edges(graph, strategy, "compound-splitter")
            log(f"compound component-of edges emitted: {edges}")
        return graph.write()
    except Exception as error:
        log(f"Warning: skipping de graph asset: {error}")
        return None


def dictionary_version(language: str) -> str:
    metadata_path = ROOT / "dictionaries" / language / "en" / "metadata.json"
    if not metadata_path.exists():
        return "local-dictionary"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    return str(metadata.get("version") or "local-dictionary")


def dictionary_rows(language: str):
    path = ROOT / "dictionaries" / language / "en" / "dictionary.db"
    with sqlite3.connect(path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(entries)")}
        fields = [field for field in ("headword", "reading", "pos", "data") if field in columns]
        for row in connection.execute(f"SELECT {','.join(fields)} FROM entries"):
            record = dict(zip(fields, row))
            payload = json.loads(zlib.decompress(record.pop("data")).decode("utf-8"))
            yield record, payload


def dictionary_entry_id(language: str, payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"{language}:entry:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def build_zh() -> tuple[int, int, int]:
    graph = Graph("zh", {"dictionary": dictionary_version("zh-Hans")})
    for _, payload in dictionary_rows("zh-Hans"):
        simplified = normalized(payload.get("simplified"))
        traditional = normalized(payload.get("traditional"))
        if not simplified:
            continue
        entry = graph.entity(dictionary_entry_id("zh", payload), "dictionary-entry", simplified)
        simplified_surface = graph.entity(surface_id("zh", simplified), "surface", simplified)
        graph.relation(simplified_surface, entry, "realizes", "cc-cedict")
        if traditional:
            traditional_surface = graph.entity(surface_id("zh", traditional), "surface", traditional)
            graph.relation(traditional_surface, entry, "realizes", "cc-cedict")
            if traditional != simplified:
                graph.relation(traditional_surface, simplified_surface, "orthographic-variant-of", "cc-cedict")
        pinyin_data = payload.get("pinyin")
        pinyin = normalized(pinyin_data.get("value") if isinstance(pinyin_data, dict) else "")
        if pinyin:
            pronunciation = graph.entity(f"zh:pron:{hashlib.sha256(pinyin.encode('utf-8')).hexdigest()}", "pronunciation", pinyin)
            graph.relation(simplified_surface, pronunciation, "has-pronunciation", "cc-cedict")
            graph.relation(simplified_surface, pronunciation, "has-reading", "cc-cedict")
            if traditional and traditional != simplified:
                graph.relation(surface_id("zh", traditional), pronunciation, "has-pronunciation", "cc-cedict")
                graph.relation(surface_id("zh", traditional), pronunciation, "has-reading", "cc-cedict")
        numeric = normalized(pinyin_data.get("numeric") if isinstance(pinyin_data, dict) else "")
        tone_sequence = "".join(char for char in numeric if char.isdigit())
        if tone_sequence:
            prosody = graph.entity(f"zh:prosody:{tone_sequence}", "grammar-pattern", "-".join(tone_sequence))
            graph.relation(simplified_surface, prosody, "has-prosodic-pattern", "cc-cedict")
            if traditional and traditional != simplified:
                graph.relation(surface_id("zh", traditional), prosody, "has-prosodic-pattern", "cc-cedict")
        for index, gloss in enumerate(payload.get("definitions", [])[:3], start=1):
            gloss = normalized(gloss)
            if gloss:
                sense = graph.entity(f"{entry}:sense:{index}", "sense", gloss)
                graph.relation(entry, sense, "has-sense", "cc-cedict")
    return graph.write()


def build_es() -> tuple[int, int, int]:
    graph = Graph("es", {"dictionary": dictionary_version("es")})
    for record, payload in dictionary_rows("es"):
        headword = normalized(record.get("headword"))
        if not headword:
            continue
        entry = graph.entity(dictionary_entry_id("es", {"headword": headword, "pos": record.get("pos"), "data": payload}), "dictionary-entry", headword)
        surface = graph.entity(surface_id("es", headword), "surface", headword)
        graph.relation(surface, entry, "realizes", "freedict")
        pos = normalized(record.get("pos")).lower()
        if pos:
            pos_entity = graph.entity(f"es:pos:{pos}", "grammar-pattern", pos)
            graph.relation(entry, pos_entity, "has-pos", "freedict")
        for index, gloss in enumerate(payload.get("glosses", [])[:3], start=1):
            gloss = normalized(gloss)
            if gloss:
                sense = graph.entity(f"{entry}:sense:{index}", "sense", gloss)
                graph.relation(entry, sense, "has-sense", "freedict")
    return graph.write()


# Wiktionary-style part-of-speech labels used by the kaikki.org payload;
# CHAR/X and unknown markers are not grammatical POS.
CU_POS_TAGS = frozenset({"NOUN", "VERB", "ADJ", "ADV", "PRON", "PROPN", "NUM", "ADP", "CCONJ", "DET", "PART", "INTJ"})


def build_cu() -> tuple[int, int, int]:
    graph = Graph("cu", {"dictionary": dictionary_version("cu")})
    for record, payload in dictionary_rows("cu"):
        headword = normalized(record.get("headword"))
        lemma = normalized(payload.get("lemma"))
        if not headword or not lemma:
            continue
        entry = graph.entity(dictionary_entry_id("cu", payload), "dictionary-entry", lemma)
        lemma_surface = graph.entity(surface_id("cu", lemma), "surface", lemma)
        form_surface = graph.entity(surface_id("cu", headword), "surface", headword)
        graph.relation(lemma_surface, entry, "realizes", "kaikki-wiktionary")
        if headword != lemma:
            graph.relation(form_surface, lemma_surface, "inflection-of", "kaikki-wiktionary")
        pos_tags = [str(tag) for tag in (payload.get("partOfSpeech") or []) if str(tag) in CU_POS_TAGS]
        for tag in pos_tags[:3]:
            pos_entity = graph.entity(f"cu:pos:{tag}", "grammar-pattern", tag)
            graph.relation(entry, pos_entity, "has-pos", "kaikki-wiktionary")
        reading = normalized(payload.get("reading"))
        if reading:
            pronunciation = graph.entity(f"cu:pron:{hashlib.sha256(reading.encode('utf-8')).hexdigest()}", "pronunciation", reading)
            graph.relation(form_surface, pronunciation, "has-pronunciation", "kaikki-wiktionary")
        for index, gloss in enumerate(payload.get("definitions", [])[:3], start=1):
            gloss = normalized(gloss)
            if gloss:
                sense = graph.entity(f"{entry}:sense:{index}", "sense", gloss)
                graph.relation(entry, sense, "has-sense", "kaikki-wiktionary")
    return graph.write()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", nargs="+", choices=("ja", "ru", "de", "zh", "es", "cu"), default=("ja", "ru", "de", "zh", "es", "cu"))
    args = parser.parse_args()
    builders = {"ja": build_ja, "ru": build_ru, "de": build_de, "zh": build_zh, "es": build_es, "cu": build_cu}
    for language in args.languages:
        builders[language]()


if __name__ == "__main__":
    main()
