import { describe, expect, it } from 'vitest';
import { GRAMMAR_ENCOUNTER_EASE_BUMP, GRAMMAR_FAIL_EASE_PENALTY, initialGrammarEase } from '../utils/grammarPolicy';
import { grammarEvidenceKey, grammarRecognitionEvidence, grammarTarget, replayGrammarRecognition } from './evidence';
import type { KnowledgeEvent } from '../knowledgeEvents';

describe('grammar capability evidence', () => {
  it('Anki grammar recognition does not become production evidence', () => {
    const recognition = grammarTarget('ja', 'ている', 'grammar-recognition');
    const formation = grammarTarget('ja', 'ている', 'grammar-formation');
    const event = grammarRecognitionEvidence('ja', 'ている', { t: 1, kind: 'rating', easeAfter: 3 });

    expect(event.targetRef).toEqual({ kind: 'grammar-pattern', id: recognition.entityId, capability: recognition.capability });
    expect(grammarEvidenceKey('ja', 'ている', 'grammar-recognition')).not.toBe(
      grammarEvidenceKey('ja', 'ている', 'grammar-formation'),
    );
  });

  it('does not transfer mastery across contrasted constructions', () => {
    const a = grammarEvidenceKey('ru', 'в/на + accusative', 'grammar-recognition');
    const b = grammarEvidenceKey('ru', 'в/на + prepositional', 'grammar-recognition');
    const event = grammarRecognitionEvidence('ru', 'в/на + accusative', {
      t: 1,
      kind: 'rating',
      easeAfter: 4,
      timesSeenDelta: 1,
    });

    expect(replayGrammarRecognition([event])?.ease).toBe(4);
    expect(replayGrammarRecognition([])).toBeNull();
    expect(a).not.toBe(b);
  });

  it('replays migrated ease counters as recognition-only provenance', () => {
    const migrated = {
      ...grammarRecognitionEvidence('ja', 'ている', { t: 10, kind: 'rollup' }),
      origin: 'grammar-legacy-migration',
      easeAfter: 2.7,
      timesSeenDelta: 8,
      grammarFailedDelta: 2,
    };

    expect(replayGrammarRecognition([migrated])).toMatchObject({ ease: 2.7, timesEncountered: 8, timesFailed: 2 });
  });

  it('derives ease from encounter/failure deltas when no outcome is recorded', () => {
    const encounter = grammarRecognitionEvidence('ja', 'ている', { t: 1, kind: 'rollup', timesSeenDelta: 1, origin: 'grammar-encounter' });
    const failure = grammarRecognitionEvidence('ja', 'ている', { t: 2, kind: 'rollup', grammarFailedDelta: 1, origin: 'grammar-failure' });

    const projection = replayGrammarRecognition([encounter, failure]);
    expect(projection).toMatchObject({ timesEncountered: 1, timesFailed: 1, firstSeen: 1, lastSeen: 2 });
    expect(projection!.ease).toBeCloseTo(initialGrammarEase() + GRAMMAR_ENCOUNTER_EASE_BUMP - GRAMMAR_FAIL_EASE_PENALTY, 10);
  });

  it('explicit outcomes override delta-derived ease in mixed logs', () => {
    const encounter = grammarRecognitionEvidence('ja', 'ている', { t: 1, kind: 'rollup', timesSeenDelta: 1, origin: 'grammar-encounter' });
    const migrated = {
      ...grammarRecognitionEvidence('ja', 'ている', { t: 2, kind: 'rollup' }),
      origin: 'grammar-legacy-migration',
      easeAfter: 3.1,
      timesSeenDelta: 2,
      grammarFailedDelta: 1,
    };
    const after = grammarRecognitionEvidence('ja', 'ている', { t: 3, kind: 'rollup', grammarFailedDelta: 1, origin: 'grammar-failure' });

    const projection = replayGrammarRecognition([encounter, migrated, after]);
    expect(projection).toMatchObject({ timesEncountered: 3, timesFailed: 2 });
    expect(projection!.ease).toBeCloseTo(Math.max(3.1 - GRAMMAR_FAIL_EASE_PENALTY, 0), 10);
  });

  it('floors delta-derived failures at the policy floor', () => {
    const failure = grammarRecognitionEvidence('ja', 'ている', { t: 1, kind: 'rollup', grammarFailedDelta: 10, origin: 'grammar-failure' });

    expect(replayGrammarRecognition([failure])!.ease).toBe(0);
  });
});

describe('item-backed attempts: repeated-item familiarity (G02)', () => {
  const rating = (t: number, ease: number, itemRef?: { id: string; version: string }, extra: Partial<KnowledgeEvent> = {}) =>
    grammarRecognitionEvidence('ja', 'のに', { t, kind: 'rating', quality: 'fluent', easeAfter: ease, ...(itemRef ? { itemRef } : {}), ...extra });

  it('a repeated success on the same item never raises the projection', () => {
    const ref = { id: 'ja-noni-1', version: 'item-v1:1111111111111111' };
    const projection = replayGrammarRecognition([rating(1, 1.6, ref), rating(2, 3.0, ref)]);
    // The repeat success stays measured but does not upgrade the ease:
    // recognition of one memorized item is not fresh generalization (G02).
    expect(projection!.ease).toBeCloseTo(1.6, 10);
    expect(projection!.hasActiveEvidence).toBe(true);
  });

  it('a success on a fresh item after a success on another item applies fully', () => {
    const first = replayGrammarRecognition([rating(1, 1.6, { id: 'ja-noni-1', version: 'v' })]);
    const both = replayGrammarRecognition([
      rating(1, 1.6, { id: 'ja-noni-1', version: 'v' }),
      rating(2, 3.0, { id: 'ja-noni-2', version: 'v' }),
    ]);
    expect(both!.ease).toBe(3.0);
    expect(first!.ease).toBeCloseTo(1.6, 10);
  });

  it('the same item under a different content version is a different item', () => {
    const projection = replayGrammarRecognition([
      rating(1, 1.6, { id: 'ja-noni-1', version: 'item-v1:1111111111111111' }),
      rating(2, 3.0, { id: 'ja-noni-1', version: 'item-v1:2222222222222222' }),
    ]);
    expect(projection!.ease).toBe(3.0);
  });

  it('a repeated FAILURE on the same item keeps its full force', () => {
    const failure = (t: number, ref: { id: string; version: string }) =>
      grammarRecognitionEvidence('ja', 'のに', { t, kind: 'rating', quality: 'missed', grammarFailedDelta: 1, itemRef: ref });
    const ref = { id: 'ja-noni-1', version: 'v' };
    const once = replayGrammarRecognition([rating(1, 3.0, ref), failure(2, ref)]);
    const twice = replayGrammarRecognition([rating(1, 3.0, ref), failure(2, ref), failure(3, ref)]);
    expect(twice!.ease).toBeCloseTo(once!.ease - GRAMMAR_FAIL_EASE_PENALTY, 10);
    expect(twice!.timesFailed).toBe(2);
  });

  it('retraction of the earlier attempt restores the later success to full force', () => {
    const ref = { id: 'ja-noni-1', version: 'v' };
    const withIds = [
      { ...rating(1, 1.6, ref), attemptId: 'a1' },
      { ...rating(2, 3.0, ref), attemptId: 'a2' },
      { t: 3, kind: 'retraction', source: 'manual', retracts: 'a1' } as unknown as KnowledgeEvent,
    ];
    // Undoing the first attempt removes it from the replay, so the second
    // success is again the FIRST attempt on this item (G02 honesty).
    expect(replayGrammarRecognition(withIds)!.ease).toBe(3.0);
  });
});
