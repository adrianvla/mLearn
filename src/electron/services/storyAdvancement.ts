/** Source advancement is a revision-bound transaction, never fabricated Sea occurrences. */
import { createHash } from 'node:crypto';
import { requireLivingWorld } from '../../shared/livingWorld';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { covered, eligibleSources, formatProgress, normalizeProgress, STORY_LIMITS, type StoryAdvanceInput, type StoryAdvanceRecord, type StoryAdvanceProposal } from '../../shared/story';
import type { Participant } from '../../shared/world';
import { loadSettings } from './settings';
import { loadWorld, saveWorld, withWorldMutation } from './worldStore';
import { readSourcePage, readStorySources } from './wikiSources';
import { synthesizeCharacter } from './characterResearch';
import { getUserDataPath } from '../utils/platform';
const running = new Map<string, AbortController>();
const ADVANCE_STORY_EVIDENCE_BYTES = 32_000;
export function participantRevision(person: Participant): string { return createHash('sha256').update(JSON.stringify(person)).digest('hex'); }
export function cancelStoryAdvance(id: string): void { running.get(`${getUserDataPath()}:${id}`)?.abort(); }
export function cancelAllStoryAdvances(): void { for (const controller of running.values()) controller.abort(); }
export async function prepareStoryAdvance(input: StoryAdvanceInput): Promise<StoryAdvanceRecord> {
  const request = structuredClone(input); requireLivingWorld(loadSettings());
  if (typeof request.operationId !== 'string' || !/^[\w-]{8,180}$/.test(request.operationId)) throw new Error('Invalid source advancement operation');
  if (!loadSettings().llmEnabled) throw new Error('Enable a model before advancing source background.');
  const profile = getUserDataPath();
  const start = await withWorldMutation(async () => {
    const world = await loadWorld(); const track = world.storyTracks?.find(item => item.id === request.trackId);
    if (!track || track.revision !== request.expectedRevision) throw new Error('Source progress changed. Reload it before advancing.');
    if (request.automatic && !track.autoAdvance) throw new Error('Story automatic advancement is not enabled');
    const sameOperation = world.storyAdvances?.find(item => item.id === request.operationId);
    if (sameOperation && (sameOperation.trackId !== track.id || sameOperation.trackRevision !== track.revision)) {
      throw new Error('Source advancement operation belongs to a different story revision');
    }
    const duplicate = world.storyAdvances?.find(item => item.id === request.operationId || item.trackId === track.id && item.trackRevision === track.revision && ['running', 'ready', 'applied'].includes(item.status));
    if (duplicate) return { record: duplicate, track, people: [] as Participant[], duplicate: true };
    const people = world.participants.filter(person => person.kind === 'persistent' && !person.archivedAt && person.canon?.trackId === track.id);
    const record: StoryAdvanceRecord = { id: request.operationId, trackId: track.id, trackRevision: track.revision, status: 'running', createdAt: Date.now(), proposals: [] };
    const prior = world.storyAdvances ?? [];
    if (prior.filter(item => item.status === 'running' || item.status === 'ready').length >= STORY_LIMITS.history) throw new Error('Review or finish existing source advancements first.');
    const retained = prior.filter(item => item.status === 'running' || item.status === 'ready');
    const historyCapacity = STORY_LIMITS.history - retained.length - 1;
    const history = historyCapacity > 0 ? prior.filter(item => item.status !== 'running' && item.status !== 'ready').slice(-historyCapacity) : [];
    await saveWorld({ ...world, storyAdvances: [...history, ...retained, record] });
    return { record, track, people, duplicate: false };
  });
  if (start.duplicate) return start.record;
  const { record, track, people } = start; const controller = new AbortController(), key = `${profile}:${record.id}`; running.set(key, controller);
  const settle = async (status: StoryAdvanceRecord['status'], proposals: StoryAdvanceProposal[] = [], error?: string): Promise<StoryAdvanceRecord> => withWorldMutation(async () => {
    if (profile !== getUserDataPath()) throw new Error('The active profile changed');
    if (status === 'ready') { controller.signal.throwIfAborted(); requireLivingWorld(loadSettings()); }
    const world = await loadWorld(); const existing = world.storyAdvances?.find(item => item.id === record.id);
    if (!existing) throw new Error('Source advancement is unavailable');
    const next = { ...existing, status, proposals, error, finishedAt: Date.now() };
    await saveWorld({ ...world, storyAdvances: world.storyAdvances!.map(item => item.id === record.id ? next : item) }); return next;
  });
  try {
    if (!people.length) return await settle('held', [], 'No persistent contacts are linked to this source edition.');
    if (people.length > STORY_LIMITS.castPerRun) return await settle('held', [], 'Too many linked contacts for one bounded advancement.');
    if (people.some(person => person.canon!.coverage?.some(range => !covered(track.completed, range)))) {
      return await settle('held', [], 'Progress moved behind an existing baseline. Create an earlier-story sandbox instead of erasing lived continuity.');
    }
    const sources = eligibleSources(track);
    if (!sources.length) return await settle('held', [], 'No confirmed source mappings are fully inside your declared progress. Add scoped source pages first.');
    // Read each new page once across the cast. Existing sourced summaries are retained independently per person.
    const needed = sources.filter(source => people.some(person => !covered(person.canon!.coverage ?? [], source)));
    if (!needed.length) return await settle('held', [], 'There is no newly mapped story material. Progress alone does not manufacture source knowledge.');
    if (needed.length > STORY_LIMITS.sourcePagesPerRun) return await settle('held', [], 'The new material exceeds one research pass. Map scoped summaries or advance in smaller steps.');
    const story = await readStorySources(needed, controller.signal, readSourcePage, ADVANCE_STORY_EVIDENCE_BYTES);
    if (story.excerpted) return await settle('held', [], 'A mapped source page exceeded the read limit. Map a shorter scoped source before advancing.');
    const proposals: StoryAdvanceProposal[] = [];
    for (const person of people) {
      controller.signal.throwIfAborted(); requireLivingWorld(loadSettings());
      if (profile !== getUserDataPath()) throw new Error('The active profile changed');
      const canon = person.canon!;
      const identityUrl = new URL(`/wiki/${encodeURIComponent(canon.characterPageTitle)}`, canon.fandomBaseUrl).toString();
      const coverage = normalizeProgress([...(canon.coverage ?? []), ...needed.map(source => ({ from: source.from, to: source.to }))]);
      const draft = await synthesizeCharacter({ name: person.displayName, wikiUrl: canon.fandomBaseUrl,
        pageTitle: canon.characterPageTitle, pageUrl: identityUrl,
        text: story.text, quotes: [],
        storyText: `Previously sourced background (not lived mLearn memories):\n${canon.baseline.context}\n\nNew scoped sources:\n${story.text}`,
        coverage, sources: [...canon.baseline.provenance, ...story.provenance].slice(-256), excerpted: story.excerpted }, loadSettings().language ?? DEFAULT_SETTINGS.language, controller.signal, record.id, 'background');
      proposals.push({ participantId: person.id, beforeHash: participantRevision(person), canon: { ...canon,
        trackRevision: track.revision, coverage, coordinate: { kind: 'point', value: formatProgress({ ...track, completed: coverage }) },
        // Advancing the story is not a silent re-authoring of voice/personality.
        baseline: { ...draft.baseline, lore: canon.baseline.lore, quotes: [...canon.baseline.quotes], generatedFill: [...canon.baseline.generatedFill] } } });
    }
    controller.signal.throwIfAborted();
    const ready = await settle('ready', proposals);
    controller.signal.throwIfAborted();
    return request.automatic ? await applyStoryAdvance(ready.id) : ready;
  } catch (error) {
    if (profile !== getUserDataPath()) throw error;
    return await settle(controller.signal.aborted ? 'cancelled' : 'failed', [], error instanceof Error ? error.message : String(error));
  } finally { running.delete(key); }
}
export async function applyStoryAdvance(id: string): Promise<StoryAdvanceRecord> {
  requireLivingWorld(loadSettings());
  return withWorldMutation(async () => {
    requireLivingWorld(loadSettings()); const world = await loadWorld(); const record = world.storyAdvances?.find(item => item.id === id);
    if (record?.status === 'applied') return record;
    if (!record || record.status !== 'ready' || !record.proposals.length) throw new Error('This source update is not ready to apply');
    const track = world.storyTracks?.find(item => item.id === record.trackId);
    let staleReason = !track || track.revision !== record.trackRevision
      ? 'The story declaration changed after research. No source baseline was updated.' : '';
    if (!staleReason) for (const proposal of record.proposals) {
      const person = world.participants.find(item => item.id === proposal.participantId);
      if (!person || participantRevision(person) !== proposal.beforeHash) {
        staleReason = 'A contact changed after research. No source baseline was updated.';
        break;
      }
    }
    if (staleReason) {
      const stale: StoryAdvanceRecord = { ...record, status: 'stale', error: staleReason, finishedAt: Date.now() };
      await saveWorld({ ...world, storyAdvances: world.storyAdvances!.map(item => item.id === id ? stale : item) });
      return stale;
    }
    const next: StoryAdvanceRecord = { ...record, status: 'applied', finishedAt: Date.now() };
    const byId = new Map(record.proposals.map(proposal => [proposal.participantId, proposal.canon]));
    await saveWorld({ ...world, participants: world.participants.map(person => byId.has(person.id) ? { ...person, canon: byId.get(person.id) } : person),
      storyAdvances: world.storyAdvances!.map(item => item.id === id ? next : item) }); return next;
  });
}
/** An interrupted read/research never resumes itself against a different profile or new progress. */
export async function reconcileStoryAdvances(): Promise<void> {
  await withWorldMutation(async () => { const world = await loadWorld();
    if (!world.storyAdvances?.some(item => item.status === 'running')) return;
    await saveWorld({ ...world, storyAdvances: world.storyAdvances.map(item => item.status === 'running'
      ? { ...item, status: 'failed', error: 'Source research was interrupted. Your prior baseline is unchanged.', finishedAt: Date.now() } : item) });
  });
}
