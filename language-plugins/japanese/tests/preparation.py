"""Bounded offline recipe regression: restrictions, inherited POS, stable IDs.

The small records use public JMdict vocabulary; structure is deliberately
authored to exercise every restriction without depending on a network snapshot.
"""
import gzip
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("prepare_japanese", ROOT / "tools/prepare-japanese.py")
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)

XML = """<?xml version="1.0"?>
<JMdict>
<entry><ent_seq>1379430</ent_seq><k_ele><keb>生物</keb></k_ele>
<k_ele><keb>生き物</keb></k_ele>
<r_ele><reb>せいぶつ</reb><re_restr>生物</re_restr></r_ele>
<r_ele><reb>いきもの</reb><re_restr>生き物</re_restr></r_ele>
<sense><stagk>生物</stagk><stagr>せいぶつ</stagr><pos>noun (common) (futsuumeishi)</pos><gloss>living thing</gloss></sense>
<sense><stagk>生き物</stagk><stagr>いきもの</stagr><gloss>creature</gloss></sense>
</entry>
<entry><ent_seq>1379440</ent_seq><k_ele><keb>生物</keb></k_ele>
<r_ele><reb>なまもの</reb></r_ele>
<sense><pos>noun (common) (futsuumeishi)</pos><gloss>raw food</gloss></sense>
</entry></JMdict>"""

with tempfile.TemporaryDirectory(prefix="japanese-preparation-") as temporary:
    root = Path(temporary)
    source = root / "fixture.gz"
    with gzip.open(source, "wb") as output:
        output.write(XML.encode())
    first = root / "first.sqlite"
    recipe.prepare_index(source, first)
    with sqlite3.connect(first) as db:
        def value(key):
            data = db.execute("SELECT value FROM resource_entries WHERE key=?", (key,)).fetchone()[0]
            return json.loads(data if key == "metadata" else zlib.decompress(data))
        assert {c["id"] for c in value("form/生物")} == {"jmdict:1379430", "jmdict:1379440"}
        assert {c["reading"] for c in value("form/生物")} == {"せいぶつ", "なまもの"}
        restricted = value("form/生き物")
        assert len(restricted) == 1 and restricted[0]["reading"] == "いきもの"
        assert restricted[0]["pos"] == ["noun (common) (futsuumeishi)"]
        assert value("entry/1379430")["targetId"] == "jmdict:1379430"
        assert value("metadata")["schema"] == "org.mlearn.japanese.lexicon"
        assert value("metadata")["linguisticSchema"] == {"id": "org.mlearn.japanese.linguistic", "version": 1}
        variants = {(v["written"], v["reading"]) for v in value("entry/1379430")["variants"]}
        assert ("生物", "せいぶつ") in variants and ("生き物", "いきもの") in variants
        assert ("生物", "いきもの") not in variants and ("生き物", "せいぶつ") not in variants
    second = root / "second.sqlite"
    recipe.prepare_index(source, second)
    assert recipe.digest(first) == recipe.digest(second), "Identical pin/recipe must rebuild byte-identically"
    with sqlite3.connect(root / "linguistic.sqlite") as db:
        db.execute("CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB NOT NULL) WITHOUT ROWID")
        recipe.prepare_enrichment(db, {"pitch": [
            ["生物", "せいぶつ", [{"position": 0, "tags": ["n"]}]],
            ["生物", "セイブツ", [{"position": 2, "tags": ["n"]}]],
            ["生き物", "いきもの", [{"position": 0, "tags": ["n"]}]],
        ], "levels": [["生き物", "いきもの", 3]]})
        def linguistic(written, reading):
            data = db.execute("SELECT value FROM resource_entries WHERE key=?", (recipe.reading_key(written, reading),)).fetchone()[0]
            return json.loads(zlib.decompress(data))
        assert {p["drop"] for p in linguistic("生物", "せいぶつ")["accent"]} == {0, 2}
        assert linguistic("生物", "せいぶつ")["jlpt"] == []
        assert linguistic("生き物", "いきもの")["jlpt"] == [3]
        assert all(set(accent) == {"drop", "pos"} for accent in linguistic("生物", "せいぶつ")["accent"])
        assert db.execute("SELECT value FROM resource_entries WHERE key=?", (recipe.reading_key("生物", "いきもの"),)).fetchone() is None
    try:
        recipe.stored({"value": "x" * 65536})
        raise AssertionError("The codec must bound decompressed values, not just compressed bytes")
    except RuntimeError:
        pass
    print("JAPANESE_ENRICHMENT_PREPARATION_PROOF variants/reading-restrictions/codec PASS")
    # A gloss edit changes display content, never the entry's learner identity.
    reordered = XML.replace(
        "<sense><stagk>生物</stagk><stagr>せいぶつ</stagr><pos>noun (common) (futsuumeishi)</pos><gloss>living thing</gloss></sense>",
        "<sense><stagk>生物</stagk><stagr>せいぶつ</stagr><pos>noun (common) (futsuumeishi)</pos><gloss>organism</gloss></sense>",
    )
    with gzip.open(source, "wb") as output:
        output.write(reordered.encode())
    recipe.prepare_index(source, second)
    with sqlite3.connect(second) as db:
        entry = json.loads(zlib.decompress(db.execute("SELECT value FROM resource_entries WHERE key='entry/1379430'").fetchone()[0]))
        assert entry["targetId"] == "jmdict:1379430"
        assert "organism" in entry["definition"]
print("JAPANESE_PREPARATION_PROOF restrictions/inherited-POS/reproducibility/entry-identity PASS")
