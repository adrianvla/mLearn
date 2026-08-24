import { describe, expect, it } from 'vitest';
import { assembleTargetExplanation } from './explanations';

const policy = { learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 365 };

describe('assembleTargetExplanation', () => {
  it('excludes retracted attempts from evidence and retention', () => {
    const explanation = assembleTargetExplanation('surface-reading', [
      { t: 1, kind: 'rating', source: 'srs', aspect: 'reading', attemptId: 'undo', rating: 'easy', easeAfter: 3 },
      { t: 2, kind: 'retraction', source: 'srs', aspect: 'reading', retracts: 'undo' },
    ], policy, 3);
    expect(explanation.state).toBe('unmeasured');
    expect(explanation.evidence).toEqual([]);
    expect(explanation.retention).toBeNull();
  });
});
