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

ROOT = Path(__file__).resolve().parent.parent
PIN_PATH = ROOT / "language-plugins/japanese/data-pin.json"
PIN = json.loads(PIN_PATH.read_text())
ARCHIVE_PIN = json.loads((ROOT / "language-plugins/japanese/archive-pin.json").read_text())
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


def prepare_index(source: Path, destination: Path) -> None:
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
                db.execute("INSERT INTO resource_entries VALUES (?,?)", ("entry/" + seq, encoded(record)))
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
                db.execute("INSERT INTO resource_entries VALUES(?,?)", ("form/" + current, encoded(values)))
                form_count += 1
                values = []
            current = form
            values.append(json.loads(value))
        if current is not None:
            if len(values) > MAX_CANDIDATES:
                raise RuntimeError(f"Ambiguity exceeds declared bound for {current}")
            db.execute("INSERT INTO resource_entries VALUES(?,?)", ("form/" + current, encoded(values)))
            form_count += 1
        db.execute("DROP TABLE candidates")
        db.execute("INSERT INTO resource_entries VALUES(?,?)", ("metadata", encoded({"schemaVersion": 2, "source": PIN["jmdict"], "entries": entries, "forms": form_count})))
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
    recipe = hashlib.sha256(Path(__file__).read_bytes() + PIN_PATH.read_bytes()).hexdigest()
    receipt = DESTINATION / "lexicon.recipe.json"
    saved = json.loads(receipt.read_text()) if receipt.exists() else {}
    if not lexical.exists() or saved.get("recipe") != recipe or saved.get("sha256") != digest(lexical):
        prepare_index(archive, lexical)
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
