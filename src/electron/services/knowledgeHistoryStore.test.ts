import { DatabaseSync } from 'node:sqlite';
import type { KeyArchive } from '../../shared/knowledge/historyArchive';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { replayKeyProjection } from '../../shared/utils/projectionReplay';
import { grammarEvidenceKey, replayGrammarRecognition } from '../../shared/grammar/evidence';
import type { KnowledgeEventCursor } from '../../shared/knowledge/historyQueries';
import type { LearningDecision } from '../../shared/learningDecision';
import { COMPACTION_KEY_BUDGET, KnowledgeHistoryStore, isKnowledgeEvent } from './knowledgeHistoryStore';

const DAY = 24 * 60 * 60 * 1000;

describe('durable rating command ownership', () => {
  it('pins an immutable decision before presentation and joins an assisted command without adding ability evidence', () => {
    const file = path.join(dir, 'decision-audit.sqlite3');
    const decision: LearningDecision = { id: 'choice-before-cue', at: 20, policyVersion: 'future-policy',
      selected: { key: 'card', action: 'practice', targets: [{ kind: 'future-entity', id: 'opaque', capability: 'future::capability' }],
        presentation: { futureInput: ['unknown', { arbitraryDimension: 4 }] },
        task: { taskTemplateId: 'future-task', inputModality: 'opaque', responseModality: 'opaque', supplied: [],
          requested: ['future::capability'], fluencyRequired: false, ratingMode: 'profile' } },
      baseline: null, detail: { unknown: { conditional: ['a', { b: 2 }] } } };
    const first = KnowledgeHistoryStore.open(file);
    first.recordLearningDecision(decision);
    first.recordLearningDecision(structuredClone(decision));
    expect(() => first.recordLearningDecision({ ...decision, at: 30 })).toThrow(/immutable/);
    first.reserveRatingCommand({ attemptId: 'assisted-response', decisionId: decision.id,
      presentation: decision.selected.presentation,
      guardCardIds: ['card'], events: {}, patch: { baseRev: 0, entries: [] } });
    expect(() => first.reserveRatingCommand({ attemptId: 'different-task', decisionId: decision.id,
      presentation: decision.selected.presentation,
      guardCardIds: ['card'], events: { 'future:cue': [{ t: 20, kind: 'rating', source: 'manual', attemptId: 'different-task',
        targetRef: { kind: 'future-entity', id: 'other', capability: 'future::capability' }, quality: 'fluent' }] },
      patch: { baseRev: 0, entries: [] } })).toThrow(/captured task/);
    expect(() => first.reserveRatingCommand({ attemptId: 'wholly-supplied-wrong-cue', decisionId: decision.id,
      presentation: { futureInput: ['other cue'] }, guardCardIds: ['card'],
      events: {}, patch: { baseRev: 0, entries: [] } })).toThrow(/captured presentation/);
    expect(() => first.reserveRatingCommand({ attemptId: 'different-prompt', decisionId: decision.id,
      guardCardIds: ['other-card'], events: {}, patch: { baseRev: 0, entries: [] } })).toThrow(/captured choice/);
    expect(first.sequenceCounter).toBe(0);
    first.close();
    const restarted = KnowledgeHistoryStore.open(file);
    expect(restarted.getLearningDecisionRecord(decision.id)).toEqual({ decision,
      attempts: [{ attemptId: 'assisted-response', committedRevision: null }] });
    restarted.completeRatingCommands(1, 4);
    expect(restarted.getLearningDecisionRecord(decision.id)?.attempts).toEqual([{ attemptId: 'assisted-response', committedRevision: 4 }]);
    expect(restarted.sequenceCounter).toBe(0);
    expect(() => restarted.reserveRatingCommand({ attemptId: 'unpresented-response', decisionId: 'missing',
      events: {}, patch: { baseRev: 0, entries: [] } })).toThrow(/before presentation/);
    expect(restarted.pendingRatingCommands()).toEqual([]);
    restarted.close();
  });

  it('retains the exact command across restart without making it learning evidence', () => {
    const file = path.join(dir, 'rating-command.sqlite3');
    const first = KnowledgeHistoryStore.open(file);
    const command = { attemptId: 'physical-response', events: {}, patch: { baseRev: 4, entries: [
      { path: ['meta', 'future-owned-value'], before: undefined, after: { arbitrary: ['unknown', { value: 3 }] } },
    ] } };
    const accepted = first.reserveRatingCommand(command);
    expect(accepted.sequence).toBe(1);
    expect(first.sequenceCounter).toBe(0);
    first.close();
    const restarted = KnowledgeHistoryStore.open(file);
    expect(restarted.pendingRatingCommands()).toEqual([accepted]);
    // Retries use the admitted payload, not a reconstructed response.
    expect(restarted.reserveRatingCommand({ ...command, events: { replacement: [] } })).toEqual(accepted);
    restarted.completeRatingCommands(1, 6);
    expect(restarted.pendingRatingCommands()).toEqual([]);
    restarted.close();
    const finished = KnowledgeHistoryStore.open(file);
    expect(finished.reserveRatingCommand(command)).toMatchObject({ sequence: 1, revision: 6 });
    expect(finished.sequenceCounter).toBe(0);
    finished.close();
  });
});

