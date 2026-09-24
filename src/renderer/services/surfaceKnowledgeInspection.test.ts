import { describe, expect, it } from 'vitest';
import { surfaceEntityId } from '../../shared/graph/load';
import { hashWordSync } from './srsAlgorithm';
import { surfaceKnowledgeInspection } from './surfaceKnowledgeInspection';

describe('surfaceKnowledgeInspection', () => {
  it('builds the canonical surface target without changing the displayed text', () => {
    expect(surfaceKnowledgeInspection('synthetic', 'unknown-script 𐀀')).toEqual({
      language: 'synthetic',
      surface: 'unknown-script 𐀀',
      target: { kind: 'surface', id: surfaceEntityId('synthetic', hashWordSync('unknown-script 𐀀')) },
    });
  });

  it('carries a pinned review trace without adding one to ordinary inspections', () => {
    const trace = { kind: 'fixture' } as unknown as NonNullable<ReturnType<typeof surfaceKnowledgeInspection>['policyTrace']>;
    expect(surfaceKnowledgeInspection('synthetic', 'word').policyTrace).toBeUndefined();
    expect(surfaceKnowledgeInspection('synthetic', 'word', { policyTrace: trace, policyBrief: 'Due now' }))
      .toMatchObject({ policyTrace: trace, policyBrief: 'Due now' });
  });
});
