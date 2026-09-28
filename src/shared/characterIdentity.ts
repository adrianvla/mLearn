import type { CanonBaseline, SourceRef } from './world';
import { validatePublicSourceUrl, type UnitRange } from './story';

export interface CharacterResearchRequest {
  operationId: string;
  name: string;
  sourceUrl: string;
  language: string;
  trackId?: string;
  trackRevision?: number;
}

export interface CharacterEvidence {
  name: string;
  wikiUrl: string;
  pageTitle: string;
  pageUrl: string;
  text: string;
  quotes: string[];
  storyText: string;
  coverage: UnitRange[];
  sources: SourceRef[];
  excerpted: boolean;
}

export interface CharacterResearchResult {
  name: string;
  evidence: CharacterEvidence;
  baseline: CanonBaseline;
  generatedExamples: string[];
  unknowns: string[];
  trackId?: string;
  trackRevision?: number;
}

const bounded = (value: unknown, max: number, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
};

export function validateCharacterResearchRequest(request: CharacterResearchRequest): void {
  if (!request || typeof request !== 'object') throw new Error('Invalid character research request');
  bounded(request.operationId, 180, 'research operation');
  bounded(request.name, 200, 'character name');
  bounded(request.language, 180, 'research language');
  validatePublicSourceUrl(request.sourceUrl);
  if ((request.trackId === undefined) !== (request.trackRevision === undefined)) throw new Error('Source track and revision must be supplied together');
  if (request.trackId !== undefined) {
    bounded(request.trackId, 180, 'source track');
    if (!Number.isSafeInteger(request.trackRevision) || request.trackRevision! < 1) throw new Error('Invalid source track revision');
  }
}

export function parseIdentityProposal(raw: string, evidence: CharacterEvidence): Pick<CharacterResearchResult, 'baseline' | 'generatedExamples' | 'unknowns'> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Character research returned invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Character research returned an invalid draft');
  const draft = value as Record<string, unknown>;
  const lore = bounded(draft.lore, 5000, 'character lore');
  const context = draft.context === '' ? '' : bounded(draft.context, 14000, 'story context');
  if (!Array.isArray(draft.quoteIndices) || draft.quoteIndices.length > 4
    || draft.quoteIndices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= evidence.quotes.length)) {
    throw new Error('Character research selected invalid source quotations');
  }
  if (!Array.isArray(draft.generatedExamples) || draft.generatedExamples.length > 4
    || draft.generatedExamples.some(item => typeof item !== 'string' || item.length > 500)) throw new Error('Invalid generated speech examples');
  if (!Array.isArray(draft.unknowns) || draft.unknowns.length > 20
    || draft.unknowns.some(item => typeof item !== 'string' || item.length > 500)) throw new Error('Invalid source uncertainty notes');
  return {
    baseline: {
      lore,
      quotes: [...new Set(draft.quoteIndices as number[])].map(index => evidence.quotes[index]),
      context: evidence.storyText ? context : '',
      notYetHappened: [],
      provenance: evidence.sources,
      generatedFill: draft.generatedExamples as string[],
    },
    generatedExamples: draft.generatedExamples as string[],
    unknowns: [
      ...draft.unknowns as string[],
      ...(!evidence.storyText ? ['No progress-scoped story evidence was supplied.'] : []),
      ...(evidence.excerpted ? ['Source passages were excerpted for this research pass; review the original pages before accepting the draft.'] : []),
    ],
  };
}
