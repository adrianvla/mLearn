import { describe, expect, it } from 'vitest';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import {
  capabilitySummary,
  isUntrackedKnowledge,
  knowledgeStatusLabelKey,
  projectionStateForCapability,
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

describe('capabilitySummary sense row', () => {
  it('marks unmeasured sense knowledge as untracked so the row renders Untracked', () => {
    const row = capabilitySummary('sense-recognition', { status: 'unknown', untracked: false }, meaningResult(), undefined);

    expect(row.basis).toBe('unmeasured');
    expect(row.untracked).toBe(true);
    expect(knowledgeStatusLabelKey(row.status, row.basis)).toBe(UNTRACKED_LABEL_KEY);
  });

  it('keeps claim-backed sense knowledge tracked (Known)', () => {
    const row = capabilitySummary(
      'sense-recognition',
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
    const row = capabilitySummary(
      'sense-recognition',
      { status: 'unknown', untracked: true },
      meaningResult(),
      projectionState,
    );

    expect(row.basis).toBe('prediction');
    expect(row.untracked).toBe(true);
    expect(knowledgeStatusLabelKey(row.status, row.basis, row.untracked)).toBe(UNTRACKED_LABEL_KEY);
  });

  it('an unmeasured projection over an unknown resolver state renders Untracked (passive-only consistency)', () => {
    // Graph projection says unmeasured (pure passive familiarity — REQ13);
    // the local resolver agrees (unknown/unmeasured). The row must render
    // Untracked, never Unknown, regardless of the caller's untracked flag.
    const projectionState = {
      basis: 'unmeasured',
      classification: 'unmeasured',
      evidence: [],
      evidenceSourceCounts: {},
    } as unknown as KnowledgeProjection['targets'][number]['states'][number];
    const row = capabilitySummary(
      'sense-recognition',
      { status: 'unknown', untracked: false },
      meaningResult(),
      projectionState,
    );

    expect(row.basis).toBe('unmeasured');
    expect(row.status).toBe('unknown');
    expect(row.untracked).toBe(true);
    expect(knowledgeStatusLabelKey(row.status, row.basis, row.untracked)).toBe(UNTRACKED_LABEL_KEY);
  });
});

describe('projectionStateForCapability', () => {
  it('maps prosodic-pattern to its own state, never pronunciation-production', () => {
    const projection = {
      status: 'ready' as const,
      targets: [
        {
          targetRef: { kind: 'surface' as const, id: 'surface-1' },
          applicableCapabilities: ['prosodic-pattern'],
          states: [{
            capability: 'prosodic-pattern',
            classification: 'learning',
            basis: 'evidence',
            evidence: [],
            evidenceSourceCounts: {},
          }],
        },
        {
          targetRef: { kind: 'surface' as const, id: 'surface-1' },
          applicableCapabilities: ['pronunciation-production'],
          states: [{
            capability: 'pronunciation-production',
            classification: 'known',
            basis: 'evidence',
            evidence: [],
            evidenceSourceCounts: {},
          }],
        },
      ],
    } as unknown as KnowledgeProjection;
    const state = projectionStateForCapability(projection, 'prosodic-pattern');
    expect(state?.capability).toBe('prosodic-pattern');
    expect(state?.classification).toBe('learning');
  });

  it('matches each capability state directly', () => {
    const projection = {
      status: 'ready' as const,
      targets: [
        {
          targetRef: { kind: 'surface' as const, id: 'surface-1' },
          applicableCapabilities: ['surface-recognition', 'surface-reading'],
          states: [
            { capability: 'surface-recognition', classification: 'known', basis: 'evidence', evidence: [], evidenceSourceCounts: {} },
            { capability: 'surface-reading', classification: 'unmeasured', basis: 'unmeasured', evidence: [], evidenceSourceCounts: {} },
          ],
        },
      ],
    } as unknown as KnowledgeProjection;
    expect(projectionStateForCapability(projection, 'surface-recognition')?.classification).toBe('known');
    expect(projectionStateForCapability(projection, 'surface-reading')?.classification).toBe('unmeasured');
  });
});

describe('capabilitySummary claim provenance', () => {
  const meaningUnknown = meaningResult();

  it('a projection claim state renders as claim, never Untracked', () => {
    const projection = {
      status: 'ready' as const,
      targets: [{
        targetRef: { kind: 'surface' as const, id: 's1' },
        applicableCapabilities: ['surface-reading'],
        states: [{
          capability: 'surface-reading', classification: 'known', basis: 'claim',
          evidence: [], evidenceSourceCounts: {},
        }],
      }],
    } as unknown as KnowledgeProjection;
    const state = projectionStateForCapability(projection, 'surface-reading');
    const row = capabilitySummary(
      'surface-reading',
      { status: 'unknown', untracked: true },
      meaningUnknown,
      state,
    );
    expect(row.basis).toBe('claim');
    expect(row.status).toBe('known');
    expect(row.untracked).toBe(false);
  });

  it('a local claim outranks a stale unmeasured projection', () => {
    const row = capabilitySummary(
      'prosodic-pattern',
      { status: 'known', basis: 'claim', claim: 'known' },
      meaningUnknown,
      {
        capability: 'prosodic-pattern', classification: 'unmeasured', basis: 'unmeasured',
        evidence: [], evidenceSourceCounts: {},
      } as never,
    );
    expect(row.basis).toBe('claim');
    expect(row.status).toBe('known');
  });

  it('without a projection, a claimed access keeps the claim basis instead of evidence', () => {
    const row = capabilitySummary(
      'surface-reading',
      { status: 'known', basis: 'claim', claim: 'known' },
      meaningUnknown,
      undefined,
    );
    expect(row.basis).toBe('claim');
    expect(row.status).toBe('known');
    expect(row.untracked).toBe(false);
  });
});
