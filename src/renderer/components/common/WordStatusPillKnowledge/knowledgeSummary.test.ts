import { describe, expect, it } from 'vitest';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import {
  aspectCapabilitySummary,
  isUntrackedKnowledge,
  knowledgeStatusLabelKey,
  UNTRACKED_LABEL_KEY,
} from './knowledgeSummary';

const meaningResult = (overrides: Partial<ComprehensiveWordStatusResult> = {}): ComprehensiveWordStatusResult => ({
  status: 'unknown',
  basis: 'unmeasured',
  evidenceStatus: 'unknown',
  source: 'None',
  timesSeen: 0,
  ...overrides,
});

describe('knowledgeStatusLabelKey', () => {
  it('no evidence + no claim resolves to Untracked, never Unknown', () => {
    expect(isUntrackedKnowledge('unknown', 'unmeasured')).toBe(true);
    expect(knowledgeStatusLabelKey('unknown', 'unmeasured')).toBe(UNTRACKED_LABEL_KEY);
  });

  it('an explicit Unknown claim resolves to Unknown', () => {
    expect(isUntrackedKnowledge('unknown', 'claim')).toBe(false);
    expect(knowledgeStatusLabelKey('unknown', 'claim')).toBe('mlearn.WordHover.Status.Unknown');
  });

  it('evidence-backed unknown resolves to Unknown', () => {
    expect(isUntrackedKnowledge('unknown', 'evidence')).toBe(false);
    expect(knowledgeStatusLabelKey('unknown', 'evidence')).toBe('mlearn.WordHover.Status.Unknown');
  });

  it('Learning and Known keep their labels regardless of basis', () => {
    expect(knowledgeStatusLabelKey('learning', 'claim')).toBe('mlearn.WordHover.Status.Learning');
    expect(knowledgeStatusLabelKey('learning', 'evidence')).toBe('mlearn.WordHover.Status.Learning');
    expect(knowledgeStatusLabelKey('known', 'claim')).toBe('mlearn.WordHover.Status.Known');
    expect(knowledgeStatusLabelKey('known', 'evidence')).toBe('mlearn.WordHover.Status.Known');
  });
});

describe('aspectCapabilitySummary meaning row', () => {
  it('marks unmeasured meaning as untracked so the row renders Untracked', () => {
    const row = aspectCapabilitySummary('meaning', { status: 'unknown', untracked: false }, meaningResult(), undefined);

    expect(row.basis).toBe('unmeasured');
    expect(row.untracked).toBe(true);
    expect(knowledgeStatusLabelKey(row.status, row.basis)).toBe(UNTRACKED_LABEL_KEY);
  });

  it('keeps claim-backed meaning tracked (Known)', () => {
    const row = aspectCapabilitySummary(
      'meaning',
      { status: 'known', untracked: false },
      meaningResult({ status: 'known', basis: 'claim', claim: 'known' }),
      undefined,
    );

    expect(row.basis).toBe('claim');
    expect(row.untracked).toBe(false);
    expect(knowledgeStatusLabelKey(row.status, row.basis)).toBe('mlearn.WordHover.Status.Known');
  });

  it('prediction-basis projection states never become tracked knowledge', () => {
    const projectionState = {
      basis: 'prediction',
      classification: 'unmeasured',
      evidence: [],
      evidenceSourceCounts: {},
      prediction: { value: 0.4, reasons: ['増える → 殖える (semantically-related)'] },
    } as unknown as KnowledgeProjection['targets'][number]['states'][number];
    const row = aspectCapabilitySummary(
      'meaning',
      { status: 'unknown', untracked: true },
      meaningResult(),
      projectionState,
    );

    expect(row.basis).toBe('prediction');
    expect(row.untracked).toBe(true);
    expect(knowledgeStatusLabelKey(row.status, row.basis, row.untracked)).toBe(UNTRACKED_LABEL_KEY);
  });
});