describe('canonical observation idempotency', () => {
  it('deduplicates retries while accepting distinct accesses of one attempt', () => {
    const s = store();
    const key = 'xx:retry';
    const reading: KnowledgeEvent = { t: 1, kind: 'rating', source: 'manual', attemptId: 'response-1', aspect: 'reading', quality: 'fluent' };
    const meaning: KnowledgeEvent = { ...reading, aspect: 'meaning' };
    s.appendEvents({ [key]: [reading] });
    s.appendEvents({ [key]: [reading, meaning, meaning] });
    expect(s.getExactEvents([key])[key]).toEqual([reading, meaning]);
    s.close();
  });

  it('keeps retry protection across compaction, restart, and another store connection', () => {
    const file = path.join(dir, 'retry.sqlite3');
    const s = KnowledgeHistoryStore.open(file);
    const event: KnowledgeEvent = { t: 1, kind: 'rating', source: 'srs', aspect: 'meaning', attemptId: 'durable-response', quality: 'fluent', easeAfter: 2.6 };
    const older = { ...event, t: 30 * DAY, attemptId: 'archived-response' };
    s.appendEvents({ 'xx:retry': [event, older] });
    s.compact(365 * DAY);
    const before = s.getKnowledgeState('xx:retry');
    const beforeSequence = s.sequenceCounter;
    expect(before.hasArchive).toBe(true);
    s.close();
    const first = KnowledgeHistoryStore.open(file);
    const second = KnowledgeHistoryStore.open(file);
    first.appendEvents({ 'xx:retry': [event, older] });
    second.appendEvents({ 'xx:retry': [event, older] });
    expect(second.getKnowledgeState('xx:retry')).toEqual(before);
    expect(second.sequenceCounter).toBe(beforeSequence);
    first.close(); second.close();
  });

  it('recognizes archived addressed attempts from a pre-identity-cache store', () => {
    const file = path.join(dir, 'old-cache.sqlite3');
    const s = KnowledgeHistoryStore.open(file);
    const event: KnowledgeEvent = { t: 1, kind: 'rating', source: 'srs', targetRef: { kind: 'sense', id: 'opaque-sense', capability: 'sense-recognition' }, attemptId: 'old-durable-response', quality: 'fluent', easeAfter: 2.6 };
    s.appendEvents({ 'xx:old': [event, { ...event, t: 30 * DAY, attemptId: 'old-second-response' }] });
    s.compact(365 * DAY);
    const before = s.sequenceCounter;
    s.close();
    const db = new DatabaseSync(file);
    db.exec('DELETE FROM observation_identities');
    db.close();
    const restarted = KnowledgeHistoryStore.open(file);
    restarted.appendEvents({ 'xx:old': [event] });
    expect(restarted.sequenceCounter).toBe(before);
    restarted.close();
  });

  it('seeds old archived Anki observations from the verified backup without rewriting history', () => {
    const file = path.join(dir, 'old-anki-cache.sqlite3');
    const s = KnowledgeHistoryStore.open(file);
    const events: KnowledgeEvent[] = [1, 30, 60].map((day, index) => ({ t: day * DAY, kind: 'review', source: 'anki', aspect: 'meaning', ankiReviewId: index + 10, easeAfter: 2.6, rating: 'good' }));
    const backup = { 'xx:old': events };
    expect(s.importLegacyLog(backup, 365 * DAY).verified).toBe(true);
    const before = s.getKnowledgeState('xx:old');
    const sequence = s.sequenceCounter;
    s.close();
    const db = new DatabaseSync(file);
    db.exec("DELETE FROM observation_identities; UPDATE meta SET value = '2' WHERE key = 'schemaVersion'");
    db.close();
    const restarted = KnowledgeHistoryStore.open(file);
    restarted.backfillObservationIdentities(backup);
    restarted.appendEvents({ 'xx:old': [events[1]] });
    expect(restarted.sequenceCounter).toBe(sequence);
    expect(restarted.getKnowledgeState('xx:old')).toEqual(before);
    expect(restarted.schemaVersion).toBe(3);
    restarted.close();
  });

  it('clears observation identities when a failed migration resets the store', () => {
    const s = store();
    const event: KnowledgeEvent = { t: 1, kind: 'rating', source: 'srs', aspect: 'meaning', eventId: 'reset-observation' };
    s.appendEvents({ 'xx:reset': [event] });
    s.resetForReimport();
    s.appendEvents({ 'xx:reset': [event] });
    expect(s.getExactEvents(['xx:reset'])['xx:reset']).toEqual([event]);
    s.close();
  });

  it('protects imported event ids through compaction without dropping historical occurrences', () => {
    const s = store();
    const event: KnowledgeEvent = { t: 1, kind: 'rating', source: 'srs', aspect: 'meaning', eventId: 'imported-observation', quality: 'fluent', easeAfter: 2.6 };
    s.importLegacyLog({ 'xx:import': [event, { ...event, t: 30 * DAY }] });
    const seq = s.sequenceCounter;
    s.appendEvents({ 'xx:import': [event] });
    expect(s.sequenceCounter).toBe(seq);
    s.compact(365 * DAY);
    s.appendEvents({ 'xx:import': [event] });
    expect(s.sequenceCounter).toBe(seq);
    s.close();
  });

  it('retains distinct directed targets within one Anki review', () => {
    const s = store();
    const first: KnowledgeEvent = { t: 1, kind: 'rating', source: 'anki', ankiReviewId: 123, targetRef: { kind: 'sense', id: 'sense-a', capability: 'sense-recognition' } };
    const second: KnowledgeEvent = { ...first, targetRef: { ...first.targetRef!, id: 'sense-b' } };
    s.appendEvents({ 'xx:anki': [first, second, first, second] });
    expect(s.getExactEvents(['xx:anki'])['xx:anki']).toEqual([first, second]);
    s.close();
  });

  it('does not deduplicate ambiguous historical numeric session ids', () => {
    const s = store();
    const event = { t: 1, kind: 'rating', source: 'srs', aspect: 'meaning', attemptId: '1', quality: 'fluent' } as const;
    s.appendEvents({ 'xx:legacy': [event, { ...event, t: 2 }] });
    expect(s.getExactEvents(['xx:legacy'])['xx:legacy']).toHaveLength(2);
    s.close();
  });
});

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-khstore-'));
});

