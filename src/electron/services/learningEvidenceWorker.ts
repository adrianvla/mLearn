import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { readLearningEvidence } from './knowledgeHistoryStore';
import type { LearningEvidenceSnapshot } from '../../shared/learningEvidence';

const db = new DatabaseSync(workerData.dbPath as string, { readOnly: true });
let cached: { language: string; snapshot: LearningEvidenceSnapshot } | undefined;

parentPort!.on('message', ({ id, language }: { id: number; language: string }) => {
  try {
    // All queries and the provenance counter describe one committed WAL
    // snapshot. The reader never migrates, compacts or writes learner data.
    db.exec('BEGIN');
    let snapshot: LearningEvidenceSnapshot;
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'seqCounter'").get() as { value: string } | undefined;
      const sequence = Number(row?.value ?? 0);
      snapshot = cached?.language === language && cached.snapshot.sequence === sequence
        ? cached.snapshot : readLearningEvidence(db, language, sequence);
    } finally { db.exec('ROLLBACK'); }
    cached = { language, snapshot };
    parentPort!.postMessage({ id, snapshot });
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
