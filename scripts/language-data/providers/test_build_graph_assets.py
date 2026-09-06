import importlib.util
import json
import hashlib
import os
import sqlite3
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).with_name("build-graph-assets.py")
ENTITY_KINDS = {"dictionary-entry", "lexeme", "surface", "sense", "pronunciation", "character", "morpheme", "grammar-pattern"}
RELATION_TYPES = {"inflection-of", "lemma-of", "realizes", "has-sense", "has-pronunciation", "has-gender", "has-prosodic-pattern", "has-character", "has-reading", "has-morpheme", "orthographic-variant-of", "component-of", "derived-from", "semantically-related", "morphologically-related", "analyzes", "analysis-member"}


def _load_builder(root: Path):
    previous = os.environ.get("MLEARN_ROOT_OF_APP")
    os.environ["MLEARN_ROOT_OF_APP"] = str(root)
    try:
        spec = importlib.util.spec_from_file_location("build_graph_assets_test", SCRIPT)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop("MLEARN_ROOT_OF_APP", None)
        else:
            os.environ["MLEARN_ROOT_OF_APP"] = previous


def _write_dictionary(root: Path, language: str, columns: str, rows: list[tuple[Any, ...]]):
    output = root / "dictionaries" / language / "en"
    output.mkdir(parents=True)
    connection = sqlite3.connect(output / "dictionary.db")
    connection.execute(f"CREATE TABLE entries ({columns})")
    placeholders = ",".join("?" for _ in rows[0])
    connection.executemany(f"INSERT INTO entries VALUES ({placeholders})", rows)
    connection.commit()
    connection.close()


def _payload(value: dict[str, Any]) -> bytes:
    return zlib.compress(json.dumps(value, separators=(",", ":")).encode("utf-8"))