describe('bounded exact-event wire and grammar fold', () => {
  it('pages Unicode events below the wire ceiling with a stable sequence snapshot', () => {
    const s = store();
    const key = 'xx:page';
    const original = Array.from({ length: 500 }, (_, index): KnowledgeEvent => ({
      t: index + 1, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 2,
      origin: '漢字😀'.repeat(140),
    }));
    s.appendEvents({ [key]: original });
    let after: KnowledgeEventCursor | null = null;
    let maxSeq: number | undefined;
    const decoded: KnowledgeEvent[] = [];
    let pages = 0;
    for (;;) {
      const page = s.pageExactEvents(key, after, maxSeq);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512 * 1024);
      expect(page.events.every((value) => typeof value === 'string')).toBe(true);
      if (pages === 0) {
        s.appendEvents({ [key]: [{ t: 0, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 1 }] });
      }
      decoded.push(...page.events.map((json) => JSON.parse(json) as KnowledgeEvent));
      after = page.after;
      maxSeq = page.maxSeq;
      pages++;
      if (!page.hasMore) break;
    }
    expect(pages).toBeGreaterThan(1);
    expect(decoded).toEqual(original);
    s.close();
  });

  it('fragments one oversized event on UTF-8 byte boundaries and rejects a stale offset', () => {
    const s = store();
    const key = 'xx:large';
    const event: KnowledgeEvent = {
      t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 2.5,
      origin: '漢字😀'.repeat(80_000),
    };
    s.appendEvents({ [key]: [event] });
    let after: KnowledgeEventCursor | null = null;
    let maxSeq: number | undefined;
    let offset = 0;
    const fragments: Buffer[] = [];
    for (;;) {
      const page = s.pageExactEvents(key, after, maxSeq, offset);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512 * 1024);
      if (page.fragment) {
        fragments.push(Buffer.from(page.fragment.data, 'base64'));
        offset = page.fragment.complete ? 0 : page.fragment.nextOffset;
      }
      after = page.after;
      maxSeq = page.maxSeq;
      if (!page.hasMore) break;
    }
    expect(JSON.parse(Buffer.concat(fragments).toString('utf8'))).toEqual(event);
    expect(() => s.pageExactEvents(key, null, maxSeq, 999_999_999)).toThrow('Invalid event fragment offset');
    s.close();
  });

  it('folds grammar evidence without shipping its raw history and keeps only item rows for item consumers', () => {
    const s = store();
    const key = grammarEvidenceKey('xx', '構文😀', 'grammar-recognition');
    const events: KnowledgeEvent[] = [
      { t: 1, kind: 'rollup', source: 'grammar', aspect: 'grammar', timesSeenDelta: 3 },
      { t: 2, kind: 'rating', source: 'grammar', aspect: 'grammar', easeAfter: 3, attemptId: 'item-1', itemRef: { id: 'item', version: 'v1' } },
      { t: 3, kind: 'rating', source: 'grammar', aspect: 'grammar', easeAfter: 4, attemptId: 'item-2', itemRef: { id: 'item', version: 'v1' } },
      { t: 4, kind: 'retraction', source: 'manual', retracts: 'item-1' },
      { t: 5, kind: 'review', source: 'anki', aspect: 'grammar', easeAfter: 2.4, ankiReviewId: 123 },
    ];
    s.appendEvents({ [key]: events });
    expect(s.getGrammarProjections('xx')[key]).toEqual(replayGrammarRecognition(events));
    const itemPage = s.pageExactEvents(key, null, undefined, 0, true);
    expect(itemPage.events.map((json) => JSON.parse(json))).toEqual(events.slice(1, 4));
    expect(Object.keys(s.getGrammarProjections('none'))).toHaveLength(0);
    s.close();
  });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function store(): KnowledgeHistoryStore {
  return KnowledgeHistoryStore.open(path.join(dir, 'knowledge-history.sqlite3'));
}

const NOW_VAL = () => Date.UTC(2026, 7, 15, 12);

function attemptEvent(overrides: Partial<KnowledgeEvent> & { t: number }): KnowledgeEvent {
  return {
    kind: 'review',
    source: 'srs',
    aspect: 'meaning',
    attemptId: `attempt-${overrides.t}`,
    easeAfter: 2.5,
    timesSeenDelta: 1,
    ...overrides,
  } as KnowledgeEvent;
}

function ankiReview(t: number, easeAfter: number, ankiReviewId?: number): KnowledgeEvent {
  return { t, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter, rating: 'good', timesSeenDelta: 1, ...(ankiReviewId !== undefined ? { ankiReviewId } : {}) };
}

function ankiStatus(t: number, toStatus: KnowledgeEvent['toStatus']): KnowledgeEvent {
  return { t, kind: 'status', source: 'anki', aspect: 'meaning', toStatus };
}

