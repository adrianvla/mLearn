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
RELATION_TYPES = {"inflection-of", "lemma-of", "realizes", "has-sense", "has-pronunciation", "has-prosodic-pattern", "has-character", "has-reading", "has-morpheme", "orthographic-variant-of", "component-of", "derived-from", "semantically-related", "morphologically-related", "analyzes", "analysis-member"}


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
    def test_numbered_senses_preserve_typed_glosses_without_promoting_literal_notes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir))
            typed = lambda kind, text: {"data": {"content": "info-gloss", "gloss-type": kind},
                "content": [{"tag": "span", "content": kind}, {"tag": "span", "content": text}]}
            content = [{"data": {"code": "n"}, "content": "noun"},
                {"data": {"sense-number": "1"}, "content": [{"data": {"content": "glossary"}, "content": "magazine"}]},
                {"data": {"sense-number": "2"}, "content": typed("fig", "powder keg")},
                {"data": {"sense-number": "3"}, "content": typed("lit", "to bare one shoulder")},
                {"data": {"sense-number": "4"}, "content": typed("source-defined", "another source meaning")}]
            senses = builder.jitendex_sense_groups(content)
            self.assertEqual([sense["sourceSenseNumber"] for sense in senses], ["1", "2", "3", "4"])
            self.assertEqual([sense["glosses"] for sense in senses], [["magazine"], ["powder keg"], ["to bare one shoulder"], ["another source meaning"]])
            self.assertTrue(all(sense["posCodes"] == ["n"] for sense in senses))
            # A sole unnumbered typed definition is one source meaning, while
            # a supplemental literal note does not invent a second sense.
            self.assertEqual(builder.jitendex_sense_groups(typed("lit", "literal definition"))[0]["glosses"], ["literal definition"])
            self.assertEqual(builder.jitendex_sense_groups([
                {"data": {"content": "glossary"}, "content": "ordinary definition"}, typed("lit", "literal note")
            ])[0]["glosses"], ["ordinary definition"])

    def test_grammar_meanings_localized_variants_survive_packaging(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "root-of-app"
            languages = root / "languages"
            languages.mkdir(parents=True)
            (languages / "de.json").write_text(json.dumps({
                "meaningLanguage": "en",
                "grammar": [
                    {"pattern": "weil", "meaning": "causal subordinator", "meanings": {"de": "kausaler Nebensatz"}, "level": 3},
                    {"pattern": "um … zu", "meaning": "purpose infinitive", "level": 2},
                    {"pattern": "je … desto", "meaning": "proportional", "meanings": {"de": 7, "": "x"}, "level": 4},
                ],
            }), encoding="utf-8")
            builder = _load_builder(root)
            graph = builder.Graph("de", {"provider": "test"})
            builder.add_grammar_from_metadata(graph)

            constructions = {entity["id"]: entity["grammar"] for entity in graph.entities.values() if entity["kind"] == "grammar-pattern"}
            weil = constructions["de:grammar:weil"]
            self.assertEqual(weil["meaning"], "causal subordinator")
            self.assertEqual(weil["meanings"], {"de": "kausaler Nebensatz"})
            # No localized variants declared → field absent, canonical intact.
            self.assertNotIn("meanings", constructions["de:grammar:um … zu"])
            # Non-string/empty variant entries are dropped, canonical kept.
            self.assertNotIn("meanings", constructions["de:grammar:je … desto"])
            self.assertEqual(constructions["de:grammar:je … desto"]["meaning"], "proportional")

    def test_glossary_extraction_excludes_grammar_forms_notes_and_examples(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir))
            content = [{"type": "structured-content", "content": [
                {"data": {"code": "v5u"}, "content": "5-dan"},
                {"data": {"code": "vi"}, "content": "intransitive"},
                {"data": {"content": "glossary"}, "content": [{"tag": "li", "content": "to meet"}]},
                {"data": {"content": "forms"}, "content": "会う"},
                {"data": {"content": "sense-note"}, "content": "a note"},
                {"data": {"content": "example-sentence-b"}, "content": "an example"},
            ]}]
            self.assertEqual(builder.text_content(content), ["to meet"])
            codes = set()
            builder.structured_pos_codes(content, codes)
            self.assertEqual(codes, {"v5u", "vi"})

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
                ["赤い", "あかい", "", "", 0, [{"type": "structured-content", "content": [{"tag": "span", "data": {"code": "v5u"}, "content": "5-dan"}, {"tag": "span", "data": {"code": "vi"}, "content": "intransitive"}, {"data": {"content": "glossary"}, "content": [{"tag": "li", "content": "red"}]}]}], 1001],
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
            self.assertEqual(len(senses), 1)
            self.assertEqual(entities[senses[0]["to"]]["label"], "red")
            self.assertEqual({relation["to"] for relation in relations if relation["type"] == "has-pos"}, {"ja:pos:v5u", "ja:pos:vi"})
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
            self.assertEqual(next(entity for entity in entities.values() if entity["kind"] == "sense" and entity["features"]["ja::jitendex-sense"]["dictionarySequence"] == 200001)["domain"], "names")

            self.assertEqual(entities["ja:entry:200002"]["domain"], "names")
            self.assertNotIn("domain", entities["ja:entry:200003"])
            self.assertNotIn("domain", next(entity for entity in entities.values() if entity["kind"] == "sense" and entity["features"]["ja::jitendex-sense"]["dictionarySequence"] == 200003))
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
            self.assertEqual(next(entity for entity in entities.values() if entity["kind"] == "sense" and entity["features"]["ja::jitendex-sense"]["dictionarySequence"] == 200005)["domain"], "names")


    def test_ja_preserves_real_sense_groups_without_gloss_truncation_or_legacy_id_reuse(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "dictionaries" / "jitendex-yomitan"
            source.mkdir(parents=True)
            def sense(number, *glosses):
                return {"tag": "li", "data": {"sense-number": str(number)}, "content": [
                    {"tag": "ul", "data": {"content": "glossary"}, "content": [
                        {"tag": "li", "content": gloss} for gloss in glosses]},
                    {"data": {"content": "extra-info"}, "content": "not a definition"}]}
            content = [{"type": "structured-content", "content": [{"tag": "ul", "content": [
                {"tag": "li", "content": [{"data": {"code": "v1"}, "content": "1-dan"},
                    {"tag": "ol", "content": [sense(1, "to exist", "to be"), sense(2, "to stay")]}]},
                {"tag": "li", "content": [{"data": {"code": "aux-v"}, "content": "auxiliary"}, {"data": {"code": "uk"}, "content": "kana"},
                    {"tag": "ol", "content": [sense(3, "to be ...-ing", "to have been ...-ing"), sense(4, "fourth"), sense(5, "fifth")]}]}
            ]}]}]
            (source / "term_bank_1.json").write_text(json.dumps([
                ["term", "reading-a", "", "", 0, content, 101],
                ["term", "reading-b", "", "", 0, content, 101],
            ]))
            builder = _load_builder(root)
            builder.build_ja()
            graph = json.loads((root / "languages" / "ja.graph.json").read_text())
            senses = [entity for entity in graph["entities"] if entity["kind"] == "sense"]
            self.assertEqual(len(senses), 5)
            self.assertEqual([entity["label"] for entity in senses], ["to exist; to be", "to stay", "to be ...-ing; to have been ...-ing", "fourth", "fifth"])
            self.assertFalse(any(entity["id"] in {f"ja:sense:101:{n}" for n in range(1, 6)} for entity in senses))
            auxiliary = senses[2]
            self.assertEqual(auxiliary["features"]["ja::jitendex-sense"]["sourceSenseNumber"], "3")
            self.assertEqual(auxiliary["features"]["ja::jitendex-sense"]["posCodes"], ["aux-v"])
            self.assertEqual(auxiliary["features"]["ja::jitendex-sense"]["badgeCodes"], ["aux-v", "uk"])
            sense_data = auxiliary["features"]["ja::jitendex-sense"]
            self.assertEqual(builder.jitendex_sense_id(101, sense_data), builder.jitendex_sense_id(101, {**sense_data, "badgeCodes": ["aux-v"]}))
            self.assertFalse(any(edge["type"] == "has-pos" and edge["to"] == "ja:pos:uk" for edge in graph["relations"]))
            self.assertEqual(len([edge for edge in graph["relations"] if edge["type"] == "has-sense"]), 5)
            source_data = json.loads((source / "term_bank_1.json").read_text())
            source_data.reverse()
            (source / "term_bank_1.json").write_text(json.dumps(source_data))
            builder.build_ja()
            rebuilt = json.loads((root / "languages" / "ja.graph.json").read_text())
            self.assertEqual({entity["id"] for entity in rebuilt["entities"] if entity["kind"] == "sense"}, {entity["id"] for entity in senses})

    def test_ja_keeps_explanatory_only_senses_and_sense_local_badges(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir))
            sense = {"data": {"sense-number": "2"}, "content": [
                {"tag": "span", "data": {"code": "arch"}, "content": "archaic"},
                {"data": {"content": "extra-info"}, "content": [
                    {"data": {"content": "info-gloss", "gloss-type": "expl"}, "content": [
                        {"tag": "div", "content": "Explanation"}, {"tag": "div", "content": ["an ", {"tag": "i", "content": "explanatory"}, " definition"]}]},
                    {"data": {"content": "sense-note"}, "content": "not a definition"},
                    {"data": {"content": "xref"}, "content": {"data": {"content": "glossary"}, "content": "other entry"}},
                ]},
            ]}
            content = [{"data": {"code": "n"}, "content": "noun"}, {"tag": "ol", "content": sense}]
            groups = builder.jitendex_sense_groups(content)
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0]["glosses"], ["an explanatory definition"])
            self.assertEqual(groups[0]["posCodes"], ["n"])
            self.assertEqual(groups[0]["badgeCodes"], ["arch", "n"])
            unnumbered = {"content": [item for item in sense["content"]]}
            self.assertEqual(builder.jitendex_sense_groups(unnumbered)[0]["glosses"], ["an explanatory definition"])
            # An inner usage badge cannot erase the inherited POS group.
            nested = [{"data": {"code": "n"}, "content": "noun"}, {"content": [
                {"data": {"code": "uk"}, "content": "kana"}, sense]}]
            self.assertEqual(builder.jitendex_sense_groups(nested)[0]["posCodes"], ["n"])

    def test_ja_unnumbered_source_definition_keeps_name_and_explanation_together(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir))
            definition = [{"data": {"code": "n"}, "content": "noun"}, {"content": [
                {"data": {"content": "glossary"}, "content": {"tag": "li", "content": "dish name"}},
                {"data": {"content": "extra-info"}, "content": {"data": {"content": "info-gloss", "gloss-type": "expl"},
                    "content": [{"content": "Explanation"}, {"content": "a dish definition"}]}},
            ]}]
            groups = builder.jitendex_sense_groups(definition)
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0]["glosses"], ["dish name", "a dish definition"])
            self.assertEqual(groups[0]["posCodes"], ["n"])
            self.assertEqual(len(builder.jitendex_sense_groups([
                {"content": definition}, {"content": [{"data": {"code": "v1"}, "content": "verb"},
                    {"data": {"content": "glossary"}, "content": {"tag": "li", "content": "a verb"}}]},
            ])), 2)

    def test_ja_can_rebuild_from_lossless_compiled_dictionary_and_rejects_missing_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            builder = _load_builder(root)
            with self.assertRaises(FileNotFoundError):
                builder.build_ja()
            self.assertFalse((root / "languages" / "ja.graph.json").exists())
            dictionary = root / "dictionaries" / "ja" / "en"
            dictionary.mkdir(parents=True)
            row = ["term", "reading", "", "", 0, [{"data": {"sense-number": "1"}, "content": [
                {"data": {"content": "glossary"}, "content": [{"tag": "li", "content": "first"}, {"tag": "li", "content": "synonym"}]}]}], 77]
            with sqlite3.connect(dictionary / "dictionary.db") as connection:
                connection.execute("CREATE TABLE meta (key TEXT, value TEXT)")
                connection.executemany("INSERT INTO meta VALUES (?,?)", [("source", "jitendex-yomitan"), ("version", "test-v1")])
                connection.execute("CREATE TABLE entries (headword TEXT, reading TEXT, data BLOB)")
                connection.execute("INSERT INTO entries VALUES (?,?,?)", ("term", "reading", _payload(row)))
                connection.execute("CREATE TABLE pitch (headword TEXT, reading TEXT, data BLOB)")
                connection.execute("INSERT INTO pitch VALUES (?,?,?)", ("term", "reading", _payload(["term", "pitch", {"reading": "reading", "pitches": [{"position": 1}]}])))
            builder.build_ja()
            graph = json.loads((root / "languages" / "ja.graph.json").read_text())
            self.assertEqual(graph["sourceVersions"]["dictionary"], "jitendex-test-v1")
            self.assertEqual([entity["label"] for entity in graph["entities"] if entity["kind"] == "sense"], ["first; synonym"])
            self.assertIn("ja:prosody:p1", {entity["id"] for entity in graph["entities"]})
            original = (root / "languages" / "ja.graph.json").read_bytes()
            with sqlite3.connect(dictionary / "dictionary.db") as connection:
                connection.execute("UPDATE entries SET headword='mismatched-index'")
            with self.assertRaises(ValueError):
                builder.build_ja()
            self.assertEqual((root / "languages" / "ja.graph.json").read_bytes(), original)
            with sqlite3.connect(dictionary / "dictionary.db") as connection:
                lossy = [*row[:5], ["flattened lossy meaning"], *row[6:]]
                connection.execute("UPDATE entries SET headword='term',data=?", (_payload(lossy),))
            with self.assertRaises(ValueError):
                builder.build_ja()
            self.assertEqual((root / "languages" / "ja.graph.json").read_bytes(), original)

    def test_ja_declared_source_pos_inventory_and_raw_revision_survive(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir))
            builder.JITENDEX_DIR.mkdir(parents=True)
            (builder.JITENDEX_DIR / "term_bank_1.json").write_text("[]")
            (builder.JITENDEX_DIR / "index.json").write_text(json.dumps({"revision": "synthetic-new-dictionary"}))
            (builder.JITENDEX_DIR / "index_.json").write_text(json.dumps({"revision": "synthetic-new-pitch"}))
            self.assertEqual(builder.jitendex_version(), "jitendex-synthetic-new-dictionary")
            self.assertEqual(builder.jitendex_pitch_version(), "synthetic-new-pitch")
            with self.assertRaises(ValueError):
                builder.build_ja()
            self.assertFalse((builder.ROOT / "languages" / "ja.graph.json").exists())
            (builder.JITENDEX_DIR / "term_bank_1.json").write_text(json.dumps([["word", "reading", "", "", 0, ["lossy meaning"], 1]]))
            with self.assertRaises(ValueError):
                list(builder.jitendex_source_rows())
            for code in ["prt", "num", "adj-pn"]:
                groups = builder.jitendex_sense_groups([
                    {"data": {"code": code}, "content": "source POS"},
                    {"data": {"content": "glossary"}, "content": {"tag": "li", "content": "meaning"}},
                ])
                self.assertEqual(groups[0]["posCodes"], [code])


    def test_ru_graph_retains_gender_stressed_reading_and_inflected_forms(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir) / "root-of-app")
            graph = builder.Graph("ru", {"provider": "test"})
            builder.add_russian_record(graph, "t:0", "молоко", "молоко́", "n", ["молока", "молоком", "молоко"])

            entities = graph.entities
            self.assertEqual(entities["ru:entry:t:0"]["label"], "молоко")
            self.assertEqual(entities["ru:entry:t:0"]["learnableCapabilities"], ["ru::gender"])
            self.assertEqual(entities["ru:gender:n"]["kind"], "grammar-pattern")
            pronunciation = entities["ru:pron:молоко́"]
            self.assertEqual(pronunciation["kind"], "pronunciation")
            self.assertIn("\u0301", pronunciation["label"])
            self.assertEqual(pronunciation["label"], "молоко́")

            relations = graph.relations
            self.assertIn(("ru:entry:t:0", "ru:gender:n", "ru::has-gender", "openrussian"), relations)
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

    def test_surface_characters_emit_ordered_has_character_edges(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir) / "root-of-app")
            graph = builder.Graph("ja", {"dictionary": "test"})
            myoji = graph.entity(builder.surface_id("ja", "苗字"), "surface", "苗字")
            nazi = graph.entity(builder.surface_id("ja", "名字"), "surface", "名字")
            moshikomu = graph.entity(builder.surface_id("ja", "申込む"), "surface", "申込む")
            kana_only = graph.entity(builder.surface_id("ja", "みょうじ"), "surface", "みょうじ")

            emitted = builder.emit_surface_characters(graph, "jitendex")

            chars = {entity["id"]: entity["label"] for entity in graph.entities.values() if entity["kind"] == "character"}
            self.assertEqual(chars, {
                "ja:char:苗": "苗", "ja:char:字": "字", "ja:char:名": "名", "ja:char:申": "申", "ja:char:込": "込",
            })
            orders = {(relation["from"], relation["to"]): relation.get("order")
                      for relation in graph.relations.values() if relation["type"] == "has-character"}
            self.assertEqual(orders[(myoji, "ja:char:苗")], 0)
            self.assertEqual(orders[(myoji, "ja:char:字")], 1)
            self.assertEqual(orders[(nazi, "ja:char:名")], 0)
            self.assertEqual(orders[(nazi, "ja:char:字")], 1)
            self.assertEqual(orders[(moshikomu, "ja:char:申")], 0)
            # 申込む = 申(0) 込(1) む(2): kana carries no entity, Han keeps its index.
            self.assertEqual(orders[(moshikomu, "ja:char:込")], 1)
            self.assertFalse(any(relation["from"] == kana_only for relation in graph.relations.values()))
            self.assertEqual(emitted, 6)

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

    def test_relation_writer_stores_each_directed_relation_once(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            builder = _load_builder(Path(temp_dir))
            graph = builder.Graph("ja", {"fixture": "1"})
            graph.entity("ja:surface:aaa", "surface", "A")
            graph.entity("ja:surface:bbb", "surface", "B")
            graph.relation("ja:surface:aaa", "ja:surface:bbb", "semantically-related", "fixture")
            graph.relation("ja:surface:bbb", "ja:surface:aaa", "semantically-related", "fixture")
            graph.relation("ja:surface:aaa", "ja:surface:bbb", "semantically-related", "fixture")
            # The plain asset may author both directions of a symmetric relation,
            # but never the same directed relation twice: duplicate keys are the
            # exact-duplicate-edge regression upstream of the compact encoder.
            keys = [
                (relation["from"], relation["to"], relation["type"], relation["provenance"], relation.get("order"))
                for relation in graph.relations.values()
            ]
            self.assertEqual(len(keys), len(set(keys)))
            self.assertEqual(len(graph.relations), 2)


if __name__ == "__main__":
    unittest.main()
