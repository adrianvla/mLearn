import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { Guardian, inspectGuardianData } from './guardian';
import AdmZip from 'adm-zip';
import { KnowledgeHistoryStore } from './knowledgeHistoryStore';

let temp: TempDir;
const file = (name: string): string => path.join(temp.tmpDir, name);
const card = (id: string) => ({ id, content: { front: id, back: 'meaning' }, reviews: 2 });

function writeProfile(ids: string[]): void {
  fs.writeFileSync(file('flashcards.json'), JSON.stringify({
    version: 3, flashcards: Object.fromEntries(ids.map((id) => [id, card(id)])),
    wordKnowledge: {}, grammarKnowledge: {},
  }));
  fs.writeFileSync(file('world.json'), JSON.stringify({ rooms: [{ id: 'room-1' }], threads: [], participants: [] }));
  fs.mkdirSync(file('journal/room-1'), { recursive: true });
  fs.writeFileSync(file('journal/room-1/sea.ndjson'), `${JSON.stringify({ seq: 1, type: 'memory' })}\n`);
  const db = new DatabaseSync(file('knowledge-history.sqlite3'));
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('seqCounter', '2'); INSERT INTO meta VALUES ('schemaVersion', '2'); CREATE TABLE rows (key TEXT);");
  db.close();
}

beforeEach(() => { temp = createTempDir('mlearn-guardian-'); });
afterEach(() => { temp.cleanup(); });

