import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterEvidence } from '../../shared/characterIdentity';

let profile = '/profile-a';
const completeJob = vi.fn();
const readCharacterEvidence = vi.fn();
const loadWorld = vi.fn();
const reviewWorldMaterial = vi.fn(async () => {});
vi.mock('../utils/platform', () => ({ getUserDataPath: () => profile }));
vi.mock('./settings', () => ({ loadSettings: () => ({ llmEnabled: true }) }));
vi.mock('./worldStore', () => ({ loadWorld }));
vi.mock('./wikiSources', () => ({ readCharacterEvidence }));
vi.mock('./llmRouter', () => ({ completeJob }));
vi.mock('./worldMaterialReview', () => ({ reviewWorldMaterial }));

const evidence = (): CharacterEvidence => ({ name: 'Mira', wikiUrl: 'https://example.org', pageTitle: 'Mira',
  pageUrl: 'https://example.org/wiki/Mira', text: 'Mira is observant.', quotes: [], storyText: '', coverage: [],
  sources: [{ pageTitle: 'Mira', url: 'https://example.org/wiki/Mira', fetchedAt: 1 }], excerpted: false });
const request = (operationId: string) => ({ operationId, name: 'Mira', sourceUrl: 'https://example.org/wiki/Mira', language: 'xx' });
const draft = JSON.stringify({ lore: 'Observant.', quoteIndices: [], context: '', generatedExamples: [], unknowns: [] });

describe('character research lifecycle', () => {
  beforeEach(() => {
    profile = '/profile-a';
    completeJob.mockReset(); readCharacterEvidence.mockReset(); loadWorld.mockReset(); reviewWorldMaterial.mockClear();
    loadWorld.mockResolvedValue({ storyTracks: [] });
    readCharacterEvidence.mockResolvedValue(evidence());
    completeJob.mockResolvedValue(draft);
  });

  it('sends partial-evidence status to the model and returns a draft without creating a person', async () => {
    const { researchCharacter } = await import('./characterResearch');
    const result = await researchCharacter(request('research-draft'));
    expect(result.baseline.lore).toBe('Observant.');
    expect(loadWorld).toHaveBeenCalledOnce();
    expect(completeJob.mock.calls[0][0][1].content).toContain('"partialEvidence":false');
  });

  it('aborts a pending source read when the owner cancels research', async () => {
    readCharacterEvidence.mockImplementation((_url, _name, _sources, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Source read cancelled')), { once: true });
    }));
    const { researchCharacter, cancelCharacterResearch } = await import('./characterResearch');
    const pending = researchCharacter(request('research-cancel'));
    await vi.waitFor(() => expect(readCharacterEvidence).toHaveBeenCalledOnce());
    cancelCharacterResearch('research-cancel');
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(completeJob).not.toHaveBeenCalled();
  });

  it('does not return a draft after the active profile changes', async () => {
    completeJob.mockImplementation(async () => { profile = '/profile-b'; return draft; });
    const { researchCharacter } = await import('./characterResearch');
    await expect(researchCharacter(request('research-switch'))).rejects.toThrow(/profile changed/);
  });

  it('does not return a draft after declared source progress changes', async () => {
    const source = { id: 'chapter-1', url: 'https://example.org/wiki/Chapter_1', from: 1, to: 1, confirmed: true };
    loadWorld.mockResolvedValueOnce({ storyTracks: [{ id: 'story-1', revision: 1, sources: [source], completed: [{ from: 1, to: 1 }] }] })
      .mockResolvedValueOnce({ storyTracks: [{ id: 'story-1', revision: 2, sources: [source], completed: [{ from: 1, to: 1 }] }] });
    const { researchCharacter } = await import('./characterResearch');
    await expect(researchCharacter({ ...request('research-revision'), trackId: 'story-1', trackRevision: 1 }))
      .rejects.toThrow(/progress changed during research/);
  });

  it('requires mapped chapters before researching a declared story identity', async () => {
    loadWorld.mockResolvedValue({ storyTracks: [{ id: 'story-1', revision: 1, sources: [], completed: [{ from: 1, to: 5 }] }] });
    const { researchCharacter } = await import('./characterResearch');
    await expect(researchCharacter({ ...request('research-unmapped'), trackId: 'story-1', trackRevision: 1 }))
      .rejects.toThrow(/mapped source/);
    expect(readCharacterEvidence).not.toHaveBeenCalled();
  });

  it('asks the reader for story-scoped evidence when a track is declared', async () => {
    const source = { id: 'chapter-1', url: 'https://example.org/wiki/Chapter_1', from: 1, to: 1, confirmed: true };
    loadWorld.mockResolvedValue({ storyTracks: [{ id: 'story-1', revision: 1, sources: [source], completed: [{ from: 1, to: 1 }] }] });
    const { researchCharacter } = await import('./characterResearch');
    await researchCharacter({ ...request('research-scoped'), trackId: 'story-1', trackRevision: 1 });
    expect(readCharacterEvidence).toHaveBeenCalledWith(request('research-scoped').sourceUrl, 'Mira', [source],
      expect.any(AbortSignal), expect.objectContaining({ scope: 'story' }));
  });

  it('does not synthesize a tracked identity from a clipped chapter', async () => {
    const source = { id: 'chapter-1', url: 'https://example.org/wiki/Chapter_1', from: 1, to: 1, confirmed: true };
    loadWorld.mockResolvedValue({ storyTracks: [{ id: 'story-1', revision: 1, sources: [source], completed: [{ from: 1, to: 1 }] }] });
    readCharacterEvidence.mockResolvedValue({ ...evidence(), excerpted: true });
    const { researchCharacter } = await import('./characterResearch');
    await expect(researchCharacter({ ...request('research-clipped'), trackId: 'story-1', trackRevision: 1 }))
      .rejects.toThrow(/partially read/);
    expect(completeJob).not.toHaveBeenCalled();
  });
});
