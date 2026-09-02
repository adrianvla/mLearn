import { describe, expect, it } from 'vitest';
import { GRAMMAR_ENCOUNTER_EASE_BUMP, GRAMMAR_FAIL_EASE_PENALTY, initialGrammarEase } from '../utils/grammarPolicy';
import { grammarEvidenceKey, grammarRecognitionEvidence, grammarTarget, replayGrammarRecognition } from './evidence';

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
