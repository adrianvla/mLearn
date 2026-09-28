import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import type { Participant } from '../../shared/world';
import type { StoryTrack } from '../../shared/story';

let tempDir: TempDir;
const settings = vi.fn(() => ({ livingWorldEnabled: true, llmEnabled: true, language: 'xx' }));
const synthesize = vi.fn(async () => ({ baseline: { lore: 'Rewritten voice', quotes: ['New quote'], context: 'Mira has reached the port.',
  notYetHappened: [], provenance: [], generatedFill: ['New example'] }, generatedExamples: [], unknowns: [] }));
vi.mock('../utils/platform', () => ({ getUserDataPath: () => tempDir.tmpDir }));
vi.mock('./settings', () => ({ loadSettings: settings }));
vi.mock('./wikiSources', () => ({ readStorySources: vi.fn(async () => ({ text: 'Mira reached the port.', coverage: [{ from: 2, to: 2 }], excerpted: false,
  provenance: [{ pageTitle: 'Chapter 2', fetchedAt: 2 }] })),
  readSourcePage: vi.fn(async (url: string) => ({ url, text: 'Mira is patient and observant.' })),
  readCharacterEvidence: vi.fn(async (url: string) => ({ name: 'Mira', wikiUrl: 'https://example.org', pageTitle: 'Mira',
    pageUrl: url, text: 'Mira is patient and observant.', quotes: [], storyText: '', coverage: [], sources: [], excerpted: true })) }));
vi.mock('./characterResearch', () => ({ synthesizeCharacter: synthesize }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/test', isPackaged: false } }));

const track = (): StoryTrack => ({ id: 'story-1', title: 'Voyage', edition: 'First', unitLabel: 'chapter', completed: [{ from: 1, to: 2 }],
  sources: [{ id: 'chapter-2', url: 'https://example.org/wiki/Chapter_2', from: 2, to: 2, confirmed: true }],
  relations: [], autoAdvance: false, revision: 2, updatedAt: 2 });
const person = (): Participant => ({ id: 'mira', kind: 'persistent', displayName: 'Mira', personaText: 'Patient.', setupComplete: true,
  canon: { trackId: 'story-1', trackRevision: 1, coverage: [{ from: 1, to: 1 }], workTitle: 'Voyage',
    fandomBaseUrl: 'https://example.org', characterPageTitle: 'Mira', coordinate: { kind: 'point', value: '1' },
    baseline: { lore: 'Original voice', quotes: ['Original quote'], context: 'Mira began.', notYetHappened: [], provenance: [], generatedFill: [] } } });

describe('story advancement', () => {
  beforeEach(() => { tempDir = createTempDir(); synthesize.mockClear(); });
  afterEach(() => tempDir.cleanup());

  it('prepares a reviewable revision-bound proposal and preserves identity voice on apply', async () => {
    const { saveWorld, loadWorld } = await import('./worldStore');
    const { readStorySources, readCharacterEvidence } = await import('./wikiSources');
    const { prepareStoryAdvance, applyStoryAdvance } = await import('./storyAdvancement');
    await saveWorld({ rooms: [], threads: [], participants: [person()], storyTracks: [track()] });
    const ready = await prepareStoryAdvance({ operationId: 'advance-1', trackId: 'story-1', expectedRevision: 2 });
    expect(ready.status).toBe('ready');
    expect(vi.mocked(readStorySources)).toHaveBeenCalledWith(track().sources, expect.any(AbortSignal), expect.any(Function), 32_000);
    expect(readCharacterEvidence).not.toHaveBeenCalled();
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'Mira reached the port.', excerpted: false }),
      'xx', expect.any(AbortSignal), 'advance-1', 'background');
    expect((await loadWorld()).participants[0].canon?.baseline.context).toBe('Mira began.');
    const applied = await applyStoryAdvance(ready.id);
    expect(applied.status).toBe('applied');
    const updated = (await loadWorld()).participants[0];
    expect(updated.canon?.baseline.context).toBe('Mira has reached the port.');
    expect(updated.canon?.baseline.lore).toBe('Original voice');
    expect(updated.canon?.baseline.quotes).toEqual(['Original quote']);
  });

  it('refuses to publish a proposal after the participant changed', async () => {
    const { saveWorld, loadWorld } = await import('./worldStore');
    const { prepareStoryAdvance, applyStoryAdvance } = await import('./storyAdvancement');
    await saveWorld({ rooms: [], threads: [], participants: [person()], storyTracks: [track()] });
    const ready = await prepareStoryAdvance({ operationId: 'advance-2', trackId: 'story-1', expectedRevision: 2 });
    const world = await loadWorld();
    await saveWorld({ ...world, participants: [{ ...world.participants[0], personaText: 'Edited by owner.' }] });
    const stale = await applyStoryAdvance(ready.id);
    expect(stale).toMatchObject({ status: 'stale', error: expect.stringMatching(/contact changed/) });
    expect((await loadWorld()).participants[0].canon?.baseline.context).toBe('Mira began.');
    const retried = await prepareStoryAdvance({ operationId: 'advance-2-retry', trackId: 'story-1', expectedRevision: 2 });
    expect(retried.status).toBe('ready');
  });

  it('does not reuse an operation for another track', async () => {
    const { saveWorld } = await import('./worldStore');
    const { prepareStoryAdvance } = await import('./storyAdvancement');
    await saveWorld({ rooms: [], threads: [], participants: [person()], storyTracks: [track(), { ...track(), id: 'story-2' }] });
    await prepareStoryAdvance({ operationId: 'advance-3', trackId: 'story-1', expectedRevision: 2 });
    await expect(prepareStoryAdvance({ operationId: 'advance-3', trackId: 'story-2', expectedRevision: 2 }))
      .rejects.toThrow(/different story revision/);
  });

  it('marks a proposal stale when the story declaration changes', async () => {
    const { saveWorld, loadWorld } = await import('./worldStore');
    const { prepareStoryAdvance, applyStoryAdvance } = await import('./storyAdvancement');
    await saveWorld({ rooms: [], threads: [], participants: [person()], storyTracks: [track()] });
    const ready = await prepareStoryAdvance({ operationId: 'advance-story-change', trackId: 'story-1', expectedRevision: 2 });
    const world = await loadWorld();
    await saveWorld({ ...world, storyTracks: [{ ...world.storyTracks![0], revision: 3 }] });
    const result = await applyStoryAdvance(ready.id);
    expect(result).toMatchObject({ status: 'stale', error: expect.stringMatching(/story declaration changed/) });
    expect((await loadWorld()).participants[0].canon?.baseline.context).toBe('Mira began.');
  });

  it('holds advancement when a source page was only partially read', async () => {
    const { saveWorld, loadWorld } = await import('./worldStore');
    const { readStorySources } = await import('./wikiSources');
    const { prepareStoryAdvance } = await import('./storyAdvancement');
    vi.mocked(readStorySources).mockResolvedValueOnce({ text: 'The opening only.', coverage: [], provenance: [], excerpted: true });
    await saveWorld({ rooms: [], threads: [], participants: [person()], storyTracks: [track()] });
    const result = await prepareStoryAdvance({ operationId: 'advance-truncated', trackId: 'story-1', expectedRevision: 2 });
    expect(result.status).toBe('held');
    expect(synthesize).not.toHaveBeenCalled();
    expect((await loadWorld()).participants[0].canon?.coverage).toEqual([{ from: 1, to: 1 }]);
  });
});