class BuildGraphAssetsTest(unittest.TestCase):
    def test_supported_dictionary_shapes_conform_to_graph_schema(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            _write_dictionary(root, "zh-Hans", "headword TEXT, reading TEXT, data BLOB", [
                ("simplified", "pin-yin", _payload({"word": "simplified", "simplified": "simplified", "traditional": "traditional", "pinyin": {"value": "pīnyīn", "numeric": "pin1-yin1"}, "definitions": ["meaning"]})),
                ("traditional", "pin-yin", _payload({"word": "simplified", "simplified": "simplified", "traditional": "traditional", "pinyin": {"value": "pin-yin", "numeric": "pin1-yin1"}, "definitions": ["meaning"]})),
            ])
            _write_dictionary(root, "es", "id INTEGER, headword TEXT, headword_lower TEXT, pos TEXT, data BLOB", [
                (1, "lemma", "lemma", "noun", _payload({"pos": "noun", "glosses": ["meaning"], "notes": [], "examples": []})),
            ])
            _write_dictionary(root, "cu", "headword TEXT, reading TEXT, data BLOB", [
                ("form", "reading", _payload({"word": "form", "lemma": "lemma", "reading": "reading", "definitions": ["meaning"], "partOfSpeech": [], "common": False, "score": 0})),
            ])
            builder = _load_builder(root)
            for language, build in (("zh", builder.build_zh), ("es", builder.build_es), ("cu", builder.build_cu)):
                self.assertGreater(build()[0], 0)
                graph = json.loads((root / "languages" / f"{language}.graph.json").read_text(encoding="utf-8"))
                ids = {entity["id"] for entity in graph["entities"]}
                self.assertEqual(graph["schemaVersion"], 1)
    def test_zh_graph_retains_pinyin_reading_and_tone_prosody(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            _write_dictionary(root, "zh-Hans", "headword TEXT, reading TEXT, data BLOB", [
                ("simplified", "pin-yin", _payload({"word": "simplified", "simplified": "simplified", "traditional": "traditional", "pinyin": {"value": "pīnyīn", "numeric": "pin1-yin1"}, "definitions": ["meaning"]})),
                ("traditional", "pin-yin", _payload({"word": "simplified", "simplified": "simplified", "traditional": "traditional", "pinyin": {"value": "pīnyīn", "numeric": "pin1-yin1"}, "definitions": ["meaning"]})),
            ])
            builder = _load_builder(root)
            builder.build_zh()
            graph = json.loads((root / "languages" / "zh.graph.json").read_text(encoding="utf-8"))
            entities = {entity["id"]: entity for entity in graph["entities"]}
            relations = graph["relations"]

            pronunciations = [entity for entity in entities.values() if entity["kind"] == "pronunciation"]
            self.assertEqual(len(pronunciations), 1)
            self.assertEqual(pronunciations[0]["label"], "pīnyīn")

            reading_relations = [relation for relation in relations if relation["type"] == "has-reading"]
            self.assertEqual(len(reading_relations), 2)
            self.assertTrue(all(relation["to"] == pronunciations[0]["id"] and relation["provenance"] == "cc-cedict" for relation in reading_relations))

            prosody = [entity for entity in entities.values() if entity["kind"] == "grammar-pattern"]
            self.assertEqual([(entity["id"], entity["label"]) for entity in prosody], [("zh:prosody:11", "1-1")])
            prosody_relations = [relation for relation in relations if relation["type"] == "has-prosodic-pattern"]
            self.assertEqual(len(prosody_relations), 2)
            self.assertTrue(all(relation["to"] == "zh:prosody:11" for relation in prosody_relations))

    def test_ja_graph_retains_ent_seq_readings_and_pitch(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            jitendex = root / "dictionaries" / "jitendex-yomitan"
            jitendex.mkdir(parents=True)
            (jitendex / "term_meta_bank_1.json").write_text(json.dumps([
                ["赤い", "pitch", {"reading": "あかい", "pitches": [{"position": 1}, {"position": 2}]}],
            ]), encoding="utf-8")
            (jitendex / "term_bank_1.json").write_text(json.dumps([
                ["赤い", "あかい", "", "", 0, [{"type": "structured-content", "content": [{"data": {"content": "glossary"}, "content": [{"tag": "li", "content": "red"}]}]}], 1001],
            ]), encoding="utf-8")
            builder = _load_builder(root)
            builder.build_ja()
            graph = json.loads((root / "languages" / "ja.graph.json").read_text(encoding="utf-8"))
            entities = {entity["id"]: entity for entity in graph["entities"]}
            relations = graph["relations"]

            entry = entities["ja:entry:1001"]
            self.assertEqual(entry["kind"], "dictionary-entry")
            self.assertEqual(entry["label"], "赤い")

            reading_relations = [relation for relation in relations if relation["type"] == "has-reading"]
            self.assertEqual([(relation["from"], relation["to"], relation["provenance"]) for relation in reading_relations],
                             [("ja:entry:1001", "ja:pron:あかい", "jitendex")])

            prosody_relations = [relation for relation in relations if relation["type"] == "has-prosodic-pattern"]
            self.assertEqual(sorted((relation["to"], relation["provenance"]) for relation in prosody_relations),
                             [("ja:prosody:p1", "kanjium-pitch"), ("ja:prosody:p2", "kanjium-pitch")])

            senses = [relation for relation in relations if relation["type"] == "has-sense"]
            self.assertEqual([relation["to"] for relation in senses], ["ja:sense:1001:1"])
    def test_ja_marks_name_domain_entries_and_keeps_shared_surfaces_common(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            jitendex = root / "dictionaries" / "jitendex-yomitan"
            jitendex.mkdir(parents=True)
            person = {"tag": "span", "title": "full name of a particular person", "data": {"code": "person"}, "content": "person"}
            myth = {"tag": "span", "title": "Greek mythology", "data": {"code": "grmyth"}, "content": "grmyth"}
            fem = {"tag": "span", "title": "female term or language", "data": {"code": "fem"}, "content": "fem"}

            def row(term, reading, sequence, *badges, gloss="meaning"):
                content = list(badges) + [{"data": {"content": "glossary"}, "content": [{"tag": "li", "content": gloss}]}]
                return [term, reading, "", "", 0, [{"type": "structured-content", "content": content}], sequence]

            (jitendex / "term_bank_1.json").write_text(json.dumps([
                row("ナポレオン", "ナポレオン", 200001, person, gloss="Napoleon"),
                row("レア", "レア", 200002, myth, gloss="Rhea"),
                row("レア", "レア", 200003, gloss="rare"),
                row("わよ", "わよ", 200004, fem, gloss="sentence-ending particle"),
            ]), encoding="utf-8")
            builder = _load_builder(root)
            builder.build_ja()
            graph = json.loads((root / "languages" / "ja.graph.json").read_text(encoding="utf-8"))
            entities = {entity["id"]: entity for entity in graph["entities"]}

            self.assertEqual(entities["ja:entry:200001"]["domain"], "names")
            self.assertEqual(entities[builder.surface_id("ja", "ナポレオン")]["domain"], "names")
            self.assertEqual(entities["ja:sense:200001:1"]["domain"], "names")

            self.assertEqual(entities["ja:entry:200002"]["domain"], "names")
            self.assertNotIn("domain", entities["ja:entry:200003"])
            self.assertNotIn("domain", entities["ja:sense:200003:1"])
            self.assertNotIn("domain", entities[builder.surface_id("ja", "レア")])

            self.assertNotIn("domain", entities["ja:entry:200004"])
            self.assertNotIn("domain", entities[builder.surface_id("ja", "わよ")])

    def test_ja_name_domain_covers_any_name_row_of_a_sequence(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            jitendex = root / "dictionaries" / "jitendex-yomitan"
            jitendex.mkdir(parents=True)
            person = {"tag": "span", "title": "full name of a particular person", "data": {"code": "person"}, "content": "person"}
            (jitendex / "term_bank_1.json").write_text(json.dumps([
                ["孔子", "こうし", "", "", 0, [{"type": "structured-content", "content": [person, {"data": {"content": "glossary"}, "content": [{"tag": "li", "content": "Confucius"}]}]}], 200005],
                ["孔子", "くじ", "", "", 0, [{"type": "structured-content", "content": [{"data": {"content": "glossary"}, "content": [{"tag": "li", "content": "Confucius"}]}]}], 200005],
            ]), encoding="utf-8")
            builder = _load_builder(root)
            builder.build_ja()
            graph = json.loads((root / "languages" / "ja.graph.json").read_text(encoding="utf-8"))
            entities = {entity["id"]: entity for entity in graph["entities"]}

            self.assertEqual(entities["ja:entry:200005"]["domain"], "names")
            self.assertEqual(entities[builder.surface_id("ja", "孔子")]["domain"], "names")
            self.assertEqual(entities["ja:sense:200005:1"]["domain"], "names")


    def test_ru_graph_retains_gender_stressed_reading_and_inflected_forms(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir) / "root-of-app")
            graph = builder.Graph("ru", {"provider": "test"})
            builder.add_russian_record(graph, "t:0", "молоко", "молоко́", "n", ["молока", "молоком", "молоко"])

            entities = graph.entities
            self.assertEqual(entities["ru:entry:t:0"]["label"], "молоко")
            self.assertEqual(entities["ru:gender:n"]["kind"], "grammar-pattern")
            pronunciation = entities["ru:pron:молоко́"]
            self.assertEqual(pronunciation["kind"], "pronunciation")
            self.assertIn("\u0301", pronunciation["label"])
            self.assertEqual(pronunciation["label"], "молоко́")

            relations = graph.relations
            self.assertIn(("ru:entry:t:0", "ru:gender:n", "has-gender", "openrussian"), relations)
            self.assertIn(("ru:entry:t:0", "ru:pron:молоко́", "has-reading", "openrussian"), relations)
            self.assertIn(("ru:surface:" + hashlib.sha256("молока".encode("utf-8")).hexdigest(),
                           "ru:surface:" + hashlib.sha256("молоко".encode("utf-8")).hexdigest(),
                           "inflection-of", "openrussian-forms"), relations)
            self.assertNotIn(("ru:entry:t:0", hashlib.sha256("молоко".encode("utf-8")).hexdigest(), "inflection-of", "openrussian-forms"), relations)

    def test_entry_sibling_surfaces_carry_support_not_identity(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir) / "root-of-app")
            graph = builder.Graph("ja", {"dictionary": "test"})
            entry = graph.entity("ja:entry:1381600", "dictionary-entry", "増える")
            fueru = graph.entity(builder.surface_id("ja", "増える"), "surface", "増える")
            ueru = graph.entity(builder.surface_id("ja", "殖える"), "surface", "殖える")
            graph.relation(fueru, entry, "realizes", "jitendex")
            graph.relation(ueru, entry, "realizes", "jitendex")

            added = graph.add_entry_sibling_support()

            self.assertEqual(added, 2)
            relations = {(relation["from"], relation["to"], relation["type"], relation["provenance"])
                         for relation in graph.relations.values()}
            self.assertIn((fueru, ueru, "semantically-related", "jitendex"), relations)
            self.assertIn((ueru, fueru, "semantically-related", "jitendex"), relations)
            self.assertNotIn((ueru, fueru, "inflection-of", "jitendex"), relations)
            self.assertNotIn((ueru, fueru, "lemma-of", "jitendex"), relations)

    def test_single_surface_entries_get_no_sibling_support(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir) / "root-of-app")
            graph = builder.Graph("ja", {"dictionary": "test"})
            entry = graph.entity("ja:entry:1", "dictionary-entry", "川")
            surface = graph.entity(builder.surface_id("ja", "川"), "surface", "川")
            graph.relation(surface, entry, "realizes", "jitendex")

            added = graph.add_entry_sibling_support()

            self.assertEqual(added, 0)
            self.assertEqual(len(graph.relations), 1)

    def test_compound_component_edges_require_builder_derivation_and_unique_parses(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            languages = root / "languages"
            languages.mkdir(parents=True)
            base_strategy = {
                "locale": "de",
                "linkingElements": ["", "es", "en", "er", "n", "s"],
                "inflectionSuffixes": ["ern", "en", "er", "es", "e", "n", "s"],
                "minPartLength": 3,
            }

            def write_package(include_derivation: bool) -> None:
                payload = dict(base_strategy)
                if include_derivation:
                    payload["derivation"] = "builder"
                (languages / "de.json").write_text(json.dumps({"compoundSplitting": payload}), encoding="utf-8")

            labels = ["Papa", "Hand", "Schuh", "Handschuh", "Papashandschuhe", "Arbeitszimmer", "Arbeit", "Zimmer", "Arbe", "itszimmer"]

            def build_graph():
                graph = builder.Graph("de", {"provider": "fixture"})
                for label in labels:
                    graph.entity(builder.surface_id("de", label), "surface", label)
                return graph

            builder = _load_builder(root)

            # Gate closed without explicit builder authorization.
            write_package(include_derivation=False)
            self.assertIsNone(builder.compound_strategy("de"))

            # Authorized: unique attested parses emit as component-of edges.
            write_package(include_derivation=True)
            strategy = builder.compound_strategy("de")
            self.assertIsNotNone(strategy)
            graph = build_graph()
            emitted = builder.emit_compound_component_edges(graph, strategy, "compound-splitter")
            self.assertEqual(emitted, 5)
            sid = lambda label: builder.surface_id("de", label)
            component_edges = {
                (relation["from"], relation["to"])
                for relation in graph.relations.values()
                if relation["type"] == "component-of" and relation["provenance"] == "compound-splitter"
            }
            self.assertEqual(component_edges, {
                (sid("Papa"), sid("Papashandschuhe")),
                (sid("Hand"), sid("Papashandschuhe")),
                (sid("Schuh"), sid("Papashandschuhe")),
                (sid("Hand"), sid("Handschuh")),
                (sid("Schuh"), sid("Handschuh")),
            })
            # Ambiguous Arbeitszimmer (Arbe+itszimmer vs Arbeit+Zimmer): no invented facts.
            self.assertFalse(any(relation["to"] == sid("Arbeitszimmer") for relation in graph.relations.values()))


if __name__ == "__main__":
    unittest.main()
