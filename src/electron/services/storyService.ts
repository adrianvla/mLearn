import { randomUUID } from 'crypto';
import { requireLivingWorld } from '../../shared/livingWorld';
import {
  changeProgress, normalizeProgress, validateStoryBranch, validateStoryTrack, STORY_LIMITS,
  type SaveStoryTrackInput, type SetStoryProgressInput, type StoryTrack,
  type UpdateStoryBranchInput,
} from '../../shared/story';
import type { Thread } from '../../shared/world';
import { loadSettings } from './settings';
import { loadWorld, saveWorld, withWorldMutation } from './worldStore';
import { prepareStoryAdvance } from './storyAdvancement';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.storyService');

export async function saveStoryTrack(input: SaveStoryTrackInput): Promise<StoryTrack> {
  requireLivingWorld(loadSettings());
  const request = structuredClone(input);
  return withWorldMutation(async () => {
    requireLivingWorld(loadSettings());
    const world = await loadWorld();
    const tracks = world.storyTracks ?? [];
    const current = request.id ? tracks.find(track => track.id === request.id) : undefined;
    if (request.id && !current) throw new Error('Source progress track was not found');
    if (current && current.revision !== request.expectedRevision) throw new Error('Source progress changed; reload before saving');
    if (!current && tracks.length >= STORY_LIMITS.tracks) throw new Error('Too many source progress tracks');
    if (current && JSON.stringify(request.track.completed) !== JSON.stringify(current.completed)) {
      throw new Error('Use the progress action to change completed units');
    }
    const track: StoryTrack = {
      ...request.track,
      id: current?.id ?? `story_${randomUUID()}`,
      completed: normalizeProgress(request.track.completed),
      revision: (current?.revision ?? 0) + 1,
      updatedAt: Date.now(),
    };
    validateStoryTrack(track);
    await saveWorld({ ...world, storyTracks: current ? tracks.map(item => item.id === current.id ? track : item) : [...tracks, track] });
    return track;
  });
}

export async function setStoryProgress(input: SetStoryProgressInput): Promise<StoryTrack> {
  requireLivingWorld(loadSettings());
  const request = structuredClone(input);
  const updated = await withWorldMutation(async () => {
    requireLivingWorld(loadSettings());
    const world = await loadWorld();
    const current = world.storyTracks?.find(track => track.id === request.trackId);
    if (!current || current.revision !== request.expectedRevision) throw new Error('Source progress changed; reload before saving');
    const completed = changeProgress(current.completed, request.change);
    for (const person of world.participants) {
      if (person.canon?.trackId !== current.id) continue;
      if (person.canon.coverage?.some(range => !completed.some(item => item.from <= range.from && item.to >= range.to))) {
        throw new Error('A contact already has a later source baseline; preserve it or research an earlier sandbox');
      }
    }
    const track = { ...current, completed, revision: current.revision + 1, updatedAt: Date.now() };
    validateStoryTrack(track);
    await saveWorld({ ...world, storyTracks: world.storyTracks!.map(item => item.id === track.id ? track : item) });
    return track;
  });
  if (updated.autoAdvance) {
    void prepareStoryAdvance({ operationId: `advance_${randomUUID()}`, trackId: updated.id,
      expectedRevision: updated.revision, automatic: true }).catch(error => log.error('Automatic source advancement failed', error));
  }
  return updated;
}

export async function updateStoryBranch(input: UpdateStoryBranchInput): Promise<Thread> {
  const request = structuredClone(input);
  validateStoryBranch(request);
  return withWorldMutation(async () => {
    const world = await loadWorld();
    const thread = world.threads.find(item => item.id === request.threadId && item.sandbox);
    if (!thread) throw new Error('Practice conversation was not found');
    if ((thread.storyBranch?.revision ?? 0) !== request.expectedRevision) throw new Error('Story branch changed; reload before saving');
    const storyBranch = { mode: request.mode, adaptations: request.adaptations, revision: request.expectedRevision + 1 };
    const updated = { ...thread, storyBranch };
    await saveWorld({ ...world, threads: world.threads.map(item => item.id === thread.id ? updated : item) });
    return updated;
  });
}
