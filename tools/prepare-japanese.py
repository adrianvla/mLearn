"""Pinned JMdict English / Sudachi resources; offline by default, no learner data.

The XML is iterated, not loaded as a tree. Candidate accumulation stays in SQLite;
the largest retained record is one entry. ent_seq is the only learner target ID.
"""
from pathlib import Path
from contextlib import closing
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent.parent
PIN_PATH = ROOT / "language-plugins/japanese/data-pin.json"
PIN = json.loads(PIN_PATH.read_text())
ARCHIVE_PIN = json.loads((ROOT / "language-plugins/japanese/archive-pin.json").read_text())
ENRICHMENT_PIN_PATH = ROOT / "language-plugins/japanese/enrichment-pin.json"
ENRICHMENT_PIN = json.loads(ENRICHMENT_PIN_PATH.read_text())
CACHE = Path(os.environ.get("MLEARN_LANGUAGE_SOURCE_CACHE", ROOT / ".mlearn/package-sources"))
DESTINATION = Path(os.environ.get("MLEARN_JAPANESE_OUTPUT", ROOT / "target/japanese"))
MAX_VALUE = 65536
MAX_CANDIDATES = 128


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def encoded(value) -> bytes:
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    if len(data) > MAX_VALUE:
        raise RuntimeError("Lexical record exceeds the host's 64 KiB value contract")
    return data


def stored(value) -> bytes:
    # The existing package is already 256.6 MB against a 272.6 MB host ceiling.
    # Versioned, independently bounded values leave room for authentic enrichment.
    data = zlib.compress(encoded(value), 9)
    if len(data) > MAX_VALUE:
        raise RuntimeError("Compressed lexical record exceeds the resource value limit")
    return data


def reading_key(written: str, reading: str) -> str:
    reading = "".join(chr(ord(c) - 0x60) if "\u30a1" <= c <= "\u30f6" else c for c in reading)
    # Length-prefix the original UTF-8 form: no join ambiguity, hash collisions
    # or 64-byte hexadecimal overhead on each of 124,000 supplemental records.
    key = f"linguistic/{len(written.encode())}:{written}{reading}"
    if len(key.encode()) > 256:
        raise RuntimeError("Linguistic lookup key exceeds the host resource bound")
    return key


def enrichment_source():
    pin = ENRICHMENT_PIN["artifact"]
    path = ROOT / "language-plugins/japanese/assets" / pin["path"]
    if path.stat().st_size != pin["byteLength"] or digest(path) != pin["sha256"]:
        raise RuntimeError("Frozen Japanese enrichment source pin mismatch")
    with gzip.open(path, "rb") as stream:
        data = stream.read(16 * 1024 * 1024 + 1)
    if len(data) > 16 * 1024 * 1024:
        raise RuntimeError("Japanese enrichment source exceeds its expansion bound")
    value = json.loads(data)
    expected = {key: ENRICHMENT_PIN[key] for key in ("referenceRevision", "pitch", "levels")}
    if value["schemaVersion"] != 1 or value["sources"] != expected:
        raise RuntimeError("Incompatible Japanese enrichment source")
    return value


def prepare_enrichment(db, source) -> None:
    for written, reading, pitches in source["pitch"]:
        key = reading_key(written, reading)
        previous = db.execute("SELECT value FROM resource_entries WHERE key=?", (key,)).fetchone()
        value = json.loads(zlib.decompress(previous[0])) if previous else {"accent": [], "jlpt": []}
        # Kana normalization can join source rows. Merge every distinct variant;
        # replacing a stored row must never overwrite a pronunciation alternative.
        converted = []
        for pitch in pitches:
            if set(pitch) != {"position", "tags"}:
                raise RuntimeError("Unsupported imported pitch fields; update the explicit conversion")
            converted.append({"drop": pitch["position"], "pos": pitch["tags"]})
        variants = {json.dumps(accent, sort_keys=True): accent for accent in value["accent"] + converted}
        value["accent"] = [variants[identity] for identity in sorted(variants)]
        db.execute("INSERT OR REPLACE INTO resource_entries VALUES (?,?)", (key, stored(value)))
    for written, reading, level in source["levels"]:
        key = reading_key(written, reading)
        previous = db.execute("SELECT value FROM resource_entries WHERE key=?", (key,)).fetchone()
        value = json.loads(zlib.decompress(previous[0])) if previous else {"accent": [], "jlpt": []}
        value["jlpt"] = sorted(set(value["jlpt"] + [level]))
        db.execute("INSERT OR REPLACE INTO resource_entries VALUES (?,?)", (key, stored(value)))


