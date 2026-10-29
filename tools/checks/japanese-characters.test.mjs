import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const converter = fileURLToPath(new URL('../japanese_characters.py', import.meta.url));
const preparer = fileURLToPath(new URL('../prepare-japanese.py', import.meta.url));
const xml = `<kanjidic2><header><file_version>4</file_version><database_version>fixture</database_version>
<date_of_creation>2026-01-01</date_of_creation></header>
<character><literal>橋</literal><codepoint><cp_value cp_type="ucs">6a4b</cp_value></codepoint>
<radical><rad_value rad_type="classical">75</rad_value></radical>
<misc><grade>3</grade><stroke_count>16</stroke_count><stroke_count>15</stroke_count><freq>553</freq><jlpt>2</jlpt></misc>
<reading_meaning><rmgroup><reading r_type="ja_on">キョウ</reading><reading r_type="ja_kun">はし</reading>
<meaning>bridge</meaning><meaning m_lang="fr">pont</meaning></rmgroup>
<rmgroup><reading r_type="package_future" future="retained">variant</reading><meaning>other group</meaning></rmgroup>
<nanori>ばせ</nanori></reading_meaning></character>
<character><literal>𠀀</literal><codepoint><cp_value cp_type="ucs">20000</cp_value></codepoint>
<misc><stroke_count>2</stroke_count></misc></character></kanjidic2>`;
const componentText = '# Lookup elements, not lexical identities.\n橋 : ノ 口 木 冂\n猫 : 犬\n';
const wordXml = `<JMdict><entry><ent_seq>42</ent_seq><k_ele><keb>橋</keb></k_ele>
<r_ele><reb>はし</reb></r_ele><sense><pos>noun</pos><gloss>bridge</gloss></sense></entry></JMdict>`;
const launcher = `
import json, runpy, sqlite3, sys, zlib
from contextlib import closing
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[2]).parent))
owner = runpy.run_path(sys.argv[1])
encode = runpy.run_path(sys.argv[2])['stored']
root = Path(sys.argv[3])
with closing(sqlite3.connect(root / 'lexicon.sqlite')) as db:
    db.execute('CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB NOT NULL) WITHOUT ROWID')
    db.execute('INSERT INTO resource_entries VALUES (?,?)', ('entry/42', encode({'targetId':'jmdict:42','headword':'橋'})))
    db.commit()
    try:
        counts = owner['prepare_characters'](db,
            dictionary=root / 'characters.xml.gz', dictionary_pin=json.loads(sys.argv[4]),
            components=root / 'components.gz', components_pin=json.loads(sys.argv[5]), encode=encode)
    except owner['CharacterSourceError'] as error:
        result = {'state':'failed','source':error.source.name}
    else:
        db.commit()
        result = {'state':'ready','characters':counts.characters,'componentRecords':counts.component_records,
                  'componentSourceRecords':counts.component_source_records}
# Closing without a commit above is the actual preparation owner's rollback.
with closing(sqlite3.connect(root / 'lexicon.sqlite')) as db:
    result['rows'] = [[key,json.loads(zlib.decompress(value))] for key,value in
        db.execute('SELECT key,value FROM resource_entries ORDER BY key')]
print(json.dumps(result, ensure_ascii=False))
`;
const indexLauncher = `
import json, runpy, sqlite3, sys, zlib
from contextlib import closing, redirect_stdout
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[2]).parent))
owner = runpy.run_path(sys.argv[2])
prepare_index = owner['prepare_index']
pins = prepare_index.__globals__['PIN']
pins['kanjidic2'] = json.loads(sys.argv[4])
pins['kradfile'] = json.loads(sys.argv[5])
root = Path(sys.argv[3])
with redirect_stdout(sys.stderr):
    prepare_index(root / 'words.xml', root / 'lexicon.sqlite',
        character_archives=(root / 'characters.xml.gz', root / 'components.gz'))
with closing(sqlite3.connect(root / 'lexicon.sqlite')) as db:
    rows = [[key,json.loads(value if key == 'metadata' else zlib.decompress(value))]
            for key,value in db.execute('SELECT key,value FROM resource_entries ORDER BY key')]
print(json.dumps({'rows':rows}, ensure_ascii=False))
`;
const freezeLauncher = `
import hashlib, json, runpy, sys
from pathlib import Path
owner = runpy.run_path(sys.argv[1])
root = Path(sys.argv[3])
source = root / 'characters.xml.gz'
destination = root / 'frozen.xml.gz'
pin = json.loads(sys.argv[4])
owner['freeze_source'](source, destination, pin)
initial = hashlib.sha256(destination.read_bytes()).hexdigest()
destination.write_bytes(b'other writer')
try:
    owner['freeze_source'](source, destination, pin)
except owner['CharacterSourceError']:
    rejected = True
else:
    rejected = False
print(json.dumps({'initial':initial,'rejected':rejected,'retained':destination.read_text(),
                  'scratch':len(list(root.glob('.character-*')))}))
`;

function sourcePin(raw, compressed) {
  return {
    sha256: createHash('sha256').update(compressed).digest('hex'),
    byteLength: compressed.length,
    expandedSha256: createHash('sha256').update(raw).digest('hex'),
    expandedByteLength: raw.length,
    encoding: 'UTF-8',
  };
}

