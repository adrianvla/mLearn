import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import type { StoryTrackDraft } from '../../shared/story';
import type { Participant } from '../../shared/world';

let tempDir: TempDir;
const loadSettings = vi.fn(() => ({ livingWorldEnabled: true }));
vi.mock('../utils/platform', () => ({ getUserDataPath: () => tempDir.tmpDir }));
vi.mock('./settings', () => ({ loadSettings }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/test', isPackaged: false } }));

const draft = (): StoryTrackDraft => ({
  title: 'The Voyage', edition: 'First edition', unitLabel: 'chapter', completed: [],
  sources: [], relations: [], autoAdvance: false,
});

describe('storyService', () => {
  beforeEach(() => { tempDir = createTempDir(); loadSettings.mockReturnValue({ livingWorldEnabled: true }); });
  afterEach(() => tempDir.cleanup());

  it('persists source progress with revision checks and preserves declared source mappings', async () => {
    const { saveStoryTrack, setStoryProgress } = await import('./storyService');
    const { loadWorld } = await import('./worldStore');
    const first = await saveStoryTrack({ track: { ...draft(), sources: [{ id: 'source-1', from: 1, to: 2,
      url: 'https://example.org/chapters/1-2', confirmed: true }] } });
    expect(first.revision).toBe(1);
    const progressed = await setStoryProgress({ trackId: first.id, expectedRevision: 1, change: { kind: 'through', unit: 2 } });
    expect(progressed.completed).toEqual([{ from: 1, to: 2 }]);
    expect((await loadWorld()).storyTracks?.[0].sources[0].url).toBe('https://example.org/chapters/1-2');
    await expect(setStoryProgress({ trackId: first.id, expectedRevision: 1, change: { kind: 'complete', unit: 3 } }))
      .rejects.toThrow(/changed/);
    await expect(saveStoryTrack({ id: first.id, expectedRevision: 1, track: draft() })).rejects.toThrow(/changed/);
  });

  it('does not retract progress behind a contact baseline or mutate it on failure', async () => {
    const { saveStoryTrack, setStoryProgress } = await import('./storyService');
    const { loadWorld, saveWorld } = await import('./worldStore');
    const track = await saveStoryTrack({ track: { ...draft(), completed: [{ from: 1, to: 4 }] } });
    const person: Participant = { id: 'person-1', displayName: 'Mira', kind: 'persistent', personaText: '', setupComplete: true,
      canon: { trackId: track.id, workTitle: track.title, fandomBaseUrl: 'https://example.org', characterPageTitle: 'Mira',
        coordinate: { kind: 'point', value: '4' }, coverage: [{ from: 1, to: 4 }],
        baseline: { lore: '', quotes: [], context: '', notYetHappened: [], provenance: [], generatedFill: [] } } };
    await saveWorld({ ...(await loadWorld()), participants: [person] });
    await expect(setStoryProgress({ trackId: track.id, expectedRevision: 1, change: { kind: 'through', unit: 2 } }))
      .rejects.toThrow(/later source baseline/);
    expect((await loadWorld()).storyTracks?.[0].completed).toEqual([{ from: 1, to: 4 }]);
  });

  it("stores a revision checked sandbox story branch separately from the person's canon", async () => {
    const { updateStoryBranch } = await import('./storyService');
    const { loadWorld } = await import('./worldStore');
    fs.writeFileSync(path.join(tempDir.tmpDir, 'world.json'), JSON.stringify({ rooms: [], participants: [], threads: [{
      id: 'thread-1', state: 'active', createdAt: 1, sandbox: { operationId: 'op-1', requestHash: 'hash', bindings: [], baselineHeads: {} },
    }] }));
    const updated = await updateStoryBranch({ threadId: 'thread-1', expectedRevision: 0, mode: 'independent', adaptations: ['An alternate beginning'] });
    expect(updated.storyBranch).toEqual({ mode: 'independent', adaptations: ['An alternate beginning'], revision: 1 });
    await expect(updateStoryBranch({ threadId: 'thread-1', expectedRevision: 0, mode: 'follow', adaptations: [] }))
      .rejects.toThrow(/changed/);
    expect((await loadWorld()).threads[0].storyBranch?.mode).toBe('independent');
  });
});
