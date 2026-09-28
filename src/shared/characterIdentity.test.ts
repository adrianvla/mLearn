import { describe, expect, it } from 'vitest';
import { parseIdentityProposal, validateCharacterResearchRequest, type CharacterEvidence } from './characterIdentity';

const evidence: CharacterEvidence = { name: 'Mira', wikiUrl: 'https://example.org', pageTitle: 'Mira',
  pageUrl: 'https://example.org/wiki/Mira', text: 'Mira waits.', quotes: ['Wait here.', 'We go now.'], storyText: '',
  coverage: [], sources: [{ pageTitle: 'Mira', url: 'https://example.org/wiki/Mira', fetchedAt: 1 }], excerpted: false };

describe('character identity draft', () => {
  it('keeps an unscoped draft out of story context and selects only verbatim source quotes', () => {
    const draft = parseIdentityProposal(JSON.stringify({ lore: 'Patient and observant.', context: 'Later events.',
      quoteIndices: [1], generatedExamples: ['I can wait.'], unknowns: [] }), evidence);
    expect(draft.baseline.context).toBe('');
    expect(draft.baseline.quotes).toEqual(['We go now.']);
    expect(draft.baseline.generatedFill).toEqual(['I can wait.']);
    expect(draft.unknowns).toContain('No progress-scoped story evidence was supplied.');
  });

  it('rejects invalid source selections and incomplete revision binding', () => {
    expect(() => parseIdentityProposal(JSON.stringify({ lore: 'Patient.', context: '', quoteIndices: [4], generatedExamples: [], unknowns: [] }), evidence)).toThrow(/quotations/);
    expect(() => validateCharacterResearchRequest({ operationId: 'research-1', name: 'Mira', language: 'xx',
      sourceUrl: 'https://example.org/wiki/Mira', trackId: 'story-1' })).toThrow(/together/);
  });

  it('discloses that a draft was based on source excerpts', () => {
    const draft = parseIdentityProposal(JSON.stringify({ lore: 'Patient.', context: '',
      quoteIndices: [], generatedExamples: [], unknowns: [] }), { ...evidence, excerpted: true });
    expect(draft.unknowns).toContain('Source passages were excerpted for this research pass; review the original pages before accepting the draft.');
  });
});
