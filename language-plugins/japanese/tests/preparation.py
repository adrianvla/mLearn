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
            return json.loads(db.execute("SELECT value FROM resource_entries WHERE key=?", (key,)).fetchone()[0])
        assert {c["id"] for c in value("form/生物")} == {"jmdict:1379430", "jmdict:1379440"}
        assert {c["reading"] for c in value("form/生物")} == {"せいぶつ", "なまもの"}
        restricted = value("form/生き物")
        assert len(restricted) == 1 and restricted[0]["reading"] == "いきもの"
        assert restricted[0]["pos"] == ["noun (common) (futsuumeishi)"]
        assert value("entry/1379430")["targetId"] == "jmdict:1379430"
    second = root / "second.sqlite"
    recipe.prepare_index(source, second)
    assert recipe.digest(first) == recipe.digest(second), "Identical pin/recipe must rebuild byte-identically"
    # A gloss edit changes display content, never the entry's learner identity.
    reordered = XML.replace(
        "<sense><stagk>生物</stagk><stagr>せいぶつ</stagr><pos>noun (common) (futsuumeishi)</pos><gloss>living thing</gloss></sense>",
        "<sense><stagk>生物</stagk><stagr>せいぶつ</stagr><pos>noun (common) (futsuumeishi)</pos><gloss>organism</gloss></sense>",
    )
    with gzip.open(source, "wb") as output:
        output.write(reordered.encode())
    recipe.prepare_index(source, second)
    with sqlite3.connect(second) as db:
        entry = json.loads(db.execute("SELECT value FROM resource_entries WHERE key='entry/1379430'").fetchone()[0])
        assert entry["targetId"] == "jmdict:1379430"
        assert "organism" in entry["definition"]
print("JAPANESE_PREPARATION_PROOF restrictions/inherited-POS/reproducibility/entry-identity PASS")