describe('KnowledgeHistoryStore', () => {
  it('finds exact target addresses under a different storage key through compaction and restart', () => {
    const file = path.join(dir, 'addressed-family.sqlite3');
    const store = KnowledgeHistoryStore.open(file);
    const key = 'future:canonical-family';
    const id = 'future:surface:exact-alias';
    store.appendEvents({ [key]: [
      { t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', quality: 'fluent', easeAfter: 2.5, attemptId: 'acquisition-anchor' },
      { t: 20 * DAY, kind: 'rating', source: 'manual', attemptId: 'old-alias', quality: 'fluent', easeAfter: 2.5,
        targetRef: { kind: 'surface', id, capability: 'sense-recognition' } },
    ] });
    expect(store.queryAddressedKeys('future', [id])).toEqual([key]);
    expect(store.queryAddressedIds([key])).toEqual([id]);
    expect(store.queryAddressedKeys('other', [id])).toEqual([]);
    store.compact(800 * DAY);
    expect(store.getExactEvents([key])[key].every(event => event.targetRef?.id !== id)).toBe(true);
    store.close();
    const resumed = KnowledgeHistoryStore.open(file);
    expect(resumed.queryAddressedKeys('future', [id])).toEqual([key]);
    expect(resumed.queryAddressedIds([key])).toEqual([id]);
    resumed.close();
    // An existing journal created before the derived address index is rebuilt
    // from archived evidence, without altering its authored rows.
    const oldDatabase = new DatabaseSync(file);
    oldDatabase.exec("DELETE FROM archived_addresses; DELETE FROM meta WHERE key = 'archived-address-index-v1'");
    oldDatabase.close();
    const upgraded = KnowledgeHistoryStore.open(file);
    expect(upgraded.queryAddressedKeys('future', [id])).toEqual([key]);
    upgraded.resetForReimport();
    expect(upgraded.queryAddressedKeys('future', [id])).toEqual([]);
    expect(upgraded.queryAddressedIds([key])).toEqual([]);
    upgraded.close();
  });

  it('retains durable claim withdrawals through restart without claiming an exact entity for the whole word', () => {
    const file = path.join(dir, 'claim-markers.sqlite3');
    const first = KnowledgeHistoryStore.open(file);
    const key = 'xx:word';
    first.appendEvents({ [key]: [
      { t: 1, kind: 'claim', source: 'manual', aspect: 'reading', toStatus: 'known' },
      { t: 1, kind: 'claim', source: 'manual', aspect: 'reading' },
      { t: 2, kind: 'claim', source: 'manual', toStatus: 'known', targetRef: { kind: 'x::relation', id: 'x:exact', capability: 'x::novel' } },
    ] });
    const state = first.getKnowledgeState(key);
    expect(state.claimMarkers?.['surface-reading']).toMatchObject({ t: 1 });
    expect(state.claimMarkers?.['surface-reading']).not.toHaveProperty('status');
    expect(state.capabilities?.['x::novel']).toBeUndefined();
    expect(first.getExactEvents([key])[key]).toHaveLength(3);
    first.close();
    const restarted = KnowledgeHistoryStore.open(file);
    expect(restarted.getKnowledgeState(key)).toEqual(state);
    restarted.close();
  });

  it('accepts a finite delivered-item seed and rejects malformed seed provenance', () => {
    const event = attemptEvent({
      t: 1,
      itemRef: { id: 'de-weil-fieber-1', version: 'item-v2:1234567890abcdef', seed: 314159 },
    });
    expect(isKnowledgeEvent(event)).toBe(true);
    expect(isKnowledgeEvent({ ...event, itemRef: { ...event.itemRef!, seed: Number.NaN } })).toBe(false);
    expect(isKnowledgeEvent({ ...event, itemRef: { ...event.itemRef!, seed: '314159' } })).toBe(false);
  });

  it('keeps capability projections independent through archival and retraction', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    const key = 'xx:word';
    s.appendEvents({ [key]: [
      { t: old, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 2.5, attemptId: 'meaning' },
      { t: old + 30 * DAY, kind: 'rating', source: 'manual', aspect: 'reading', easeAfter: 1.3, attemptId: 'reading' },
      { t: old + 30 * DAY, kind: 'review', source: 'srs', rating: 'good', easeAfter: 3.0, attemptId: 'reading', schedulerCardId: 'card' },
    ] });
    const expected = s.getKnowledgeState(key).capabilities;
    expect(expected?.['sense-recognition']?.ease).toBe(2.5);
    expect(expected?.['surface-reading']?.ease).toBe(1.3);
    expect(s.getExactEvents([key])[key]).toHaveLength(3);
    s.compact(now);
    expect(s.getKnowledgeState(key).capabilities).toEqual(expected);
    s.appendEvents({ [key]: [{ t: now, kind: 'retraction', source: 'manual', retracts: 'reading' }] });
    const retracted = s.getKnowledgeState(key).capabilities;
    expect(retracted?.['sense-recognition']?.ease).toBe(2.5);
    expect(retracted?.['surface-reading']).toBeUndefined();
    s.close();
  });

  it('rebuilds old mixed Anki archive folds without losing review retraction or audit rows', () => {
    const now = Date.now();
    const s = store();
    const key = 'xx:snapshot-migration';
    s.appendEvents({ [key]: [
      { t: now - 500 * DAY, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 1.3, attemptId: 'anchor' },
      { t: now - 400 * DAY, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 1600, rating: 'hard', attemptId: 'real-review', ankiReviewId: 1 },
      { t: now - 390 * DAY, kind: 'status', source: 'anki', aspect: 'meaning', easeAfter: 3000, toStatus: 'known' },
      { t: now, kind: 'status', source: 'anki', aspect: 'meaning', easeAfter: 3000, toStatus: 'known' },
    ] });
    s.compact(now);
    const before = s.getKnowledgeState(key);
    expect(before.capabilities?.['sense-recognition']?.ease).toBe(1.55);
    s.close();

    const db = new DatabaseSync(path.join(dir, 'knowledge-history.sqlite3'));
    const row = db.prepare('SELECT json FROM archives WHERE key = ?').get(key);
    if (!row || typeof row.json !== 'string') expect.fail('archive missing');
    const archive: KeyArchive = JSON.parse(row.json);
    delete archive.measurableVersion;
    for (const bucket of Object.values(archive.buckets)) {
      bucket.measurableFold = bucket.fold;
      bucket.ratings.push({ t: now - 390 * DAY, seq: 999, rating: 'easy' });
    }
    db.prepare('UPDATE archives SET json = ? WHERE key = ?').run(JSON.stringify(archive), key);
    db.close();

    const reopened = store();
    expect(reopened.getKnowledgeState(key).capabilities).toEqual(before.capabilities);
    expect(reopened.getKnowledgeState(key).projection).toEqual(before.projection);
    expect(Object.values(reopened.getArchive(key)?.buckets ?? {}).flatMap((bucket) => bucket.ratings)).toHaveLength(1);
    expect(reopened.getKnowledgeState(key).archivedEventCount).toBe(before.archivedEventCount);
    reopened.appendEvents({ [key]: [{ t: now + 1, kind: 'retraction', source: 'manual', retracts: 'real-review' }] });
    expect(reopened.getKnowledgeState(key).capabilities?.['sense-recognition']?.ease).toBe(1.3);
    expect(reopened.getExactEvents([key])[key].some((event) => event.kind === 'status' && event.source === 'anki')).toBe(true);
    reopened.close();
  });

  it('withholds uncertain measurable support when an old archive has no complete records', () => {
    const now = Date.now();
    const s = store();
    const key = 'xx:recordless';
    s.appendEvents({ [key]: [ankiReview(now - 500 * DAY, 1.3), ankiStatus(now - 400 * DAY, 'known')] });
    s.compact(now);
    s.close();
    const db = new DatabaseSync(path.join(dir, 'knowledge-history.sqlite3'));
    const row = db.prepare('SELECT json FROM archives WHERE key = ?').get(key);
    if (!row || typeof row.json !== 'string') expect.fail('archive missing');
    const archive: KeyArchive = JSON.parse(row.json);
    delete archive.measurableVersion;
    archive.v = 1;
    db.prepare('UPDATE archives SET json = ? WHERE key = ?').run(JSON.stringify(archive), key);
    db.prepare('DELETE FROM bucket_recs WHERE key = ?').run(key);
    db.close();
    const reopened = store();
    const restored = reopened.getArchive(key);
    expect(restored?.measurableRebuildIncomplete).toBe(true);
    expect(restored?.archivedEventCount).toBe(1);
    expect(Object.values(restored?.buckets ?? {}).every((bucket) => bucket.measurableFold.hasEvidence === false)).toBe(true);
    reopened.close();
  });

  it('round-trips appends through exact rows and derives matching projections', () => {
    const s = store();
    const now = Date.now();
    const events: KnowledgeEventLog = {
      'ja:h1': [ankiReview(now - DAY, 2.8), ankiStatus(now - 3600_000, 'known')],
    };
    s.appendEvents(events);
    const exact = s.getExactEvents(['ja:h1']);
    expect(exact['ja:h1']).toHaveLength(2);
    const state = s.getKnowledgeState('ja:h1');
    expect(state.projection).toEqual(replayKeyProjection(events['ja:h1']));
    expect(state.hasArchive).toBe(false);
    s.close();
  });

  it('ages a native attempt into the archive with a contribution record, then retracts it exactly', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    const attemptId = 'attempt-ancient';
    const log: KnowledgeEventLog = {
      'ja:h1': [
        ankiReview(old - 200 * DAY, 1.5, 1001),
        ankiReview(old - 100 * DAY, 2.2, 1002),
        { ...attemptEvent({ t: old }), attemptId, easeAfter: 3.1, method: 'recall', quality: 'fluent' },
        ankiReview(old + 30 * DAY, 2.4, 1003),
        ankiReview(old + 60 * DAY, 2.6, 1004),
        ankiReview(now - DAY, 2.9, 1005),
      ],
    };
    s.appendEvents(log);
    expect(s.compact(now)).toBe(1);

    // (1-3) The attempt aged out: no exact row remains, but the contribution
    // index still points at its archived bucket.
    const archive = s.getArchive('ja:h1');
    expect(archive).toBeDefined();
    expect(archive!.archivedEventCount).toBeGreaterThan(0);
    const exact = s.getExactEvents(['ja:h1'])['ja:h1'];
    expect(exact.some((event) => event.attemptId === attemptId)).toBe(false);
    expect(s.hasAttemptRecords('ja:h1', [attemptId])).toEqual([true]);

    // (7) Projection equivalence before retraction.
    const state = s.getKnowledgeState('ja:h1');
    expect(state.projection).toEqual(replayKeyProjection(log['ja:h1']));

    // (5-6) Ancient retraction: tombstone reverses the archived contribution.
    s.appendEvents({ 'ja:h1': [{ t: now, kind: 'retraction', source: 'manual', retracts: attemptId }] });
    const afterRetract = s.getKnowledgeState('ja:h1');
    const rawWithRetraction = [...log['ja:h1'], { t: now, kind: 'retraction', source: 'manual', retracts: attemptId } as KnowledgeEvent];
    expect(afterRetract.projection).toEqual(replayKeyProjection(rawWithRetraction));

    // The contribution record is consumed; a duplicate tombstone is a no-op.
    expect(s.hasAttemptRecords('ja:h1', [attemptId])).toEqual([false]);
    s.appendEvents({ 'ja:h1': [{ t: now + 1, kind: 'retraction', source: 'manual', retracts: attemptId }] });
    const rawDoubleRetracted = [...rawWithRetraction, { t: now + 1, kind: 'retraction', source: 'manual', retracts: attemptId } as KnowledgeEvent];
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(rawDoubleRetracted));
    s.close();
  });

  it('imports a legacy JSON log with per-key projection equivalence and is idempotent', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    const legacy: KnowledgeEventLog = {
      'ja:h1': [ankiReview(old, 1.4, 2001), ankiReview(old + DAY, 2.5, 2002), attemptEvent({ t: now - DAY })],
      'ja:h2': [ankiStatus(old, 'known'), { t: old + 100, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'learning' }],
    };
    const first = s.importLegacyLog(legacy, now);
    expect(first.verified).toBe(true);
    expect(first.events).toBe(5);

    for (const [key, events] of Object.entries(legacy)) {
      expect(s.getKnowledgeState(key).projection).toEqual(replayKeyProjection(events));
    }

    // Idempotent: re-import imports nothing and stays verified.
    const second = s.importLegacyLog(legacy, now);
    expect(second.events).toBe(0);
    expect(second.verified).toBe(true);
    s.close();
  });

  it('keeps projections exact when sync appends land out of order below the archive frontier', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(old, 1.6, 3001), ankiReview(old + DAY, 2.4, 3002), ankiReview(now - DAY, 2.7, 3003)] });
    s.compact(now);

    // Tethered sync journals a row with an old recency anchor (below frontier).
    const lateRow = ankiReview(old + 12 * 3600_000, 3.2);
    s.appendEvents({ 'ja:h1': [lateRow] });

    const raw = [ankiReview(old, 1.6, 3001), lateRow, ankiReview(old + DAY, 2.4, 3002), ankiReview(now - DAY, 2.7, 3003)];
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(raw));
    s.close();
  });

  it('rebuilds checkpoints from canonical rows + archives with identical results', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(old, 1.8, 4001), ankiReview(now - 2 * DAY, 2.6, 4002)] });
    s.compact(now);
    const before = s.getKnowledgeState('ja:h1').projection;
    s.rebuildCheckpoints();
    const after = s.getKnowledgeState('ja:h1').projection;
    expect(after).toEqual(before);
    s.close();
  });

  it('reports anki review id presence across exact rows and archives', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(old, 1.5, 5001), ankiReview(now - DAY, 2.0, 5002)] });
    s.compact(now);
    const [archivedId, exactId, missingId] = s.hasAnkiReviewIds('ja', [5001, 5002, 9999]);
    expect(archivedId).toBe(true);
    expect(exactId).toBe(true);
    expect(missingId).toBe(false);
    s.close();
  });

  it('compaction is incremental: a second pass merges into the existing archive', () => {
    const s = store();
    const now = Date.now();
    const old = now - 500 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(old, 1.5, 7001), ankiReview(old + 40 * DAY, 2.5, 7002)] });
    expect(s.compact(now)).toBe(1);
    const firstArchive = s.getArchive('ja:h1')!;
    const firstCount = firstArchive.archivedEventCount;

    // Later rows cross the tail boundary; the second pass must merge into
    // (not replace) the archive.
    const mid = now - 200 * DAY;
    s.appendEvents({ 'ja:h1': [ankiReview(mid, 2.8, 7003)] });
    s.compact(now + 30 * DAY);
    const secondArchive = s.getArchive('ja:h1')!;
    expect(secondArchive.archivedEventCount).toBe(firstCount + 1);
    expect(secondArchive.ankiReviewIds).toContain(7002);
    expect(secondArchive.ankiReviewIds).toContain(7003);
    // 7001 sits inside the key's acquisition window — it stays exact forever.
    expect(s.getExactEvents(['ja:h1'])['ja:h1'].some((event) => event.ankiReviewId === 7001)).toBe(true);
    s.close();
  });

  it('preserves same-timestamp journal order across the archive frontier', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    // An older anchor keeps the pair outside the acquisition window, so the
    // equal-t rows land in the archive: the LATER-inserted one must win.
    const anchor = ankiReview(old, 1.5, 8000);
    const first = ankiReview(old + 90 * DAY, 1.4, 8001);
    const second = ankiReview(old + 90 * DAY, 3.0, 8002);
    s.appendEvents({ 'ja:h1': [anchor, first, second, ankiReview(now - DAY, 2.2, 8003)] });
    s.compact(now);
    expect(s.getArchive('ja:h1')).toBeDefined();
    const raw = [anchor, first, second, ankiReview(now - DAY, 2.2, 8003)];
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(raw));
    expect(s.getKnowledgeState('ja:h1').projection?.evidenceSource).toBe('anki');
    s.close();
  });

  it('keeps seq unique and monotonic across restart cycles', () => {
    const dbPath = path.join(dir, 'knowledge-history.sqlite3');
    const first = KnowledgeHistoryStore.open(dbPath);
    first.appendEvents({ 'ja:h1': [ankiReview(NOW_VAL(), 2.0), ankiReview(NOW_VAL() + 1, 2.1)] });
    first.close();

    // Restart: counter must persist — no seq reuse, strictly increasing.
    const second = KnowledgeHistoryStore.open(dbPath);
    second.appendEvents({ 'ja:h1': [ankiReview(NOW_VAL() + 2, 2.2)] });
    const rows = second.rowsWithSeq('ja:h1');
    const seqs = rows.map(({ seq }) => seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    second.close();
  });

  it('compaction respects the per-pass key budget', () => {
    const s = store();
    const now = Date.now();
    const old = now - 400 * DAY;
    const log: KnowledgeEventLog = {};
    for (let i = 0; i < COMPACTION_KEY_BUDGET + 10; i++) {
      // One acquisition-window row + one archiveable row per key.
      log[`ja:k${i}`] = [ankiReview(old, 1.5, 6000 + i), ankiReview(old + 30 * DAY, 2.0, 6500 + i)];
    }
    s.appendEvents(log);
    const compacted = s.compact(now);
    expect(compacted).toBe(COMPACTION_KEY_BUDGET);
    s.close();
  });

  it('keeps folds seq-aligned when malformed events interleave with valid ones', () => {
    const s = store();
    const now = NOW_VAL();
    const recent = now - DAY;
    const good: KnowledgeEvent = { ...attemptEvent({ t: recent }), attemptId: 'attempt-good', easeAfter: 2.7 };
    const tombstone: KnowledgeEvent = { t: now, kind: 'retraction', source: 'manual', retracts: 'attempt-good' };
    s.appendEvents({ 'ja:m1': [good] });
    // A malformed row sits between two valid ones; seqs must still align.
    s.appendEvents({
      'ja:m1': [
        { t: now - 1000, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.4, rating: 'good', timesSeenDelta: 1, ankiReviewId: 77 },
        { totally: 'malformed' } as unknown as KnowledgeEvent,
        { t: now - 500, kind: 'status', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 2 },
        tombstone,
      ],
    });
    const raw: KnowledgeEvent[] = [
      good,
      { t: now - 1000, kind: 'review', source: 'anki', aspect: 'meaning', easeAfter: 2.4, rating: 'good', timesSeenDelta: 1, ankiReviewId: 77 },
      { t: now - 500, kind: 'status', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 2 },
      tombstone,
    ];
    expect(s.getKnowledgeState('ja:m1').projection).toEqual(replayKeyProjection(raw));
    s.close();
  });

  it('compaction converges: a second pass over unchanged keys moves nothing', () => {
    const s = store();
    const now = NOW_VAL();
    const old = now - 400 * DAY;
    s.appendEvents({
      'ja:c1': [
        ankiReview(old, 2.0, 51),
        { ...attemptEvent({ t: old + 30 * DAY }), attemptId: 'attempt-c1', easeAfter: 2.7 },
        { ...attemptEvent({ t: old + 60 * DAY }), attemptId: 'attempt-c2', easeAfter: 2.4 },
        ankiReview(now - DAY, 2.9, 52),
      ],
    });
    expect(s.compact(now)).toBe(1);
    // The archive frontier is now settled: identical input, nothing left to move.
    expect(s.compact(now)).toBe(0);
    expect(s.compact(now)).toBe(0);
    // Every key eventually receives coverage despite the bounded window —
    // including keys ordered AFTER the window's edge.
    for (let k = 0; k < 6; k++) s.compact(now);
    expect(s.getArchive('ja:c1')).toBeDefined();
    expect(s.getKnowledgeState('ja:c1').projection).toEqual(replayKeyProjection([
      ankiReview(old, 2.0, 51),
      { ...attemptEvent({ t: old + 30 * DAY }), attemptId: 'attempt-c1', easeAfter: 2.7 },
      { ...attemptEvent({ t: old + 60 * DAY }), attemptId: 'attempt-c2', easeAfter: 2.4 },
      ankiReview(now - DAY, 2.9, 52),
    ]));
    s.close();
  });

  it('starvation guard: keys beyond the candidate window still compact', () => {
    const s = store();
    const now = NOW_VAL();
    const old = now - 400 * DAY;
    const log: KnowledgeEventLog = {};
    for (let k = 0; k < 10; k++) {
      log[`ja:w${k}`] = [
        ankiReview(old - 100 * DAY, 2.0, 60 + k),
        { ...attemptEvent({ t: old + 30 * DAY }), attemptId: `attempt-w${k}`, easeAfter: 2.7 },
        ankiReview(now - DAY, 2.9, 70 + k),
      ];
    }
    s.appendEvents(log);
    // maxKeys=3 with 10 candidate keys: the window must not strand the tail.
    let moved = 0;
    for (let pass = 0; pass < 20; pass++) {
      moved += s.compact(now, 3);
    }
    expect(moved).toBe(10);
    for (let k = 0; k < 10; k++) {
      expect(s.getArchive(`ja:w${k}`)).toBeDefined();
    }
    s.close();
  });

  it('retracts oldest and newest archived attempts, rerates, and spans sibling keys', () => {
    const s = store();
    const now = NOW_VAL();
    const old = now - 500 * DAY;
    const attemptA = 'attempt-a';
    const attemptB = 'attempt-b';
    const log: KnowledgeEventLog = {
      'ja:h1': [
        ankiReview(old, 2.0, 1),
        { ...attemptEvent({ t: old + 30 * DAY }), attemptId: attemptA, easeAfter: 3.0 },
        ankiReview(old + 60 * DAY, 2.4, 2),
        { ...attemptEvent({ t: old + 90 * DAY }), attemptId: attemptB, easeAfter: 1.8, rating: 'again' },
        ankiReview(now - DAY, 2.9, 3),
      ],
      // The same attempt fans out to a sibling form key (multi-target attempt).
      'ja:h2': [{ ...attemptEvent({ t: old + 30 * DAY }), attemptId: attemptA, easeAfter: 3.0, timesSeenDelta: 1 }],
    };
    s.appendEvents(log);
    s.compact(now);

    // Retract the OLDEST archived attempt.
    s.appendEvents({ 'ja:h1': [{ t: now, kind: 'retraction', source: 'manual', retracts: attemptA }] });
    s.appendEvents({ 'ja:h2': [{ t: now, kind: 'retraction', source: 'manual', retracts: attemptA }] });
    const retractA = [...log['ja:h1'], { t: now, kind: 'retraction', source: 'manual', retracts: attemptA } as KnowledgeEvent];
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(retractA));
    const retractA2 = [...log['ja:h2'], { t: now, kind: 'retraction', source: 'manual', retracts: attemptA } as KnowledgeEvent];
    expect(s.getKnowledgeState('ja:h2').projection).toEqual(replayKeyProjection(retractA2));

    // Retract the NEWEST archived attempt on the sibling-heavy bucket.
    s.appendEvents({ 'ja:h1': [{ t: now + 1, kind: 'retraction', source: 'manual', retracts: attemptB }] });
    const retractBoth = [...retractA, { t: now + 1, kind: 'retraction', source: 'manual', retracts: attemptB } as KnowledgeEvent];
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(retractBoth));

    // Rerate after compaction: a fresh attempt plus retraction of the rerated one.
    s.appendEvents({
      'ja:h1': [
        { ...attemptEvent({ t: now + 2, kind: 'rating' }), attemptId: 'attempt-rerate', easeAfter: 2.6 },
        { t: now + 3, kind: 'retraction', source: 'manual', retracts: 'attempt-rerate' },
      ],
    });
    const afterRerate = [...retractBoth,
      { ...attemptEvent({ t: now + 2, kind: 'rating' }), attemptId: 'attempt-rerate', easeAfter: 2.6 } as KnowledgeEvent,
      { t: now + 3, kind: 'retraction', source: 'manual', retracts: 'attempt-rerate' } as KnowledgeEvent,
    ];
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(afterRerate));

    // Checkpoint rebuild from canonical rows + archives stays equivalent.
    s.rebuildCheckpoints();
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(afterRerate));
    s.close();
  });

  it('keeps cross-language attempt ids independent', () => {
    const s = store();
    const now = NOW_VAL();
    const old = now - 400 * DAY;
    s.appendEvents({
      'ja:w1': [ankiReview(old - 100 * DAY, 2.1, 41), { ...attemptEvent({ t: old }), attemptId: 'shared-attempt', easeAfter: 3.2 }],
      'zh:w1': [ankiReview(old - 100 * DAY, 2.3, 42), { ...attemptEvent({ t: old }), attemptId: 'shared-attempt', easeAfter: 1.9 }],
    });
    s.compact(now);
    expect(s.hasAttemptRecords('ja:w1', ['shared-attempt'])).toEqual([true]);
    expect(s.hasAttemptRecords('zh:w1', ['shared-attempt'])).toEqual([true]);

    // Retracting in one language must not touch the other.
    s.appendEvents({ 'ja:w1': [{ t: now, kind: 'retraction', source: 'manual', retracts: 'shared-attempt' }] });
    const jaRaw = [ankiReview(old - 100 * DAY, 2.1, 41), { ...attemptEvent({ t: old }), attemptId: 'shared-attempt', easeAfter: 3.2 } as KnowledgeEvent, { t: now, kind: 'retraction', source: 'manual', retracts: 'shared-attempt' } as KnowledgeEvent];
    const zhRaw = [ankiReview(old - 100 * DAY, 2.3, 42), { ...attemptEvent({ t: old }), attemptId: 'shared-attempt', easeAfter: 1.9 } as KnowledgeEvent];
    expect(s.getKnowledgeState('ja:w1').projection).toEqual(replayKeyProjection(jaRaw));
    expect(s.getKnowledgeState('zh:w1').projection).toEqual(replayKeyProjection(zhRaw));
    expect(s.hasAttemptRecords('zh:w1', ['shared-attempt'])).toEqual([true]);
    s.close();
  });

  it('rolls back the whole compaction transaction when a write fails mid-pass', () => {
    const s = store();
    const now = NOW_VAL();
    const old = now - 400 * DAY;
    const log: KnowledgeEventLog = { 'ja:h1': [ankiReview(old - 100 * DAY, 1.9, 8), ankiReview(old, 2.0, 9), { ...attemptEvent({ t: old + 30 * DAY }), attemptId: 'attempt-x', easeAfter: 2.8 }] };
    s.appendEvents(log);

    // Crash between the archive write and the contribution-index write:
    // make the attempt_index INSERT fail once, mid-transaction.
    const internal = s as unknown as { db: { prepare: (sql: string) => unknown } };
    const originalPrepare = internal.db.prepare.bind(internal.db);
    let failNextAttemptInsert = true;
    internal.db.prepare = (sql: string) => {
      if (failNextAttemptInsert && sql.includes('INSERT OR REPLACE INTO attempt_index')) {
        failNextAttemptInsert = false;
        throw new Error('simulated crash between archive and index write');
      }
      return originalPrepare(sql);
    };
    expect(() => s.compact(now)).toThrow('simulated crash between archive and index write');
    internal.db.prepare = originalPrepare;

    // Atomic rollback: no archive, no records, no lost rows.
    expect(s.getArchive('ja:h1')).toBeUndefined();
    expect(s.hasAttemptRecords('ja:h1', ['attempt-x'])).toEqual([false]);
    const state = s.getKnowledgeState('ja:h1');
    expect(state.projection).toEqual(replayKeyProjection(log['ja:h1']));
    // Retry after the crash succeeds and preserves equivalence.
    expect(s.compact(now)).toBe(1);
    expect(s.getKnowledgeState('ja:h1').projection).toEqual(replayKeyProjection(log['ja:h1']));
    s.close();
  });

  it('reclassifies a v1 store from its backup with projection equivalence and resume safety', () => {
    const s = store();
    const now = NOW_VAL();
    const old = now - 400 * DAY;
    // Simulate a v1 database: schemaVersion 1, exact attempt rows, no records.
    const backup: KnowledgeEventLog = {
      'ja:v1': [
        ankiReview(old, 2.0, 21),
        { ...attemptEvent({ t: old + 30 * DAY }), attemptId: 'attempt-v1', easeAfter: 3.1 },
        ankiReview(old + 60 * DAY, 2.5, 22),
      ],
    };
    s.importLegacyLog(JSON.parse(JSON.stringify(backup)), now);
    s.markSchemaVersion(1);

    const first = s.reclassifyFromBackup(JSON.parse(JSON.stringify(backup)), now);
    expect(first.verified).toBe(true);
    expect(s.schemaVersion).toBe(3);
    // The old attempt compacted with a contribution record.
    expect(s.hasAttemptRecords('ja:v1', ['attempt-v1'])).toEqual([true]);
    expect(s.getKnowledgeState('ja:v1').projection).toEqual(replayKeyProjection(backup['ja:v1']));

    // Idempotent: a second run rewrites nothing and stays verified.
    const second = s.reclassifyFromBackup(JSON.parse(JSON.stringify(backup)), now);
    expect(second.verified).toBe(true);
    expect(s.getKnowledgeState('ja:v1').projection).toEqual(replayKeyProjection(backup['ja:v1']));
    s.close();
  });

  it('defers markerless v1 keys instead of speculatively reclassifying them', () => {
    const s = store();
    const now = NOW_VAL();
    const old = now - 400 * DAY;
    const backup: KnowledgeEventLog = {
      'ja:v1': [ankiReview(old - 100 * DAY, 1.8, 31), ankiReview(old, 2.0, 32), { ...attemptEvent({ t: old + 30 * DAY }), attemptId: 'attempt-legacy', easeAfter: 3.0 }],
    };
    // Pre-record v1 state: raw rows and a v1 schema marker — no import
    // markers, no contribution records (appendEvents never compacted).
    s.appendEvents(backup);
    s.markSchemaVersion(1);
    const result = s.reclassifyFromBackup(JSON.parse(JSON.stringify(backup)), now);
    expect(result.skipped).toBe(1);
    // The key was skipped: its attempt remains exact (still retractable), and
    // the schema version flipped without touching the key.
    expect(s.hasAttemptRecords('ja:v1', ['attempt-legacy'])).toEqual([false]);
    const exact = s.getExactEvents(['ja:v1'])['ja:v1'];
    expect(exact.some((event) => event.attemptId === 'attempt-legacy')).toBe(true);
    expect(s.getKnowledgeState('ja:v1').projection).toEqual(replayKeyProjection(backup['ja:v1']));
    s.close();
  });
});
