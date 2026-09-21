import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import type { JournalEvent, Participant, Room } from '../../shared/world';
import type { InferencePolicy } from '../../shared/inferencePolicy';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
  ipcMain: { handle: vi.fn() },
}));

let tempDir: TempDir;
let settings: Settings;
vi.mock('../utils/platform', () => ({ getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test') }));
vi.mock('./settings', () => ({ loadSettings: () => settings }));

let autonomy: typeof import('./autonomyService');
let journal: typeof import('./journalService');
let worldStore: typeof import('./worldStore');
let dreamer: typeof import('./dreamerService');

const policy: InferencePolicy = { kind: 'local', isPermitted: () => true, prefer: () => true };

function person(id: string, name: string, persona: string): Participant {
  return { id, displayName: name, kind: 'persistent', personaText: persona, setupComplete: true };
}

function seedWorld(room: Room, participants: Participant[]): void {
  fs.writeFileSync(path.join(tempDir.tmpDir, 'world.json'), JSON.stringify({ rooms: [room], threads: [], participants }, null, 2));
}

async function seedExchange(roomId: string, witnesses = ['user', 'a', 'b']): Promise<JournalEvent[]> {
  const user = await journal.appendEvent(roomId, {
    roomId, scope: { kind: 'sea' }, type: 'message.user', actorId: 'user', witnesses,
    payload: { text: 'We finished arranging the shared table.' },
  });
  const reply = await journal.appendEvent(roomId, {
    roomId, scope: { kind: 'sea' }, type: 'message.character', actorId: 'a', witnesses,
    payload: { text: 'The room is ready for our next small project.' },
  });
  return [user, reply];
}

function prompt(raw: string): Record<string, any> {
  return JSON.parse(raw) as Record<string, any>;
}

function intentionModel(callPrompts: string[]): (raw: string, participantId: string) => Promise<string> {
  return async (raw, participantId) => {
    callPrompts.push(raw);
    const value = prompt(raw);
    expect(value.participantId).toBe(participantId);
    const ids = (value.eligibleSources as Array<{ id: string }>).map(item => item.id);
    return JSON.stringify({
      decision: 'intend',
      text: 'Prepare a small seed-sorting activity with Bea because practical gardening matters to me.',
      sourceEventIds: ids,
    });
  };
}

function episodeModel(callPrompts: string[]): (raw: string, participantId: string) => Promise<string> {
  return async (raw, participantId) => {
    callPrompts.push(raw);
    const value = prompt(raw);
    if (String(value.task).startsWith('From only')) {
      expect(participantId).toBe('b');
      return JSON.stringify({ decision: 'accept', responseText: 'I will label the envelopes while you sort the seeds.' });
    }
    expect(participantId).toBe('a');
    const ids = (value.eligibleSources as Array<{ id: string }>).map(item => item.id);
    return JSON.stringify({
      decision: 'act',
      actionText: 'sorted the saved seeds into labeled envelopes with Bea.',
      leadMessage: 'Bea, would you label these envelopes while I sort the seeds?',
      inviteParticipantId: 'b',
      outcome: 'completed',
      sourceEventIds: ids,
      referencesUserContributionEventIds: [],
      affectedParticipantIds: ['a', 'b'],
    });
  };
}

function run(now: number, llmFn: (raw: string, participantId: string) => Promise<string>) {
  return autonomy.runAutonomyPass('room', { policy, llmFn, now, getSettings: () => settings });
}

describe('V09 autonomy service', () => {
  beforeEach(async () => {
    tempDir = createTempDir('mlearn-autonomy-');
    settings = { ...DEFAULT_SETTINGS, livingWorldEnabled: true, worldAutonomyEnabled: true, llmEnabled: true };
    vi.resetModules();
    [autonomy, journal, worldStore, dreamer] = await Promise.all([
      import('./autonomyService'),
      import('./journalService'),
      import('./worldStore'),
      import('./dreamerService'),
    ]);
    seedWorld(
      { id: 'room', title: 'Garden room', participantIds: ['a', 'b', 'c'], createdAt: 1 },
      [
        person('a', 'Ava', 'A practical gardener who enjoys patient small projects and trusts Bea.'),
        person('b', 'Bea', 'A careful illustrator who likes helping Ava organize shared work.'),
        person('c', 'Cora', 'A reserved reader who was not present for the shared exchange.'),
      ],
    );
  });

  afterEach(() => tempDir.cleanup());

  it('runs grounded intention -> participant-specific AI-to-AI episode -> canonical consequence with no user witness', async () => {
    const [user, reply] = await seedExchange('room');
    await journal.appendEvent('room', {
      roomId: 'room', scope: { kind: 'sea' }, type: 'disclosure', actorId: 'a', witnesses: ['a'],
      payload: { text: 'AVA_PRIVATE_NOTE' },
    });
    const intentionPrompts: string[] = [];
    const first = await run(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel(intentionPrompts));
    expect(first.kind).toBe('committed');
    let events = await journal.readSeaProjection('room');
    const intention = events.find(event => event.type === 'intention')!;
    expect(intention.actorId).toBe('a');
    expect(intention.witnesses).toEqual(['a']);
    expect(intention.witnesses).not.toContain('user');
    expect((intention.payload as { sourceEventIds: string[] }).sourceEventIds).toEqual([user.id, reply.id]);

    const episodePrompts: string[] = [];
    const second = await run(intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, episodeModel(episodePrompts));
    expect(second.kind).toBe('committed');
    events = await journal.readSeaProjection('room');
    const occurrence = events.find(event => event.type === 'occurrence.simulated')!;
    expect(occurrence.witnesses).toEqual(['a', 'b']);
    expect(occurrence.witnesses).not.toContain('user');
    expect(occurrence.witnesses).not.toContain('c');
    expect(occurrence.actorId).toBe('a');
    expect(occurrence.payload).toMatchObject({
      authority: 'simulated-occurrence',
      actorIds: ['a', 'b'],
      outcome: 'completed',
    });
    const offscreenMessages = events.filter(event => event.provenance?.autonomyJobId === second.jobId && event.type === 'message.character');
    expect(offscreenMessages.map(event => event.actorId)).toEqual(['a', 'b']);
    expect(offscreenMessages.every(event => !event.witnesses.includes('user'))).toBe(true);

    // B receives only B's entitled compiled context plus Ava's direct proposal;
    // Ava's earlier private disclosure never enters B's input.
    const bPrompt = episodePrompts.find(raw => prompt(raw).participantId === 'b')!;
    expect(bPrompt).not.toContain('AVA_PRIVATE_NOTE');
    expect(bPrompt).toContain('would you label these envelopes');

    const finalIntention = events.filter(event => event.type === 'intention').at(-1)!;
    expect(finalIntention.payload).toMatchObject({ status: 'completed', previousEventId: intention.id });
    const world = await worldStore.loadWorld();
    expect(world.autonomyJobs?.filter(job => job.status === 'committed')).toHaveLength(2);

    // Identical scheduler replay cannot duplicate either authoritative job.
    await run(intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 2, vi.fn(async () => { throw new Error('must not call'); }));
    expect((await journal.readSeaProjection('room')).filter(event => event.type === 'occurrence.simulated')).toHaveLength(1);
  });

  it('keeps a declining invitee as a witness and respondent, not an action actor', async () => {
    const [, reply] = await seedExchange('room');
    await run(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel([]));
    const intention = (await journal.readSeaProjection('room')).find(event => event.type === 'intention')!;
    await run(intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, async (raw, participantId) => {
      const value = prompt(raw);
      if (participantId === 'b') return JSON.stringify({ decision: 'decline', responseText: 'I cannot help with the labels now.' });
      const ids = (value.eligibleSources as Array<{ id: string }>).map(item => item.id);
      return JSON.stringify({
        decision: 'act', actionText: 'sorted the saved seeds into empty envelopes.',
        leadMessage: 'Bea, would you label these envelopes?', inviteParticipantId: 'b',
        outcome: 'pursued', sourceEventIds: ids, referencesUserContributionEventIds: [],
        affectedParticipantIds: ['a', 'b'],
      });
    });
    const occurrence = (await journal.readSeaProjection('room')).find(event => event.type === 'occurrence.simulated')!;
    expect(occurrence.witnesses).toEqual(['a', 'b']);
    expect(occurrence.payload).toMatchObject({ actorIds: ['a'], outcome: 'revised' });
  });

  it('makes no model call and no job when no work is eligible or autonomy is paused', async () => {
    const llmFn = vi.fn(async () => '{}');
    await journal.appendEvent('room', {
      roomId: 'room', scope: { kind: 'sea' }, type: 'message.user', actorId: 'user', witnesses: ['user', 'a', 'b'], payload: { text: 'hello' },
    });
    expect((await run(Date.now() + 60_000, llmFn)).kind).toBe('waiting');
    expect(llmFn).not.toHaveBeenCalled();
    expect((await worldStore.loadWorld()).autonomyJobs ?? []).toEqual([]);

    await seedExchange('room');
    settings = { ...settings, worldAutonomyEnabled: false };
    expect((await run(Date.now() + 60_000, llmFn)).kind).toBe('waiting');
    expect(llmFn).not.toHaveBeenCalled();
    expect((await worldStore.loadWorld()).autonomyJobs ?? []).toEqual([]);
  });

  it('backs off resource-blocked eligibility without polling inference', async () => {
    const [, reply] = await seedExchange('room');
    const blockedPolicy: InferencePolicy = { kind: 'conservative-cloud', isPermitted: () => false, prefer: () => false };
    const llmFn = vi.fn(async () => '{}');
    const now = reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1;
    const first = await autonomy.runAutonomyPass('room', { policy: blockedPolicy, llmFn, now, getSettings: () => settings });
    expect(first.kind).toBe('blocked');
    const blocked = (await worldStore.loadWorld()).autonomyJobs?.at(-1)!;
    expect(blocked.retryAt).toBe(now + autonomy.AUTONOMY_LIMITS.retryBackoffMs);

    const second = await autonomy.runAutonomyPass('room', {
      policy: blockedPolicy,
      llmFn,
      now: blocked.retryAt! - 1,
      getSettings: () => settings,
    });
    expect(second.kind).toBe('waiting');
    expect(llmFn).not.toHaveBeenCalled();
    expect((await worldStore.loadWorld()).autonomyJobs?.at(-1)?.attempts).toBe(1);
  });

  it('reconsiders a decision to wait once after backoff, then stops polling that job', async () => {
    const [, reply] = await seedExchange('room');
    const waitModel = vi.fn(async () => JSON.stringify({ decision: 'wait' }));
    const now = reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1;
    const first = await run(now, waitModel);
    expect(first.kind).toBe('deferred');
    const deferred = (await worldStore.loadWorld()).autonomyJobs?.at(-1)!;
    expect(deferred.status).toBe('deferred');

    expect((await run(deferred.retryAt! - 1, waitModel)).kind).toBe('waiting');
    expect(waitModel).toHaveBeenCalledTimes(1);
    expect((await run(deferred.retryAt! + 1, waitModel)).kind).toBe('skipped');
    expect(waitModel).toHaveBeenCalledTimes(2);
    const nextLead = await run(deferred.retryAt! + autonomy.AUTONOMY_LIMITS.retryBackoffMs + 2, waitModel);
    expect(nextLead.kind).toBe('deferred');
    expect(nextLead.jobId).not.toBe(deferred.jobId);
    expect(waitModel).toHaveBeenCalledTimes(3);
    expect((await worldStore.loadWorld()).autonomyJobs?.find(job => job.jobId === deferred.jobId)?.status).toBe('skipped');
  });

  it('advances fairly to another grounded person after one person exhausts a bounded wait', async () => {
    const [, reply] = await seedExchange('room');
    const waitModel = vi.fn(async () => JSON.stringify({ decision: 'wait' }));
    const now = reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1;
    const deferred = await run(now, waitModel);
    const retryAt = (await worldStore.loadWorld()).autonomyJobs?.find(job => job.jobId === deferred.jobId)?.retryAt;
    expect((await run(retryAt! + 1, waitModel)).kind).toBe('skipped');

    const seenParticipants: string[] = [];
    const next = await run(retryAt! + 2, async (raw, participantId) => {
      seenParticipants.push(participantId);
      const ids = (prompt(raw).eligibleSources as Array<{ id: string }>).map(item => item.id);
      return JSON.stringify({ decision: 'intend', text: 'Bea intends to make clear labels for the shared seeds.', sourceEventIds: ids });
    });
    expect(next.kind).toBe('committed');
    expect(seenParticipants).toEqual(['b']);
    expect((await journal.readSeaProjection('room')).find(event => event.type === 'intention')?.actorId).toBe('b');
  });

  it('fails closed when the model proposes the user as an offscreen participant', async () => {
    const [, reply] = await seedExchange('room');
    const first = await run(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel([]));
    const intention = (await journal.readSeaProjection('room')).find(event => event.type === 'intention')!;
    expect(first.kind).toBe('committed');
    const malicious = vi.fn(async (raw: string) => {
      const ids = (prompt(raw).eligibleSources as Array<{ id: string }>).map(item => item.id);
      return JSON.stringify({
        decision: 'act',
        actionText: 'completed the task after the user agreed.',
        leadMessage: 'You agreed to help.',
        inviteParticipantId: 'user',
        outcome: 'completed',
        sourceEventIds: ids,
        referencesUserContributionEventIds: [],
        affectedParticipantIds: ['a', 'user'],
      });
    });
    const result = await run(intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, malicious);
    expect(result.kind).toBe('failed');
    expect(malicious).toHaveBeenCalledTimes(autonomy.AUTONOMY_LIMITS.modelRepairAttempts);
    expect((await journal.readSeaProjection('room')).some(event => event.type === 'occurrence.simulated')).toBe(false);
    expect((await worldStore.loadWorld()).autonomyJobs?.at(-1)?.status).toBe('failed');
  });

  it('fails closed when output claims authority over a nonparticipant private state', async () => {
    const [, reply] = await seedExchange('room');
    await run(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel([]));
    const intention = (await journal.readSeaProjection('room')).find(event => event.type === 'intention')!;
    const malicious = vi.fn(async (raw: string) => {
      const ids = (prompt(raw).eligibleSources as Array<{ id: string }>).map(item => item.id);
      return JSON.stringify({
        decision: 'act',
        actionText: 'changed Cora private plans without speaking to her.',
        outcome: 'completed',
        sourceEventIds: ids,
        referencesUserContributionEventIds: [],
        affectedParticipantIds: ['a', 'c'],
      });
    });
    const result = await run(intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, malicious);
    expect(result.kind).toBe('failed');
    expect(malicious).toHaveBeenCalledTimes(autonomy.AUTONOMY_LIMITS.modelRepairAttempts);
    expect((await journal.readSeaProjection('room')).some(event => event.type === 'occurrence.simulated')).toBe(false);
  });

  it('caps recursive autonomous follow-through for one intention', async () => {
    const [, reply] = await seedExchange('room');
    await run(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel([]));
    const stepModel = vi.fn(async (raw: string) => {
      const ids = (prompt(raw).eligibleSources as Array<{ id: string }>).map(item => item.id);
      return JSON.stringify({
        decision: 'act',
        actionText: 'made one bounded step on the seed project.',
        outcome: 'pursued',
        sourceEventIds: ids,
        referencesUserContributionEventIds: [],
        affectedParticipantIds: ['a'],
      });
    });
    for (let index = 0; index < autonomy.AUTONOMY_LIMITS.followThroughsPerIntention; index++) {
      const latest = (await journal.readSeaProjection('room')).filter(event => event.type === 'intention').at(-1)!;
      expect((await run(latest.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, stepModel)).kind).toBe('committed');
    }
    const latest = (await journal.readSeaProjection('room')).filter(event => event.type === 'intention').at(-1)!;
    expect((await run(latest.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, stepModel)).kind).toBe('waiting');
    expect(stepModel).toHaveBeenCalledTimes(autonomy.AUTONOMY_LIMITS.followThroughsPerIntention);
    expect((await journal.readSeaProjection('room')).filter(event => event.type === 'occurrence.simulated')).toHaveLength(
      autonomy.AUTONOMY_LIMITS.followThroughsPerIntention,
    );
  });

  it('cancels stale open-loop work when foreground history resolves the prerequisite during inference', async () => {
    const [user, reply] = await seedExchange('room');
    const loop = await journal.appendEvent('room', {
      roomId: 'room', scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'a', witnesses: ['a'],
      payload: { ownerId: 'a', kind: 'open-loop', text: 'Decide how to label the saved seeds.', sourceEventIds: [user.id] },
    });
    const result = await run(Math.max(loop.createdAt, reply.createdAt) + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, async (raw) => {
      await journal.appendEvent('room', {
        roomId: 'room', scope: { kind: 'sea' }, type: 'resolution', actorId: 'a', witnesses: ['a'],
        payload: { ownerId: 'a', loopId: loop.id, status: 'satisfied', text: 'Resolved in the foreground.', sourceEventIds: [reply.id] },
      });
      const ids = (prompt(raw).eligibleSources as Array<{ id: string }>).map(item => item.id);
      return JSON.stringify({ decision: 'intend', text: 'Handle the old unresolved label question.', sourceEventIds: ids });
    });
    expect(result.kind).toBe('cancelled');
    expect((await journal.readSeaProjection('room')).some(event => event.type === 'intention')).toBe(false);
    expect((await worldStore.loadWorld()).autonomyJobs?.at(-1)?.status).toBe('cancelled');
  });

  it('keeps rows hidden across a commit failure and recovers the exact prepared operation once', async () => {
    const [, reply] = await seedExchange('room');
    const originalAppend = fs.promises.appendFile.bind(fs.promises);
    const originalRename = fs.promises.rename.bind(fs.promises);
    let autonomyRowWritten = false;
    let failedCommit = false;
    const appendSpy = vi.spyOn(fs.promises, 'appendFile').mockImplementation(async (file, data, options) => {
      if (String(data).includes('autonomyJobId')) autonomyRowWritten = true;
      return originalAppend(file, data, options);
    });
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (autonomyRowWritten && !failedCommit && String(newPath).endsWith('world.json')) {
        failedCommit = true;
        throw new Error('injected world commit failure');
      }
      return originalRename(oldPath, newPath);
    });
    const result = await run(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel([]));
    expect(result.kind).toBe('failed');
    const pending = (await worldStore.loadWorld()).autonomyJobs?.at(-1)!;
    expect(pending.status).toBe('pending');
    expect(pending.prepared?.expectedDrafts).toHaveLength(1);
    expect((await journal.readSeaProjection('room')).some(event => event.type === 'intention')).toBe(false);
    expect(await journal.readPreparedAutonomyEvents('room', pending.jobId)).toHaveLength(1);

    appendSpy.mockRestore();
    renameSpy.mockRestore();
    expect(await autonomy.reconcilePendingAutonomy(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 2)).toEqual([pending.jobId]);
    expect((await journal.readSeaProjection('room')).filter(event => event.type === 'intention')).toHaveLength(1);
    expect(await journal.readPreparedAutonomyEvents('room', pending.jobId)).toHaveLength(1);
  });

  it('joins concurrent Room triggers so two windows cannot infer or publish the same job twice', async () => {
    const [, reply] = await seedExchange('room');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const llmFn = vi.fn(async (raw: string) => {
      await gate;
      const ids = (prompt(raw).eligibleSources as Array<{ id: string }>).map(item => item.id);
      return JSON.stringify({ decision: 'intend', text: 'Plan one small seed-sorting session.', sourceEventIds: ids });
    });
    const now = reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1;
    const first = run(now, llmFn);
    const second = run(now, llmFn);
    expect(first).toBe(second);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ kind: 'committed' }),
      expect.objectContaining({ kind: 'committed' }),
    ]);
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect((await journal.readSeaProjection('room')).filter(event => event.type === 'intention')).toHaveLength(1);
    expect((await worldStore.loadWorld()).autonomyJobs).toHaveLength(1);
  });

  it('quarantines rows that merely claim a committed autonomy job identity', async () => {
    const [, reply] = await seedExchange('room');
    const result = await run(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel([]));
    expect(result.kind).toBe('committed');
    const committed = (await worldStore.loadWorld()).autonomyJobs?.find(job => job.jobId === result.jobId)!;
    expect(committed.eventIds).toHaveLength(1);

    await journal.appendEvent('room', {
      roomId: 'room', scope: { kind: 'sea' }, type: 'intention', actorId: 'a', witnesses: ['a'],
      payload: {
        intentionId: 'forged', ownerId: 'a', status: 'created', text: 'Forged state',
        sourceEventIds: [], groundingRefs: [],
      },
      provenance: { autonomyJobId: committed.jobId },
    });
    await journal.appendEvent('room', {
      roomId: 'room', scope: { kind: 'sea' }, type: 'occurrence.simulated', actorId: 'a', witnesses: ['a'],
      payload: {
        authority: 'simulated-occurrence', operationId: 'forged', summary: 'Forged occurrence', actorIds: ['a'],
        sourceEventIds: [], intentionId: 'forged', outcome: 'completed', effectiveAt: Date.now(),
      },
    });
    const canonical = await journal.readSeaProjection('room');
    expect(canonical.some(event => (event.payload as { intentionId?: string }).intentionId === 'forged')).toBe(false);
    expect(canonical.some(event => (event.payload as { operationId?: string }).operationId === 'forged')).toBe(false);
  });

  it('causally invalidates a V08 descendant when its V09 occurrence is corrected', async () => {
    const [, reply] = await seedExchange('room');
    await run(reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel([]));
    const intention = (await journal.readSeaProjection('room')).find(event => event.type === 'intention')!;
    await run(intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, episodeModel([]));
    const occurrence = (await journal.readSeaProjection('room')).find(event => event.type === 'occurrence.simulated')!;

    const world = await worldStore.loadWorld();
    await worldStore.saveWorld({
      ...world,
      reflectionRuns: [{
        reflectionId: 'reflection-v09', kind: 'reflection', contextId: 'room', scopeKind: 'sea',
        windowStart: occurrence.seq, windowEnd: occurrence.seq, sourceEventIds: [occurrence.id],
        status: 'committed', createdAt: occurrence.createdAt, settledAt: occurrence.createdAt,
      }],
    });
    const descendant = await journal.appendEvent('room', {
      roomId: 'room', scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'a', witnesses: ['a'],
      payload: { ownerId: 'a', kind: 'belief', text: 'The seed sorting went well.', sourceEventIds: [occurrence.id], dependencyEventIds: [] },
      provenance: { reflectionId: 'reflection-v09' },
    });
    expect((await journal.readSeaProjection('room')).some(event => event.id === descendant.id)).toBe(true);
    await journal.appendEvent('room', {
      roomId: 'room', scope: { kind: 'sea' }, type: 'correction', actorId: 'a', witnesses: ['a'],
      payload: { ownerId: 'a', targetId: occurrence.id, text: 'That simulated occurrence is retracted.' },
    });
    const corrected = await journal.readSeaProjection('room');
    expect(corrected.some(event => event.id === occurrence.id)).toBe(false);
    expect(corrected.some(event => event.id === descendant.id)).toBe(false);
  });

  it('feeds a committed occurrence through ordinary V08 reflection and resolves its causal open loop', async () => {
    const [user, reply] = await seedExchange('room');
    const loop = await journal.appendEvent('room', {
      roomId: 'room', scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'a', witnesses: ['a'],
      payload: { ownerId: 'a', kind: 'open-loop', text: 'Sort the saved seeds.', sourceEventIds: [user.id, reply.id] },
    });
    await run(loop.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, intentionModel([]));
    const intention = (await journal.readSeaProjection('room')).find(event => event.type === 'intention')!;
    await run(intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, episodeModel([]));
    const occurrence = (await journal.readSeaProjection('room')).find(event => event.type === 'occurrence.simulated')!;
    expect((occurrence.payload as { sourceEventIds: string[] }).sourceEventIds).toContain(loop.id);

    await dreamer.runDreamer('room', {
      policy,
      now: occurrence.createdAt + 1,
      llmFn: async (raw) => {
        const value = prompt(raw);
        const ownerId = String((value.outputSchema as { beliefs: Array<{ ownerId: string }> }).beliefs[0].ownerId);
        const occurrenceInput = (value.events as Array<{ id: string; type: string; resolvesLoops?: number[] }>).find(event => event.type === 'occurrence.simulated');
        if (!occurrenceInput) return JSON.stringify({ beliefs: [] });
        return JSON.stringify({
          beliefs: [{ ownerId, kind: 'belief', text: 'The seed sorting became a completed shared project.', sourceEventIds: [occurrenceInput.id] }],
          ...(occurrenceInput.resolvesLoops?.includes(1) ? {
            resolutions: [{ ownerId, loop: 1, status: 'satisfied', text: 'The saved seeds were sorted.', sourceEventIds: [occurrenceInput.id] }],
          } : {}),
        });
      },
    });
    const reflected = await journal.readSeaProjection('room');
    const resolution = reflected.find(event => event.type === 'resolution' && event.provenance?.reflectionId);
    expect(resolution?.payload).toMatchObject({ ownerId: 'a', loopId: loop.id, status: 'satisfied' });
    expect(reflected.some(event => event.type === 'memory.belief'
      && event.provenance?.reflectionId && (event.payload as { sourceEventIds: string[] }).sourceEventIds.includes(occurrence.id))).toBe(true);
  });
});
