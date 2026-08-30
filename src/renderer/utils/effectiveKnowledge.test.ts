import { describe, expect, it } from 'vitest';
import { effectiveStateFromEntry, evidenceStatusFromEase } from './effectiveKnowledge';
import type { PassiveWordKnowledge } from '../../shared/types';

const thresholds = { learning: 1.55, known: 1.8 };

describe('effectiveStateFromEntry', () => {
  it('claim overrides evidence without touching the evidence classification', () => {
    const state = effectiveStateFromEntry({
      word: 'x', language: 'ja', ease: 1.3, timesSeen: 0, timesHovered: 0, lastSeen: 5,
      claim: 'known', claimAt: 10, hasActiveEvidence: false,
    }, thresholds);
    expect(state.status).toBe('known');
    expect(state.basis).toBe('claim');
    expect(state.evidenceStatus).toBe('unknown');
  });

  it('a claim-floor entry without factual markers reads as unmeasured, never evidence-backed Unknown', () => {
    // Aspect-claim floor: ease 1.3 is a placeholder, not a fact.
    const state = effectiveStateFromEntry({
      word: 'x', language: 'ja', ease: 1.3, timesSeen: 0, timesHovered: 0, lastSeen: 5, hasActiveEvidence: false,
    }, thresholds);
    expect(state.status).toBe('unknown');
    expect(state.basis).toBe('unmeasured');
    expect(state.hasEvidence).toBe(false);
  });

  it('pure passive familiarity resolves unmeasured/unknown — never a Learning display', () => {
    const state = effectiveStateFromEntry({
      word: 'x', language: 'ja', ease: 2.5, timesSeen: 9, timesHovered: 3, lastSeen: 5, hasActiveEvidence: false,
    }, thresholds);
    expect(state.status).toBe('unknown');
    expect(state.basis).toBe('unmeasured');
    expect(state.evidenceStatus).toBe('unknown');
    // Familiarity stays visible for familiarity consumers.
    expect(state.hasEvidence).toBe(true);
    expect(state.ease).toBe(2.5);
  });

  it('an explicit status marker without the active flag keeps the Known→Learning downgrade', () => {
    // Mixed row: explicit status fingerprint present, active-evidence flag
    // missing (legacy/half-synced). Measured (basis evidence), but exposure
    // alone still cannot display Known.
    const state = effectiveStateFromEntry({
      word: 'x', language: 'ja', ease: 2.5, timesSeen: 9, timesHovered: 0, lastSeen: 5,
      lastStatusChange: 6, hasActiveEvidence: false,
    }, thresholds);
    expect(state.status).toBe('learning');
    expect(state.basis).toBe('evidence');
    expect(state.evidenceStatus).toBe('learning');
  });

  it('active evidence classifies through the ease bands with no cap', () => {
    const state = effectiveStateFromEntry({
      word: 'x', language: 'ja', ease: 2.5, timesSeen: 9, timesHovered: 0, lastSeen: 5,
      hasActiveEvidence: true, lastEvidenceSource: 'srs',
    }, thresholds);
    expect(state.status).toBe('known');
    expect(state.basis).toBe('evidence');
    expect(state.evidenceStatus).toBe('known');
  });

  it('a claim over pure passive familiarity keeps the classification while evidence stays unmeasured', () => {
    const state = effectiveStateFromEntry({
      word: 'x', language: 'ja', ease: 2.5, timesSeen: 9, timesHovered: 0, lastSeen: 5,
      claim: 'learning', claimAt: 10, hasActiveEvidence: false,
    }, thresholds);
    expect(state.status).toBe('learning');
    expect(state.basis).toBe('claim');
    expect(state.evidenceStatus).toBe('unknown');
  });
});

describe('evidenceStatusFromEase', () => {
  it('keeps the threshold bands disjoint', () => {
    expect(evidenceStatusFromEase(1.8, thresholds)).toBe('known');
    expect(evidenceStatusFromEase(1.55, thresholds)).toBe('learning');
    expect(evidenceStatusFromEase(1.3, thresholds)).toBe('unknown');
    expect(evidenceStatusFromEase(undefined, thresholds)).toBe('unknown');
  });
});
