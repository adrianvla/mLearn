import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeHistoryStore } from './knowledgeHistoryStore';
import { LearningEvidenceReader } from './learningEvidenceReader';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

let dir: string;
let store: KnowledgeHistoryStore;
let reader: LearningEvidenceReader;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-evidence-reader-'));
  const dbPath = path.join(dir, 'journal.sqlite3');
  const workerPath = path.join(dir, 'worker.cjs');
  buildSync({ entryPoints: [path.resolve('src/electron/services/learningEvidenceWorker.ts')], outfile: workerPath,
    bundle: true, platform: 'node', format: 'cjs' });
  store = KnowledgeHistoryStore.open(dbPath);
  reader = new LearningEvidenceReader(dbPath, workerPath);
});
afterEach(async () => { await reader.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('off-thread canonical learning evidence', () => {
  it('keeps the caller responsive and coalesces reads while preserving old addressed attempts and exact Undo', async () => {
    const old: KnowledgeEvent = { t: 1, kind: 'rating', source: 'manual', attemptId: 'old', method: 'recall',
      taskType: 'future-task', quality: 'fluent', targetRef: { kind: 'surface', id: 'old', capability: 'future::access' } };
    store.appendEvents({ 'xx:old': [old], 'xx:recent': Array.from({ length: 5000 }, (_, i): KnowledgeEvent => ({
      ...old, t: i + 10, attemptId: `new-${i}`, targetRef: { kind: 'surface', id: 'recent', capability: 'future::access' },
    })) });
    const expected = store.getLearningEvidence('xx');
    let done = false;
    const pending = reader.query('xx', store.sequenceCounter);
    expect(reader.query('xx', store.sequenceCounter)).toBe(pending);
    void pending.then(() => { done = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(done).toBe(false);
    const snapshot = await pending;
    expect(snapshot.events).toEqual(expected.events);
    expect(snapshot.sequence).toBe(expected.sequence);
    expect(snapshot.model?.memories).toEqual(expected.model?.memories);
    expect(snapshot.model?.memories['["old","future::access"]']?.observations).toBe(1);
    store.appendEvents({ 'xx:old': [{ t: 6000, kind: 'retraction', source: 'manual', retracts: 'old' }] });
    const retracted = await reader.query('xx', store.sequenceCounter);
    expect(retracted.sequence).toBe(store.sequenceCounter);
    expect(retracted.model?.memories['["old","future::access"]']).toBeUndefined();
    await reader.close();
    const restarted = await reader.query('xx', store.sequenceCounter);
    expect(restarted.model?.memories).toEqual(retracted.model?.memories);
  });
  it('rejects malformed requests without occupying the worker', async () => {
    await expect(reader.query('', 0)).rejects.toThrow('Invalid learning language');
    expect((await reader.query('future', 0)).sequence).toBe(0);
  });
  it('reports worker startup failure and starts a fresh reader on explicit retry', async () => {
    const workerPath = path.join(dir, 'worker.cjs');
    fs.renameSync(workerPath, `${workerPath}.saved`);
    await expect(reader.query('future', 0)).rejects.toThrow(/Cannot find module/);
    fs.renameSync(`${workerPath}.saved`, workerPath);
    expect((await reader.query('future', 0)).sequence).toBe(0);
  });
});