async function prepare(t, { failure, mode = 'convert' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'mlearn-character-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dictionary = Buffer.from(failure === 'identity' ? xml.replace('>20000<', '>20001<') : xml);
  const components = Buffer.from(componentText);
  const dictionaryGzip = gzipSync(dictionary);
  const componentGzip = gzipSync(components);
  await writeFile(path.join(root, 'characters.xml.gz'), dictionaryGzip);
  await writeFile(path.join(root, 'components.gz'), componentGzip);
  await writeFile(path.join(root, 'words.xml'), wordXml);
  const dictionaryPin = {
    ...sourcePin(dictionary, dictionaryGzip),
    fileVersion: '4',
    databaseVersion: failure === 'edition' ? 'different-edition' : 'fixture',
    dateOfCreation: '2026-01-01',
  };
  if (failure === 'digest') dictionaryPin.sha256 = '0'.repeat(64);
  if (failure === 'expansion') dictionaryPin.expandedByteLength -= 1;
  const program = { convert: launcher, index: indexLauncher, freeze: freezeLauncher }[mode];
  assert.ok(program);
  const result = await new Promise(resolve => {
    execFile('python3', ['-B', '-c', program, converter, preparer, root,
      JSON.stringify(dictionaryPin), JSON.stringify(sourcePin(components, componentGzip))],
    { timeout: 10_000, maxBuffer: 65536 }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code ?? error.signal ?? 'SPAWN_ERROR' : 0, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('preserves reading groups, source attributes, supplementary identities and component availability', async t => {
  // Given: two source characters, separate reading/meaning groups and one component row.
  // When: the real converter appends to the existing resource format.
  const result = await prepare(t);
  // Then: facts stay source-scoped and the unrelated lexical identity is unchanged.
  assert.equal(result.state, 'ready');
  assert.equal(result.characters, 2);
  assert.equal(result.componentRecords, 1);
  assert.equal(result.componentSourceRecords, 2);
  const rows = Object.fromEntries(result.rows);
  assert.deepEqual(rows['entry/42'], { targetId: 'jmdict:42', headword: '橋' });
  assert.deepEqual(rows['character/6a4b'].groups, [
    {
      readings: [
        { text: 'キョウ', attributes: { r_type: 'ja_on' } },
        { text: 'はし', attributes: { r_type: 'ja_kun' } },
      ],
      meanings: [{ text: 'bridge', attributes: {} }, { text: 'pont', attributes: { m_lang: 'fr' } }],
    },
    {
      readings: [{ text: 'variant', attributes: { r_type: 'package_future', future: 'retained' } }],
      meanings: [{ text: 'other group', attributes: {} }],
    },
  ]);
  assert.deepEqual(rows['character/6a4b'].strokeCounts, [16, 15]);
  assert.deepEqual(rows['character/6a4b'].nameReadings, ['ばせ']);
  assert.equal(rows['character/6a4b'].legacyJlpt, 2);
  assert.deepEqual(rows['character/6a4b'].components, ['ノ', '口', '木', '冂']);
  assert.equal(rows['character/20000'].literal, '𠀀');
  assert.equal(rows['character/20000'].components, null);
});

for (const failure of ['digest', 'expansion', 'edition', 'identity']) {
  test(`does not publish partial character data after ${failure} failure`, async t => {
    // Given: a bad pin, expansion, edition or late UCS identity, with existing lexical data.
    // When: the real preparation transaction rejects it.
    const result = await prepare(t, { failure });
    // Then: even a failure after the first inserted character preserves only committed data.
    assert.equal(result.state, 'failed');
    assert.equal(result.source, 'characters.xml.gz');
    assert.deepEqual(result.rows, [['entry/42', { targetId: 'jmdict:42', headword: '橋' }]]);
  });
}

test('keeps character facts and original dictionary targets in one prepared resource', async t => {
  // Given: a real preparation owner with small verified character/word inputs.
  // When: it publishes the complete lexical resource.
  const result = await prepare(t, { mode: 'index' });
  // Then: namespace and metadata counts agree without replacing lexical identities.
  const rows = Object.fromEntries(result.rows);
  assert.equal(rows['entry/42'].targetId, 'jmdict:42');
  assert.equal(rows['entry/42'].headword, '橋');
  assert.equal(rows['character/6a4b'].literal, '橋');
  assert.equal(rows.metadata.entries, 1);
  assert.equal(rows.metadata.characterSchema.characters, 2);
  assert.equal(rows.metadata.characterSchema.componentCharacters, 1);
  assert.equal(rows.metadata.characterSchema.componentSourceRecords, 2);
});

test('freezes verified input without overwriting another writer or retaining scratch files', async t => {
  // Given: a verified source and a subsequently changed destination.
  // When: publication is requested again.
  const result = await prepare(t, { mode: 'freeze' });
  // Then: the first bytes matched the source, but the other writer is preserved.
  assert.equal(result.initial, sourcePin(Buffer.from(xml), gzipSync(Buffer.from(xml))).sha256);
  assert.equal(result.rejected, true);
  assert.equal(result.retained, 'other writer');
  assert.equal(result.scratch, 0);
});
