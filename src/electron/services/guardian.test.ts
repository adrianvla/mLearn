import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { Guardian, inspectGuardianData, needsEvidenceRebase, type GuardianMetrics } from './guardian';
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

  it('opens a populated ledger written before legacy knowledge metrics were tracked', async () => {
    writeProfile(['a']);
    fs.writeFileSync(file('knowledge-events.json'), JSON.stringify({
      'test:word': [{ kind: 'review', t: 1 }],
    }));
    await new Guardian(temp.tmpDir).preflight();
    const ledgerPath = file('guardian/ledger.json');
    const olderLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    delete olderLedger.metrics.legacyKnowledgeKeys;
    delete olderLedger.metrics.legacyKnowledgeEvents;
    fs.writeFileSync(ledgerPath, JSON.stringify(olderLedger));

    const reopened = new Guardian(temp.tmpDir);
    await expect(reopened.preflight()).resolves.toBeUndefined();
    expect(reopened.status.metrics?.legacyKnowledgeKeys).toEqual(['test:word']);
    expect(reopened.status.metrics?.legacyKnowledgeEvents).toBe(1);
    fs.rmSync(file('knowledge-events.json'));
    await expect(new Guardian(temp.tmpDir).preflight()).rejects.toThrow('legacy knowledge events decreased');
  });

  it('verifies a recovery snapshot whose manifest predates legacy knowledge metrics', async () => {
    writeProfile(['a']);
    fs.writeFileSync(file('knowledge-events.json'), JSON.stringify({
      'test:word': [{ kind: 'review', t: 1 }],
    }));
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const snapshot = guardian.listRecoveryPoints()[0];
    const manifestPath = file(`guardian/${snapshot}/manifest.json`);
    const oldManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete oldManifest.metrics.legacyKnowledgeKeys;
    delete oldManifest.metrics.legacyKnowledgeEvents;
    fs.writeFileSync(manifestPath, JSON.stringify(oldManifest));

    expect(guardian.newestVerifiedRecoveryPoint()).toBe(snapshot);
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

  it('allows Undo to restore exactly one review count on its card', async () => {
    writeProfile(['a', 'b']);
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const restored = {
      version: 3,
      flashcards: { a: { ...card('a'), reviews: 1 }, b: card('b') },
      wordKnowledge: {},
      grammarKnowledge: {},
    };
    expect(() => guardian.checkFlashcardWrite(restored)).toThrow('review history decreased');
    expect(() => guardian.checkFlashcardWrite(restored, [], false, {
      kind: 'undo-review', cardId: 'a', restoredReviews: 1,
    })).not.toThrow();

    const unrelatedDecrease = {
      ...restored,
      flashcards: { ...restored.flashcards, b: { ...card('b'), reviews: 1 } },
    };
    expect(() => guardian.checkFlashcardWrite(unrelatedDecrease, [], false, {
      kind: 'undo-review', cardId: 'a', restoredReviews: 1,
    })).toThrow('review history decreased');
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

describe('Guardian evidence rebase for undos', () => {
  /**
   * The real shape of a learner who reviewed and then undid: a schema-1 ledger
   * whose evidence total was only ever incremented, sitting 3 above the true
   * count because three attempts were retracted.
   */
  const preRetractionLedger = (evidence: number): GuardianMetrics => ({
    flashcardSchema: 3, knowledgeSchema: 2,
    cards: ['a', 'b'], cardReviews: { a: 2, b: 1 },
    wordKnowledge: [], grammarKnowledge: [],
    rooms: [], threads: [], participants: [],
    journalRecords: {}, knowledgeSequence: 1706761, knowledgeKeys: 3,
    knowledgeKeyIds: ['k1', 'k2', 'k3'],
    knowledgeEvidenceCount: evidence,
    legacyKnowledgeKeys: [], legacyKnowledgeEvents: 0, legacyEvidence: {},
  } as GuardianMetrics);

  const inspected = (over: Partial<GuardianMetrics> = {}): GuardianMetrics => ({
    ...preRetractionLedger(1706758),
    knowledgeRetractedCount: 50,
    ...over,
  } as GuardianMetrics);

  it('rebases a pre-retraction ledger that is high only because of undos', () => {
    expect(needsEvidenceRebase(preRetractionLedger(1706761), inspected())).toBe(true);
  });

  it('still blocks a loss far larger than the retractions can explain', () => {
    expect(needsEvidenceRebase(preRetractionLedger(1706761), inspected({ knowledgeEvidenceCount: 1705761 }))).toBe(false);
  });

  it('still blocks when no retraction could account for the gap', () => {
    expect(needsEvidenceRebase(preRetractionLedger(1706761), inspected({ knowledgeRetractedCount: 0 }))).toBe(false);
  });

  it('never rebases a ledger that is too low', () => {
    expect(needsEvidenceRebase(preRetractionLedger(1706000), inspected())).toBe(false);
  });

  it('never rebases once the ledger already tracks retractions', () => {
    const modern = { ...preRetractionLedger(1706761), knowledgeRetractedCount: 0 } as GuardianMetrics;
    expect(needsEvidenceRebase(modern, inspected())).toBe(false);
  });

  it('does not rebase away missing cards, reviews, keys, or journal records', () => {
    expect(needsEvidenceRebase(preRetractionLedger(1706761), inspected({ cards: ['a'] }))).toBe(false);
    expect(needsEvidenceRebase(preRetractionLedger(1706761), inspected({ cardReviews: { a: 2 } }))).toBe(false);
    expect(needsEvidenceRebase(preRetractionLedger(1706761), inspected({ knowledgeKeyIds: ['k1'] }))).toBe(false);
    expect(needsEvidenceRebase(
      { ...preRetractionLedger(1706761), journalRecords: { 'journal/sea.ndjson': 5 } },
      inspected({ journalRecords: {} }),
    )).toBe(false);
    expect(needsEvidenceRebase(preRetractionLedger(1706761), inspected({ knowledgeSequence: 1600000 }))).toBe(false);
  });

  /** A profile whose DB holds one exact event plus a retraction of another. */
  function writeRetractedProfile(): void {
    // The shared `writeProfile` stub creates a minimal `rows` table that the
    // real schema cannot migrate, so this fixture writes the flashcard and
    // world files directly and lets `KnowledgeHistoryStore` own the database.
    fs.writeFileSync(file('flashcards.json'), JSON.stringify({
      version: 3, flashcards: { a: card('a') }, wordKnowledge: {}, grammarKnowledge: {},
    }));
    fs.writeFileSync(file('world.json'), JSON.stringify({ rooms: [{ id: 'room-1' }], threads: [], participants: [] }));
    const store = KnowledgeHistoryStore.open(file('knowledge-history.sqlite3'));
    store.appendEvents({ 'xx:key': [
      { t: Date.now(), kind: 'review', source: 'srs', aspect: 'meaning', attemptId: 'keep', rating: 'good', easeAfter: 2.5 },
      { t: Date.now(), kind: 'review', source: 'srs', aspect: 'meaning', attemptId: 'undo', rating: 'again', easeAfter: 2.5 },
    ] });
    store.appendEvents({ 'xx:key': [
      { t: Date.now(), kind: 'retraction', source: 'srs', retracts: 'undo' },
    ] });
    store.close();
  }

  /** Turn a healthy ledger into the pre-fix, undo-blocked ledger a learner really has. */
  async function blockOnEvidenceAlone(): Promise<string> {
    writeRetractedProfile();
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const ledgerPath = file('guardian/ledger.json');
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    // Pre-retraction-accounting: the total was only ever incremented, so undoing
    // one attempt left it above the truth. `block` copies `previous.metrics`, so
    // the raised total survives into the blocked ledger exactly as it did. The
    // sequence also sits below the truth, because the block is what stopped the
    // app from ever recording the retraction's own sequence.
    ledger.state = 'blocked';
    const truth = inspectGuardianData(temp.tmpDir);
    ledger.reason = 'Unexplained learner data loss: knowledge evidence count decreased by 1 beyond 0 retracted';
    ledger.metrics.knowledgeEvidenceCount = truth.knowledgeEvidenceCount + 1;
    ledger.metrics.knowledgeSequence = truth.knowledgeSequence - 1;
    delete ledger.metrics.knowledgeRetractedCount;
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    return ledgerPath;
  }

  it('accepts a live acknowledged retraction after restart without inventing evidence loss', async () => {
    writeRetractedProfile();
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const store = KnowledgeHistoryStore.open(file('knowledge-history.sqlite3'));
    store.appendEvents({ 'xx:key': [{ t: Date.now(), kind: 'retraction', source: 'manual', retracts: 'keep' }] });
    guardian.recordKnowledgeSequence(store.sequenceCounter, 1, ['xx:key']);
    store.close();
    const truth = inspectGuardianData(temp.tmpDir);
    expect(truth.knowledgeEvidenceCount).toBe(guardian.status.metrics!.knowledgeEvidenceCount);
    await expect(new Guardian(temp.tmpDir).preflight()).resolves.toBeUndefined();
  });

  it('rechecks an evidence-only post-migration block with modern retraction accounting', async () => {
    writeRetractedProfile();
    const guardian = new Guardian(temp.tmpDir);
    await guardian.preflight();
    const ledgerPath = file('guardian/ledger.json');
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    ledger.state = 'blocked';
    ledger.reason = 'Post-migration learner data loss: knowledge evidence count decreased by 1 beyond 1 retracted';
    ledger.metrics.knowledgeRetractedCount = 0;
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    await expect(new Guardian(temp.tmpDir).preflight()).resolves.toBeUndefined();
  });

  it('re-evaluates a ledger blocked on the evidence total alone instead of demanding a restore', async () => {
    await blockOnEvidenceAlone();
    const reopened = new Guardian(temp.tmpDir);
    await expect(reopened.preflight()).resolves.toBeUndefined();
    expect(reopened.status.state).toBe('ready');
    // Rebased onto inspected truth, not back onto the ledger's stale total.
    expect(reopened.status.metrics?.knowledgeEvidenceCount)
      .toBe(inspectGuardianData(temp.tmpDir).knowledgeEvidenceCount);
    expect(reopened.status.metrics?.knowledgeRetractedCount).toBe(1);
  });

  it('still demands recovery when the block reported more than the evidence total', async () => {
    await blockOnEvidenceAlone();
    const ledgerPath = file('guardian/ledger.json');
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    ledger.reason = 'Unexplained learner data loss: cards: 2 missing; knowledge evidence count decreased';
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    await expect(new Guardian(temp.tmpDir).preflight()).rejects.toThrow('Guardian needs recovery');
  });

  it('still blocks when the evidence gap is still unexplained after re-inspection', async () => {
    await blockOnEvidenceAlone();
    const ledgerPath = file('guardian/ledger.json');
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    ledger.metrics.knowledgeEvidenceCount = 9;
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    const reopened = new Guardian(temp.tmpDir);
    await expect(reopened.preflight()).rejects.toThrow('Unexplained learner data loss');
    expect(reopened.status.state).toBe('blocked');
  });
});