def prepare_index(source: Path, destination: Path, enrichment=None) -> None:
    temporary = destination.with_suffix(".part")
    temporary.unlink(missing_ok=True)
    with closing(sqlite3.connect(temporary)) as db:
        db.execute("CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB NOT NULL) WITHOUT ROWID")
        db.execute("CREATE TABLE candidates(form TEXT NOT NULL, target TEXT NOT NULL, value BLOB NOT NULL)")
        entries = 0
        # A pinned, bounded gzip member; ElementTree handles only its internal DTD
        # entities and never resolves external resources. The source hash is checked
        # before parsing, so arbitrary XML is not a preparation input.
        with (gzip.open(source, "rb") if source.suffix == ".gz" else source.open("rb")) as xml:
            context = ET.iterparse(xml, events=("start", "end"))
            _, root = next(context)
            for event, entry in context:
                if event != "end" or entry.tag != "entry":
                    continue
                seq = entry.findtext("ent_seq")
                if not seq or not seq.isdecimal():
                    raise RuntimeError("JMdict entry has no stable ent_seq")
                target = "jmdict:" + seq
                forms = [k.findtext("keb") for k in entry.findall("k_ele")]
                readings = []
                for r in entry.findall("r_ele"):
                    reading = r.findtext("reb")
                    restricted = [v.text for v in r.findall("re_restr")]
                    readings.append((reading, restricted, r.find("re_nokanji") is not None))
                senses = []
                inherited_pos = []
                for sense in entry.findall("sense"):
                    pos = [p.text for p in sense.findall("pos")]
                    if pos:
                        inherited_pos = pos
                    glosses = [g.text for g in sense.findall("gloss") if g.get("{http://www.w3.org/XML/1998/namespace}lang", "eng") == "eng"]
                    if not glosses:
                        continue
                    senses.append({
                        "pos": inherited_pos,
                        "forms": [v.text for v in sense.findall("stagk")],
                        "readings": [v.text for v in sense.findall("stagr")],
                        "glosses": glosses,
                    })
                if not senses:
                    entry.clear()
                    root.clear()
                    continue
                headword = forms[0] if forms else readings[0][0]
                record = {
                    "targetId": target,
                    "headword": headword,
                    "reading": " / ".join(r[0] for r in readings),
                    "senses": senses,
                }
                full_definition = "\n".join(
                    ("[" + ", ".join(s["forms"] + s["readings"]) + "] "
                     if s["forms"] or s["readings"] else "") + "; ".join(s["glosses"])
                    for s in senses
                )
                if len(full_definition.encode()) > 32768:
                    raise RuntimeError("JMdict definition exceeds Inspector contract")
                # Each match retains form/reading/sense restrictions. A reading-only
                # lookup must not expose senses requiring a different written form.
                matches = {}
                for reading, restricted, no_kanji in readings:
                    written = [] if no_kanji else (restricted or forms)
                    for form in [reading] + written:
                        applicable = [
                            sense for sense in senses
                            if (not sense["readings"] or reading in sense["readings"])
                            and (not sense["forms"] or form in sense["forms"])
                        ]
                        if not applicable:
                            continue
                        pos = list(dict.fromkeys(p for s in applicable for p in s["pos"]))
                        value = {"id": target, "reading": reading, "pos": pos}
                        matches[(form, reading)] = value
                for (form, _), value in matches.items():
                    if len(("form/" + form).encode()) > 256:
                        raise RuntimeError("JMdict lookup key exceeds ABI limit")
                    db.execute("INSERT INTO candidates VALUES(?,?,?)", (form, target, encoded(value)))
                # Keep valid written-form/reading pairs, not a joined display string
                # used as an enrichment join key. Restrictions remain authoritative.
                record["variants"] = [{"written": form, "reading": reading} for form, reading in sorted(matches)]
                db.execute("INSERT INTO resource_entries VALUES (?,?)", ("entry/" + seq, stored(record)))
                entries += 1
                entry.clear()
                root.clear()
        db.execute("CREATE INDEX candidate_form ON candidates(form,target)")
        current = None
        values = []
        form_count = 0
        for form, value in db.execute("SELECT form,value FROM candidates ORDER BY form,target,value"):
            if current is not None and form != current:
                if len(values) > MAX_CANDIDATES:
                    raise RuntimeError(f"Ambiguity exceeds declared bound for {current}")
                db.execute("INSERT INTO resource_entries VALUES(?,?)", ("form/" + current, stored(values)))
                form_count += 1
                values = []
            current = form
            values.append(json.loads(value))
        if current is not None:
            if len(values) > MAX_CANDIDATES:
                raise RuntimeError(f"Ambiguity exceeds declared bound for {current}")
            db.execute("INSERT INTO resource_entries VALUES(?,?)", ("form/" + current, stored(values)))
            form_count += 1
        db.execute("DROP TABLE candidates")
        if enrichment is not None:
            prepare_enrichment(db, enrichment)
        db.execute("INSERT INTO resource_entries VALUES(?,?)", ("metadata", encoded({
            "schema": "org.mlearn.japanese.lexicon", "schemaVersion": 3, "valueCodec": "zlib-json-v1",
            "linguisticSchema": {"id": "org.mlearn.japanese.linguistic", "version": 1},
            "provenance": {
                "jmdict": PIN["jmdict"], "importArtifact": ENRICHMENT_PIN["artifact"],
                "sources": {key: ENRICHMENT_PIN[key] for key in ("referenceRevision", "pitch", "levels")},
            },
            "entries": entries, "forms": form_count,
        })))
        db.commit()
        db.execute("VACUUM")
    temporary.replace(destination)
    print(f"JMdict: entries={entries} forms={form_count} bytes={destination.stat().st_size}")


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    DESTINATION.mkdir(parents=True, exist_ok=True)
    pin = PIN["jmdict"]
    archive = CACHE / f"JMdict_e-{pin['sha256']}.gz"
    canonical = CACHE / f"JMdict_e-{ARCHIVE_PIN['expandedSha256']}.xml"
    if not archive.exists() and canonical.exists():
        archive = canonical
    supplied = os.environ.get("MLEARN_JMDICT_SOURCE")
    if not archive.exists():
        temporary = archive.with_suffix(".part")
        if supplied:
            shutil.copyfile(supplied, temporary)
        elif "--download" in sys.argv:
            with urllib.request.urlopen(pin["url"], timeout=60) as response, temporary.open("wb") as output:
                total = 0
                while chunk := response.read(65536):
                    total += len(chunk)
                    if total > pin["byteLength"]:
                        raise RuntimeError("Remote snapshot changed; update and review the explicit pin")
                    output.write(chunk)
        else:
            raise RuntimeError("Pinned JMdict source missing. Run npm run prepare:language-data or supply MLEARN_JMDICT_SOURCE; normal builds remain offline.")
        if digest(temporary) != pin["sha256"]:
            temporary.unlink()
            raise RuntimeError("JMdict pin mismatch; never silently use the moving latest snapshot")
        temporary.replace(archive)
    expected_size = pin["byteLength"] if archive.suffix == ".gz" else ARCHIVE_PIN["expandedByteLength"]
    expected_digest = pin["sha256"] if archive.suffix == ".gz" else ARCHIVE_PIN["expandedSha256"]
    if archive.stat().st_size != expected_size or digest(archive) != expected_digest:
        raise RuntimeError("Cached JMdict pin mismatch")
    lexical = DESTINATION / "lexicon-v1.sqlite"
    enrichment = enrichment_source()
    recipe = hashlib.sha256(Path(__file__).read_bytes() + PIN_PATH.read_bytes() + ENRICHMENT_PIN_PATH.read_bytes()).hexdigest()
    receipt = DESTINATION / "lexicon.recipe.json"
    saved = json.loads(receipt.read_text()) if receipt.exists() else {}
    if not lexical.exists() or saved.get("recipe") != recipe or saved.get("sha256") != digest(lexical):
        prepare_index(archive, lexical, enrichment)
        receipt.write_text(json.dumps({"recipe": recipe, "sha256": digest(lexical)}))
    sudachi = PIN["sudachi"]
    dictionary = DESTINATION / "system.dic"
    if not dictionary.exists() or digest(dictionary) != sudachi["sha256"]:
        wheel = CACHE / sudachi["wheel"]
        if digest(wheel) != sudachi["wheelSha256"]:
            raise RuntimeError("Sudachi wheel pin mismatch")
        temporary = dictionary.with_suffix(".part")
        with zipfile.ZipFile(wheel) as zipped, zipped.open(sudachi["member"]) as source, temporary.open("wb") as output:
            if zipped.getinfo(sudachi["member"]).file_size != sudachi["byteLength"]:
                raise RuntimeError("Sudachi dictionary length mismatch")
            shutil.copyfileobj(source, output, 65536)
        if digest(temporary) != sudachi["sha256"]:
            raise RuntimeError("Sudachi dictionary digest mismatch")
        temporary.replace(dictionary)
    print(f"Japanese resources READY {lexical} {dictionary}")


if __name__ == "__main__":
    main()
