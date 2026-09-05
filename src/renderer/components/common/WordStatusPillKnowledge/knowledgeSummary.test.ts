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
    const row = aspectCapabilitySummary(
      'meaning',
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

describe('projectionStateForAspect', () => {
  it('maps prosody to the prosodic-pattern capability, never pronunciation-production', async () => {
    const { projectionStateForAspect } = await import('./knowledgeSummary');
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
    const state = projectionStateForAspect(projection, 'prosody');
    expect(state?.capability).toBe('prosodic-pattern');
    expect(state?.classification).toBe('learning');
  });

  it('reading maps to surface-reading and meaning to the presented surface row', async () => {
    const { projectionStateForAspect } = await import('./knowledgeSummary');
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
    expect(projectionStateForAspect(projection, 'meaning')?.capability).toBe('surface-recognition');
    expect(projectionStateForAspect(projection, 'reading')?.capability).toBe('surface-reading');
  });
});

describe('aspectCapabilitySummary claim provenance', () => {
  const meaningUnknown = meaningResult();

  it('a projection claim state renders as claim, never Untracked', async () => {
    const { aspectCapabilitySummary, projectionStateForAspect } = await import('./knowledgeSummary');
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
    const state = projectionStateForAspect(projection, 'reading');
    const row = aspectCapabilitySummary(
      'reading',
      { status: 'unknown', untracked: true },
      meaningUnknown,
      state,
    );
    expect(row.basis).toBe('claim');
    expect(row.status).toBe('known');
    expect(row.untracked).toBe(false);
  });

  it('a local aspect claim outranks a stale unmeasured projection', async () => {
    const { aspectCapabilitySummary } = await import('./knowledgeSummary');
    const row = aspectCapabilitySummary(
      'prosody',
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

  it('without a projection, a claimed aspect keeps the claim basis instead of evidence', async () => {
    const { aspectCapabilitySummary } = await import('./knowledgeSummary');
    const row = aspectCapabilitySummary(
      'reading',
      { status: 'known', basis: 'claim', claim: 'known' },
      meaningUnknown,
      undefined,
    );
    expect(row.basis).toBe('claim');
    expect(row.status).toBe('known');
    expect(row.untracked).toBe(false);
  });
});
