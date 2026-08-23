import { describe, expect, it } from 'vitest';
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
});
