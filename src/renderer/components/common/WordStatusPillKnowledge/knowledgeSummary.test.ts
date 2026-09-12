import { describe, expect, it } from 'vitest';
import { knowledgeStatusLabelKey, projectionStateForCapability, UNMEASURED_LABEL_KEY } from './knowledgeSummary';

describe('knowledge presentation', () => {
  it('keeps unmeasured separate from observed or claimed unknown', () => {
    expect(knowledgeStatusLabelKey('unknown', 'unmeasured')).toBe(UNMEASURED_LABEL_KEY);
    expect(knowledgeStatusLabelKey('unknown', 'evidence')).toBe('mlearn.WordHover.Status.Unknown');
    expect(knowledgeStatusLabelKey('unknown', 'claim')).toBe('mlearn.WordHover.Status.Unknown');
  });
  it('labels prediction distinctly from knowledge', () => {
    expect(knowledgeStatusLabelKey('known', 'prediction')).toBe('mlearn.Knowledge.Projection.Predicted');
  });
  it('does not borrow another capability state', () => {
    expect(projectionStateForCapability({ status: 'ready', targets: [{ targetRef: { kind: 'surface', id: 'a' }, applicableCapabilities: ['sense-recognition'], states: [{ capability: 'sense-recognition', classification: 'known', basis: 'claim', evidence: [], evidenceSourceCounts: {} }] }] }, 'surface-reading')).toBeUndefined();
  });
});
