import { describe, expect, it } from 'vitest';
import { assembleWordKnowledgeModel } from './wordKnowledgeModel';
import type { ComprehensiveWordStatusResult } from '../../../utils/comprehensiveKnowledge';

const comprehensive = (overrides: Partial<ComprehensiveWordStatusResult> = {}): ComprehensiveWordStatusResult => ({
  status: 'unknown',
  basis: 'unmeasured',
  evidenceStatus: 'unknown',
  source: 'None',
  timesSeen: 0,
  ...overrides,
});

describe('assembleWordKnowledgeModel', () => {
  it('composes the comprehensive resolver, projection, and journal without recomputing state', () => {
    const projection = { status: 'ready' as const, surfaceId: 'ja:surface:hash', targets: [] };
    const events = [{ t: 1, kind: 'rating' as const, source: 'anki' as const, aspect: 'meaning' as const, easeAfter: 2.6, attemptId: 'a1' }];
    const model = assembleWordKnowledgeModel({
      comprehensive: comprehensive({ basis: 'claim', status: 'known', claim: 'learning' }),
      projection,
      events,
    });
    expect(model.projection).toBe(projection);
    expect(model.events).toBe(events);
    expect(model.wordClaim).toBe('learning');
    expect(model.excluded).toBe(false);
  });

  it('reports the teaching-policy exclusion orthogonally to knowledge status', () => {
    const model = assembleWordKnowledgeModel({
      comprehensive: comprehensive({ status: 'unknown', basis: 'unmeasured', excluded: true }),
    });
    expect(model.excluded).toBe(true);
    expect(model.wordClaim).toBeNull();
    expect(model.projection).toBeUndefined();
  });

  it('yields no word claim when the comprehensive basis is evidence or unmeasured', () => {
    expect(assembleWordKnowledgeModel({ comprehensive: comprehensive({ basis: 'evidence', status: 'known' }) }).wordClaim).toBeNull();
    expect(assembleWordKnowledgeModel({ comprehensive: comprehensive({ claim: 'known' }) }).wordClaim).toBeNull();
    expect(assembleWordKnowledgeModel({}).wordClaim).toBeNull();
  });
});