describe('Guardian direct integrity boundary', () => {
  it('reports inspection before the recovery snapshot is available', async () => {
    writeProfile(['a']);
    const stages: string[] = [];
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight((stage) => {
      stages.push(stage);
      expect(guardian.listRecoveryPoints().length).toBe(stage === 'inspection-complete' ? 0 : 1);
    });
    expect(stages).toEqual(['inspection-complete', 'snapshot-complete']);
  });

  it('captures canonical data before mutation and preserves the last good point after corruption', async () => {
    writeProfile(['a', 'b']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    expect(guardian.status.state).toBe('ready');
    expect(guardian.status.metrics?.cards).toEqual(['a', 'b']);
    expect(guardian.status.metrics?.knowledgeSequence).toBe(2);
    expect(guardian.listRecoveryPoints()).toHaveLength(1);

    fs.writeFileSync(file('flashcards.json'), '{broken');
    await expect(new Guardian(temp.tmpDir).preflight()).rejects.toThrow('Canonical data failed validation');
    expect(new Guardian(temp.tmpDir).listRecoveryPoints()).toHaveLength(1);
    await expect(new Guardian(temp.tmpDir).preflight()).rejects.toThrow('Canonical data failed validation');
  });

  it('checkpoints newly accumulated evidence on shutdown without rotating on an unchanged state', async () => {
    writeProfile(['a']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const store = JSON.parse(fs.readFileSync(file('flashcards.json'), 'utf8'));
    store.flashcards.b = card('b');
    guardian.checkFlashcardWrite(store);
    fs.writeFileSync(file('flashcards.json'), JSON.stringify(store));
    guardian.recordFlashcardWrite(store);
    await guardian.checkpoint();
    expect(guardian.listRecoveryPoints()).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(file(`guardian/${guardian.listRecoveryPoints()[0]}/flashcards.json`), 'utf8')).flashcards.b).toBeDefined();
    await guardian.checkpoint();
    expect(guardian.listRecoveryPoints()).toHaveLength(2);
  });

  it('restores a selected verified point only at next preflight and quarantines current data', async () => {
    writeProfile(['a']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const original = guardian.listRecoveryPoints()[0];
    const store = JSON.parse(fs.readFileSync(file('flashcards.json'), 'utf8'));
    store.flashcards.b = card('b');
    guardian.checkFlashcardWrite(store);
    fs.writeFileSync(file('flashcards.json'), JSON.stringify(store));
    guardian.recordFlashcardWrite(store);
    await guardian.checkpoint();

    guardian.queueRestore(original);
    await guardian.checkpoint();
    expect(inspectGuardianData(temp.tmpDir).cards).toEqual(['a', 'b']);
    await new Guardian(temp.tmpDir).preflight();
    expect(inspectGuardianData(temp.tmpDir).cards).toEqual(['a']);
    const quarantine = fs.readdirSync(file('guardian')).find((name) => name.startsWith('quarantine-'));
    expect(quarantine).toBeDefined();
    expect(inspectGuardianData(file(`guardian/${quarantine}`)).cards).toEqual(['a', 'b']);
  });

  it('can cancel a queued restore if relaunch cannot be scheduled', async () => {
    writeProfile(['a']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const original = guardian.listRecoveryPoints()[0];
    guardian.queueRestore(original);
    guardian.cancelQueuedRestore(original);
    expect(fs.existsSync(file('guardian/restore-transaction.json'))).toBe(false);
    await new Guardian(temp.tmpDir).preflight();
    expect(inspectGuardianData(temp.tmpDir).cards).toEqual(['a']);
  });

  it('blocks an unannounced card loss and allows a declared single-card deletion', async () => {
    writeProfile(['a', 'b']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const next = { version: 3, flashcards: { a: card('a') }, wordKnowledge: {}, grammarKnowledge: {} };
    expect(() => guardian.checkFlashcardWrite(next)).toThrow('rejected flashcard write');
    expect(guardian.status.state).toBe('ready');
    expect(inspectGuardianData(temp.tmpDir).cards).toEqual(['a', 'b']);
    expect(() => guardian.checkFlashcardWrite(next, ['b'])).not.toThrow();
    fs.writeFileSync(file('flashcards.json'), JSON.stringify(next));
    guardian.recordFlashcardWrite(next);
    await expect(new Guardian(temp.tmpDir).preflight()).resolves.toBeUndefined();
  });

  it('restores valid evidence while quarantining corruption and resumes an interrupted restore', async () => {
    writeProfile(['a']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const snapshot = guardian.listRecoveryPoints()[0];
    fs.writeFileSync(file('flashcards.json'), '{broken');
    fs.writeFileSync(file('guardian/restore-transaction.json'), JSON.stringify({ snapshotName: snapshot, quarantine: 'quarantine-interrupted' }));
    fs.mkdirSync(file('guardian/quarantine-interrupted'), { recursive: true });
    fs.renameSync(file('flashcards.json'), file('guardian/quarantine-interrupted/flashcards.json'));
    await new Guardian(temp.tmpDir).preflight();
    expect(inspectGuardianData(temp.tmpDir).cards).toEqual(['a']);
    expect(fs.readFileSync(file('guardian/quarantine-interrupted/flashcards.json'), 'utf8')).toBe('{broken');
    expect(fs.existsSync(file('guardian/restore-transaction.json'))).toBe(false);
  });

  it('rejects a modified recovery snapshot', async () => {
    writeProfile(['a']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const snapshot = guardian.listRecoveryPoints()[0];
    fs.writeFileSync(file(`guardian/${snapshot}/flashcards.json`), '{}');
    expect(() => guardian.restore(snapshot)).toThrow('checksum mismatch');
    expect(fs.existsSync(file('guardian/restore-transaction.json'))).toBe(false);
  });

  it('offers the previous verified recovery point when the newest snapshot is damaged', async () => {
    writeProfile(['a']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const first = guardian.listRecoveryPoints()[0];
    const store = JSON.parse(fs.readFileSync(file('flashcards.json'), 'utf8'));
    store.flashcards.b = card('b');
    guardian.checkFlashcardWrite(store);
    fs.writeFileSync(file('flashcards.json'), JSON.stringify(store));
    guardian.recordFlashcardWrite(store);
    await guardian.checkpoint();
    fs.writeFileSync(file(`guardian/${guardian.listRecoveryPoints()[0]}/flashcards.json`), '{}');
    expect(guardian.newestVerifiedRecoveryPoint()).toBe(first);
  });

  it('blocks startup with a newer data schema before old code can mutate it', async () => {
    writeProfile(['a']);
    const original = JSON.parse(fs.readFileSync(file('flashcards.json'), 'utf8'));
    original.version = 4;
    fs.writeFileSync(file('flashcards.json'), JSON.stringify(original));
    await expect(new Guardian(temp.tmpDir).preflight()).rejects.toThrow('cannot read this learner data schema');
  });

  it('protects legacy conversation evidence before its copy-only migration', async () => {
    writeProfile(['a']);
    fs.writeFileSync(file('kv-store.json'), JSON.stringify({
      'conversation-sessions-x': JSON.stringify([{ id: 'one' }, { id: 'two' }]),
      'agent-memories-x': JSON.stringify([{ id: 'memory' }]),
    }));
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    expect(guardian.status.metrics?.legacyEvidence['conversation-sessions-x']).toBe(2);
    expect(() => guardian.checkKvWrite({ 'conversation-sessions-x': '[]' })).toThrow('legacy evidence decreased');
  });

  it('tracks legacy knowledge events across migration rename and detects lost backup evidence', async () => {
    writeProfile(['a']);
    fs.writeFileSync(file('knowledge-events.json'), JSON.stringify({ 'xx:key': [{ kind: 'review', t: 1 }, { kind: 'review', t: 2 }] }));
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    expect(guardian.status.metrics?.legacyKnowledgeEvents).toBe(2);
    fs.renameSync(file('knowledge-events.json'), file('knowledge-events.json.migrated'));
    expect(() => guardian.verify()).not.toThrow();
    fs.rmSync(file('knowledge-events.json.migrated'));
    await expect(new Guardian(temp.tmpDir).preflight()).rejects.toThrow('legacy knowledge events decreased');
  });

  it('counts archived knowledge as evidence when compaction removes exact rows', () => {
    const dbPath = file('knowledge-history.sqlite3');
    const store = KnowledgeHistoryStore.open(dbPath);
    const old = Date.now() - 500 * 24 * 60 * 60 * 1000;
    store.appendEvents({ 'xx:key': [
      { t: old, kind: 'review', source: 'srs', aspect: 'meaning', attemptId: 'a', rating: 'good', easeAfter: 2.5 },
      { t: old + 1000, kind: 'review', source: 'srs', aspect: 'meaning', attemptId: 'b', rating: 'good', easeAfter: 2.5 },
    ] });
    const before = inspectGuardianData(temp.tmpDir);
    store.compact(Date.now());
    store.close();
    const after = inspectGuardianData(temp.tmpDir);
    expect(after.knowledgeKeyIds).toEqual(['xx:key']);
    expect(after.knowledgeEvidenceCount).toBeGreaterThanOrEqual(before.knowledgeEvidenceCount);
  });

  it('stages a deliberate import for next launch and preserves the replaced profile', async () => {
    writeProfile(['old']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const archive = new AdmZip();
    archive.addFile('flashcards.json', Buffer.from(JSON.stringify({
      version: 3, flashcards: { imported: card('imported') }, wordKnowledge: {}, grammarKnowledge: {},
    })));
    const zipPath = file('chosen.zip');
    archive.writeZip(zipPath);
    guardian.queueImportArchive(zipPath);
    expect(inspectGuardianData(temp.tmpDir).cards).toEqual(['old']);
    await new Guardian(temp.tmpDir).preflight();
    expect(inspectGuardianData(temp.tmpDir).cards).toEqual(['imported']);
    const quarantine = fs.readdirSync(file('guardian')).find((name) => name.startsWith('quarantine-import-'));
    expect(quarantine).toBeDefined();
    expect(JSON.parse(fs.readFileSync(file(`guardian/${quarantine}/flashcards.json`), 'utf8')).flashcards.old).toBeDefined();
    expect(fs.existsSync(file('guardian/pending-import.json'))).toBe(false);
    await new Guardian(temp.tmpDir).preflight();
    expect(new Guardian(temp.tmpDir).listRecoveryPoints()).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(file('guardian/snapshot-00000001/flashcards.json'), 'utf8')).flashcards.old).toBeDefined();
  });
});
