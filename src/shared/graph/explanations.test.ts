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

  it('distinguishes claims from evidence: unknown claim is a negative state, never unmeasured', () => {
    const claimOnly = assembleTargetExplanation('sense-recognition', [
      { t: 1, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'unknown' },
    ], policy, 2);
    expect(claimOnly.state).toBe('claimed-unknown');
    expect(claimOnly.projection?.claim).toBe('unknown');

    const override = assembleTargetExplanation('sense-recognition', [
      { t: 1, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2600, rating: 'good' },
      { t: 2, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'learning' },
    ], policy, 3);
    expect(override.state).toBe('claimed-learning');
  });

  it('pure passive familiarity is unmeasured — never Learning — with the projection intact', () => {
    const passiveOnly = assembleTargetExplanation('sense-recognition', [
      { t: 1, kind: 'rollup', source: 'passiveTracking', aspect: 'meaning', easeAfter: 2.5, timesSeenDelta: 12 },
    ], policy, 2);
    // REQ13: exposure alone (hasEvidence, no active evidence, no claim) proves
    // nothing — unmeasured basis, even when exposure ease crosses Known.
    expect(passiveOnly.state).toBe('unmeasured');
    expect(passiveOnly.projection?.timesSeen).toBe(12);
    expect(passiveOnly.projection?.hasActiveEvidence).toBe(false);
    expect(passiveOnly.projection?.hasEvidence).toBe(true);
  });

  it('active learning-band evidence still classifies as learning', () => {
    const active = assembleTargetExplanation('sense-recognition', [
      { t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 1.6, quality: 'struggled' },
    ], policy, 2);
    expect(active.state).toBe('learning');
  });

  it('classifies negative evidence as unknown, not learning', () => {
    const negative = assembleTargetExplanation('sense-recognition', [
      { t: 1, kind: 'status', source: 'manual', aspect: 'meaning', toStatus: 'unknown', easeAfter: 1.3 },
    ], policy, 2);
    expect(negative.state).toBe('unknown');
  });

  it('normalizes raw Anki factors into the SRS scale before classifying', () => {
    const anki = assembleTargetExplanation('sense-recognition', [
      { t: 1, kind: 'review', source: 'anki', aspect: 'meaning', rating: 'good', easeAfter: 1950 },
    ], policy, 2);
    expect(anki.state).toBe('evidence-backed-known');
  });

  it('scopes meaning evidence to meaning-visible capabilities only', () => {
    const events = [
      { t: 1, kind: 'rating' as const, source: 'srs' as const, aspect: 'meaning' as const, easeAfter: 2.6 },
    ];
    expect(assembleTargetExplanation('sense-recognition', events, policy, 2).state).toBe('evidence-backed-known');
    expect(assembleTargetExplanation('surface-recognition', events, policy, 2).state).toBe('evidence-backed-known');
    expect(assembleTargetExplanation('surface-reading', events, policy, 2).state).toBe('unmeasured');
    expect(assembleTargetExplanation('prosodic-pattern', events, policy, 2).state).toBe('unmeasured');
  });

  it('keeps reading evidence off meaning capabilities and routes grammar rows by targetRef', () => {
    const reading = [{ t: 1, kind: 'rating' as const, source: 'srs' as const, aspect: 'reading' as const, easeAfter: 1.3 }];
    expect(assembleTargetExplanation('surface-reading', reading, policy, 2).state).toBe('unknown');
    expect(assembleTargetExplanation('sense-recognition', reading, policy, 2).state).toBe('unmeasured');

    const grammar = [{ t: 1, kind: 'rating' as const, source: 'grammar' as const, aspect: 'grammar' as const, easeAfter: 1.8, targetRef: { kind: 'grammar-pattern', id: 'gp:1', capability: 'grammar-recognition' as const } }];
    expect(assembleTargetExplanation('grammar-recognition', grammar, policy, 2).state).toBe('evidence-backed-known');
    expect(assembleTargetExplanation('grammar-formation', grammar, policy, 2).state).toBe('unmeasured');
  });
});
