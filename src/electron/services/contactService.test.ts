import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import type { ContactRecord, JournalEvent, Participant, Room } from '../../shared/world';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), isPackaged: false },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

let contact: typeof import('./contactService');
let journal: typeof import('./journalService');

const now = Date.now() + 30_000;
const room: Room = {
  id: 'room-1',
  title: 'Garden room',
  participantIds: ['mara'],
  createdAt: now - 100_000,
};
const mara: Participant = {
  id: 'mara',
  displayName: 'Mara',
  kind: 'persistent',
  personaText: 'Mara maintains the shared seed library and follows through on practical work.',
  setupComplete: true,
};

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    livingWorldEnabled: true,
    worldAutonomyEnabled: true,
    proactivityEnabled: true,
    llmEnabled: true,
    ...overrides,
  };
}

function seedWorld(): void {
  fs.writeFileSync(path.join(tempDir.tmpDir, 'settings.json'), JSON.stringify(settings(), null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(tempDir.tmpDir, 'world.json'),
    JSON.stringify({ rooms: [room], threads: [], participants: [mara], autonomyJobs: [], contacts: [] }, null, 2),
    'utf-8',
  );
}

async function append(draft: Omit<Parameters<typeof journal.appendEvent>[1], 'roomId' | 'scope'>): Promise<JournalEvent> {
  return journal.appendEvent(room.id, { ...draft, roomId: room.id, scope: { kind: 'sea' } });
}

async function seedGroundedCause(): Promise<JournalEvent> {
  await append({
    type: 'message.user', actorId: 'user', witnesses: ['user', mara.id],
    payload: { text: 'Let me know if anything changes with the seed catalog.' },
  });
  await append({
    type: 'message.character', actorId: mara.id, witnesses: ['user', mara.id],
    payload: { text: 'I will keep an eye on it.' },
  });
  const occurrence = await append({
    type: 'occurrence.simulated', actorId: mara.id, witnesses: [mara.id],
    payload: {
      authority: 'simulated-occurrence', operationId: 'episode-1',
      summary: 'Mara found that the seed catalog now has two conflicting entries.',
      actorIds: [mara.id], sourceEventIds: [], intentionId: 'intention-1',
      outcome: 'pursued', effectiveAt: now - 20_000,
    },
    provenance: { autonomyJobId: 'autonomy-1' },
  });
  const world = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as Record<string, unknown>;
  world.autonomyJobs = [{
    jobId: 'autonomy-1', roomId: room.id, candidateKind: 'intention-follow-through',
    leadParticipantId: mara.id, participantIds: [mara.id], sourceEventIds: [],
    candidateHash: 'cause', status: 'committed', attempts: 1, createdAt: now - 30_000,
    eligibleAt: now - 30_000, settledAt: now - 20_000, result: 'episode', eventIds: [occurrence.id],
  }];
  fs.writeFileSync(path.join(tempDir.tmpDir, 'world.json'), JSON.stringify(world, null, 2), 'utf-8');
  return occurrence;
}

describe('contactService', () => {
  beforeEach(async () => {
    tempDir = createTempDir('mlearn-contact-test-');
    vi.resetModules();
    contact = await import('./contactService');
    journal = await import('./journalService');
    seedWorld();
  });

  afterEach(() => tempDir.cleanup());

  it('commits one grounded proactive message before delivery and replays the same contact idempotently', async () => {
    const cause = await seedGroundedCause();
    const llmFn = vi.fn(async () => JSON.stringify({
      decision: 'message',
      text: 'I found two conflicting seed-catalog entries. Could you help me decide which one to keep?',
      reason: 'The catalog conflict affects the work we already discussed.',
      sourceEventIds: [cause.id],
    }));
    const deps = {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local' as const, isPermitted: () => true, prefer: () => true },
      llmFn,
    };

    const first = await contact.runContactPass(room.id, deps);
    const replay = await contact.runContactPass(room.id, deps);
    const world = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as {
      contacts: Array<{ contactId: string; status: string; eventIds?: string[]; sourceEventIds: string[] }>;
    };
    const events = await journal.readSeaProjection(room.id);
    const messages = events.filter(event => event.type === 'message.character'
      && event.provenance?.contactId === first.contactId);

    expect(first).toMatchObject({ kind: 'ready', contactId: expect.any(String) });
    expect(replay).toEqual(first);
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect(world.contacts).toHaveLength(1);
    expect(world.contacts[0]).toMatchObject({
      contactId: first.contactId,
      status: 'ready',
      sourceEventIds: [cause.id],
      eventIds: [messages[0]?.id],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.actorId).toBe(mara.id);
    expect(messages[0]?.witnesses).toEqual([mara.id, 'user']);
  });

  it('does no model work without a cause and fails closed when proactive inference resources are unavailable', async () => {
    const llmFn = vi.fn(async () => '{}');
    const noCause = await contact.runContactPass(room.id, {
      now, getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true }, llmFn,
    });
    expect(noCause.kind).toBe('waiting');
    expect(llmFn).not.toHaveBeenCalled();

    await seedGroundedCause();
    const blocked = await contact.runContactPass(room.id, {
      now, getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => false, prefer: () => false }, llmFn,
    });
    expect(blocked.kind).toBe('blocked');
    expect(llmFn).not.toHaveBeenCalled();
  });

  it('recovers an interrupted delivery with the stable notification id and activates idempotently', async () => {
    const cause = await seedGroundedCause();
    const deps = {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local' as const, isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message', text: 'The seed catalog has a conflict. Can we review it?',
        reason: 'A new catalog conflict affects our existing work.', sourceEventIds: [cause.id],
      }),
    };
    const created = await contact.runContactPass(room.id, deps);
    const worldPath = path.join(tempDir.tmpDir, 'world.json');
    const interrupted = JSON.parse(fs.readFileSync(worldPath, 'utf-8')) as {
      contacts: Array<Record<string, unknown>>;
    };
    interrupted.contacts[0] = {
      ...interrupted.contacts[0], status: 'attempted', deliveryAttempts: 1,
      attemptedAt: now - 1_000,
      history: [...(interrupted.contacts[0].history as unknown[]), { status: 'attempted', at: now - 1_000 }],
    };
    fs.writeFileSync(worldPath, JSON.stringify(interrupted, null, 2), 'utf-8');

    const attempt = vi.fn(() => 'attempted' as const);
    const recovered = await contact.reconcileContactDelivery(room.id, {
      now,
      getSettings: () => settings(),
      attempt,
    });
    await contact.reconcileContactDelivery(room.id, { now, getSettings: () => settings(), attempt });
    const firstActivation = await contact.activateContact(created.contactId!, now + 1);
    const secondActivation = await contact.activateContact(created.contactId!, now + 2);
    const after = JSON.parse(fs.readFileSync(worldPath, 'utf-8')) as {
      contacts: Array<{ status: string; deliveryAttempts: number; history: Array<{ status: string }> }>;
    };

    expect(recovered).toMatchObject({ attempted: [created.contactId] });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith(expect.objectContaining({
      contactId: created.contactId,
      notificationId: created.contactId,
      body: 'Mara sent you a message',
    }), expect.any(Object));
    expect(firstActivation).toMatchObject({ ok: true, contact: { status: 'opened' } });
    expect(secondActivation).toMatchObject({ ok: true, contact: { status: 'opened' } });
    expect(after.contacts[0].deliveryAttempts).toBe(2);
    expect(after.contacts[0].history.filter(item => item.status === 'opened')).toHaveLength(1);
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId === created.contactId)).toHaveLength(1);
  });

  it('never lets a concurrent delivery attempt downgrade an opened contact', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'call', text: 'The catalog review slot is available now.',
        reason: 'The existing catalog conflict is ready for synchronous review.',
        sourceEventIds: [cause.id],
      }),
    });
    const opened = await contact.activateContact(created.contactId!, now + 1);
    if (!opened.ok) throw new Error(opened.reason);
    const afterStaleAttempt = contact.contactInternals.beginDeliveryAttempt(
      opened.contact as ContactRecord,
      now + 2,
    );

    expect(afterStaleAttempt.status).toBe('opened');
    expect(afterStaleAttempt.deliveryAttempts).toBe(0);
    expect(afterStaleAttempt.history.filter(item => item.status === 'opened')).toHaveLength(1);
  });

  it('does not reschedule or redisplay an already shown contact when quiet hours begin', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message', text: 'The catalog conflict is ready to review.',
        reason: 'The conflict affects our existing catalog work.',
        sourceEventIds: [cause.id],
      }),
    });
    await contact.markContactDelivered(created.contactId!, now + 1);
    const attempt = vi.fn(() => 'attempted' as const);
    const result = await contact.reconcileContactDelivery(room.id, {
      now: now + 2,
      getSettings: () => settings({
        proactiveQuietHoursEnabled: true,
        proactiveQuietHoursStart: '00:00',
        proactiveQuietHoursEnd: '23:59',
      }),
      attempt,
    });
    const world = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as {
      contacts: Array<{ status: string }>;
    };

    expect(result).toEqual({ attempted: [], unavailable: [], expired: [], suppressed: [] });
    expect(attempt).not.toHaveBeenCalled();
    expect(world.contacts[0].status).toBe('delivered');
  });

  it('does not duplicate an unknown external delivery after a backward clock adjustment', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message', text: 'The catalog conflict is ready to review.',
        reason: 'The conflict affects our existing catalog work.',
        sourceEventIds: [cause.id],
      }),
    });
    const attempt = vi.fn(() => 'attempted' as const);

    await contact.reconcileContactDelivery(room.id, { now, getSettings: () => settings(), attempt });
    await contact.reconcileContactDelivery(room.id, {
      now: now - 12 * 60 * 60_000,
      getSettings: () => settings(),
      attempt,
    });
    const world = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as {
      contacts: Array<{ status: string; deliveryAttempts: number }>;
    };

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(world.contacts[0]).toMatchObject({ status: 'delivery-unknown', deliveryAttempts: 1 });
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId === created.contactId)).toHaveLength(1);
  });

  it('expires multiple elapsed contacts on resume without emitting a notification storm', async () => {
    const cause = await seedGroundedCause();
    await contact.runContactPass(room.id, {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message', text: 'The catalog conflict is ready to review.',
        reason: 'The conflict affects our existing catalog work.',
        sourceEventIds: [cause.id],
      }),
    });
    const worldPath = path.join(tempDir.tmpDir, 'world.json');
    const seeded = JSON.parse(fs.readFileSync(worldPath, 'utf-8')) as { contacts: ContactRecord[] };
    const first = { ...seeded.contacts[0], expiresAt: now - 2_000 };
    const second: ContactRecord = {
      ...first,
      contactId: `${first.contactId}-elapsed`,
      operationId: `${first.operationId}-elapsed`,
      expiresAt: now - 1_000,
      history: [...first.history],
    };
    seeded.contacts = [first, second];
    fs.writeFileSync(worldPath, JSON.stringify(seeded, null, 2), 'utf-8');
    const attempt = vi.fn(() => 'attempted' as const);

    const result = await contact.reconcileContactDelivery(room.id, {
      now,
      getSettings: () => settings(),
      attempt,
    });
    const after = JSON.parse(fs.readFileSync(worldPath, 'utf-8')) as {
      contacts: Array<{ status: string }>;
    };

    expect(result.expired).toEqual([first.contactId, second.contactId]);
    expect(attempt).not.toHaveBeenCalled();
    expect(after.contacts.map(item => item.status)).toEqual(['expired', 'expired']);
  });

  it('requires an opened canonical call invitation before one idempotent accept', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'call', text: 'Could we talk briefly about the conflicting catalog entries?',
        reason: 'The catalog choice is time-sensitive within the existing seed-library work.',
        sourceEventIds: [cause.id],
      }),
    });
    const beforeOpen = await contact.respondToContact(created.contactId!, 'accept', now);
    await contact.activateContact(created.contactId!, now + 1);
    const accepted = await contact.respondToContact(created.contactId!, 'accept', now + 2);
    const replay = await contact.respondToContact(created.contactId!, 'accept', now + 3);
    const conflicting = await contact.respondToContact(created.contactId!, 'decline', now + 4);
    const events = await journal.readSeaProjection(room.id);

    expect(created).toMatchObject({ kind: 'ready', contactId: expect.any(String) });
    expect(beforeOpen).toMatchObject({ ok: false, reason: expect.stringContaining('opened') });
    expect(accepted).toMatchObject({ ok: true, contact: { status: 'accepted', modality: 'call' } });
    expect(replay).toEqual(accepted);
    expect(conflicting).toMatchObject({ ok: false, reason: expect.stringContaining('already accepted') });
    expect(events.filter(event => event.type === 'contact.invitation'
      && event.provenance?.contactId === created.contactId)).toHaveLength(1);
    expect(events.filter(event => event.type === 'message.user')).toHaveLength(1);
  });

  it('serializes competing call responses so only one terminal choice wins', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'call', text: 'Could we talk briefly about the conflicting catalog entries?',
        reason: 'The catalog choice is ready for synchronous review.',
        sourceEventIds: [cause.id],
      }),
    });
    await contact.activateContact(created.contactId!, now + 1);

    const results = await Promise.all([
      contact.respondToContact(created.contactId!, 'accept', now + 2),
      contact.respondToContact(created.contactId!, 'decline', now + 2),
    ]);
    const stored = (JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as {
      contacts: ContactRecord[];
    }).contacts[0];

    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(['accepted', 'declined']).toContain(stored.status);
    expect(stored.history.filter(item => item.status === 'accepted' || item.status === 'declined')).toHaveLength(1);
  });

  it('cancels publication when background provider permission is revoked during inference', async () => {
    const cause = await seedGroundedCause();
    let currentSettings = settings({ llmProvider: 'ollama' });
    const result = await contact.runContactPass(room.id, {
      now,
      getSettings: () => currentSettings,
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => {
        currentSettings = settings({ llmProvider: 'cloud', inferenceCloudTier: 'conservative' });
        return JSON.stringify({
          decision: 'message', text: 'Could we review the catalog conflict?',
          reason: 'This follows the established catalog work.', sourceEventIds: [cause.id],
        });
      },
    });

    expect(result.kind).toBe('nothing');
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId)).toHaveLength(0);
  });

  it('keeps quiet-hour contact in-app but suppresses stale foreground-resolved delivery', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message', text: 'Could we resolve the seed-catalog conflict?',
        reason: 'The existing catalog conflict is unresolved.', sourceEventIds: [cause.id],
      }),
    });
    const attempt = vi.fn(() => 'attempted' as const);
    const quietSettings = settings({
      proactiveQuietHoursEnabled: true,
      proactiveQuietHoursStart: '00:00',
      proactiveQuietHoursEnd: '23:59',
    });
    const quiet = await contact.reconcileContactDelivery(room.id, {
      now, getSettings: () => quietSettings, attempt,
    });
    await append({
      type: 'message.user', actorId: 'user', witnesses: ['user', mara.id],
      payload: { text: 'I already fixed the conflicting catalog entries.' },
    });
    const resumed = await contact.reconcileContactDelivery(room.id, {
      now: now + 60_000,
      getSettings: () => settings({ proactiveQuietHoursEnabled: false }),
      attempt,
    });
    const world = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as {
      contacts: Array<{ status: string }>;
    };

    expect(quiet).toEqual({ attempted: [], unavailable: [], expired: [], suppressed: [created.contactId] });
    expect(resumed.suppressed).toEqual([created.contactId]);
    expect(attempt).not.toHaveBeenCalled();
    expect(world.contacts[0].status).toBe('superseded');
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId === created.contactId)).toHaveLength(1);
  });

  it('joins concurrent Room passes and commits no duplicate contact or model work', async () => {
    const cause = await seedGroundedCause();
    const gate = Promise.withResolvers<string>();
    const llmFn = vi.fn(() => gate.promise);
    const deps = {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local' as const, isPermitted: () => true, prefer: () => true },
      llmFn,
    };
    const first = contact.runContactPass(room.id, deps);
    const second = contact.runContactPass(room.id, deps);
    await vi.waitFor(() => expect(llmFn).toHaveBeenCalledTimes(1));
    gate.resolve(JSON.stringify({
      decision: 'message', text: 'Can we review the conflicting seed-catalog entries?',
      reason: 'The catalog conflict affects our established work.', sourceEventIds: [cause.id],
    }));
    const results = await Promise.all([first, second]);
    const world = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as {
      contacts: unknown[];
    };

    expect(results[0]).toEqual(results[1]);
    expect(world.contacts).toHaveLength(1);
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId)).toHaveLength(1);
  });

  it('persists a first-class no-contact result and rejects manipulative generated reasons', async () => {
    const cause = await seedGroundedCause();
    const base = {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local' as const, isPermitted: () => true, prefer: () => true },
    };
    const noContact = await contact.runContactPass(room.id, {
      ...base,
      llmFn: async () => JSON.stringify({ decision: 'nothing' }),
    });
    const firstWorld = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as {
      contacts: Array<{ status: string; reason?: string }>;
    };
    expect(noContact.kind).toBe('nothing');
    expect(firstWorld.contacts[0]).toMatchObject({
      status: 'cancelled',
      reason: 'The grounded participant decided not to contact the user',
    });
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId)).toHaveLength(0);

    // A corrected, distinct cause is needed because a durable no-contact
    // decision is idempotent for its original cause.
    const secondCause = await append({
      type: 'occurrence.simulated', actorId: mara.id, witnesses: [mara.id],
      payload: {
        authority: 'simulated-occurrence', operationId: 'episode-2',
        summary: 'Mara found a second catalog discrepancy.', actorIds: [mara.id],
        sourceEventIds: [cause.id], intentionId: 'intention-2', outcome: 'pursued', effectiveAt: now,
      },
      provenance: { autonomyJobId: 'autonomy-2' },
    });
    const worldPath = path.join(tempDir.tmpDir, 'world.json');
    const seeded = JSON.parse(fs.readFileSync(worldPath, 'utf-8')) as Record<string, unknown>;
    seeded.autonomyJobs = [...(seeded.autonomyJobs as unknown[]), {
      jobId: 'autonomy-2', roomId: room.id, candidateKind: 'intention-follow-through',
      leadParticipantId: mara.id, participantIds: [mara.id], sourceEventIds: [cause.id],
      candidateHash: 'cause-2', status: 'committed', attempts: 1, createdAt: now,
      eligibleAt: now, settledAt: now, result: 'episode', eventIds: [secondCause.id],
    }];
    fs.writeFileSync(worldPath, JSON.stringify(seeded, null, 2), 'utf-8');
    const manipulative = await contact.runContactPass(room.id, {
      ...base,
      now: now + contact.CONTACT_LIMITS.eligibilityDelayMs + 1,
      llmFn: async () => JSON.stringify({
        decision: 'message', text: "Everyone is waiting on you. Please don't let us down.",
        reason: 'Pressure the user to return for the group.', sourceEventIds: [secondCause.id],
      }),
    });
    expect(manipulative.kind).toBe('failed');
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId)).toHaveLength(0);

    const sourceSet = new Set([secondCause.id]);
    for (const text of [
      'Call the library and ask them to resolve it.',
      'Transfer money through Cash App to reserve the seeds.',
      'Message the coordinator on Instagram.',
    ]) {
      expect(contact.contactInternals.parseProposal(JSON.stringify({
        decision: 'message', text, reason: 'Take action outside mLearn.', sourceEventIds: [secondCause.id],
      }), sourceSet, secondCause.id)).toBeNull();
    }
  });

  it('rejects notification-bound dialogue that copies participant-private state outside the cause', async () => {
    await append({
      type: 'disclosure', actorId: mara.id, witnesses: [mara.id],
      payload: { text: 'PRIVATE_MARA_DETAIL_74e94: Mara is quietly planning an unrelated surprise.' },
    });
    const cause = await seedGroundedCause();
    const result = await contact.runContactPass(room.id, {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message',
        text: 'PRIVATE_MARA_DETAIL_74e94: Mara is quietly planning an unrelated surprise.',
        reason: 'Use private state to create contact.',
        sourceEventIds: [cause.id],
      }),
    });

    expect(result.kind).toBe('failed');
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId)).toHaveLength(0);
  });

  it('enforces a durable contact cooldown before spending inference on a newer cause', async () => {
    const firstCause = await seedGroundedCause();
    const llmFn = vi.fn(async (prompt: string) => {
      const parsed = JSON.parse(prompt) as { eligibleSources: Array<{ id: string }> };
      return JSON.stringify({
        decision: 'message', text: 'Could we review the catalog update?',
        reason: 'A grounded catalog change affects our existing work.',
        sourceEventIds: [parsed.eligibleSources[0].id],
      });
    });
    const deps = {
      now,
      getSettings: () => settings(),
      policy: { kind: 'local' as const, isPermitted: () => true, prefer: () => true },
      llmFn,
    };
    await contact.runContactPass(room.id, deps);
    const secondCause = await append({
      type: 'occurrence.simulated', actorId: mara.id, witnesses: [mara.id],
      payload: {
        authority: 'simulated-occurrence', operationId: 'episode-cooldown',
        summary: 'Mara discovered another relevant catalog conflict.', actorIds: [mara.id],
        sourceEventIds: [firstCause.id], intentionId: 'intention-cooldown', outcome: 'pursued', effectiveAt: now + 1,
      },
      provenance: { autonomyJobId: 'autonomy-cooldown' },
    });
    const worldPath = path.join(tempDir.tmpDir, 'world.json');
    const seeded = JSON.parse(fs.readFileSync(worldPath, 'utf-8')) as Record<string, unknown>;
    seeded.autonomyJobs = [...(seeded.autonomyJobs as unknown[]), {
      jobId: 'autonomy-cooldown', roomId: room.id, candidateKind: 'intention-follow-through',
      leadParticipantId: mara.id, participantIds: [mara.id], sourceEventIds: [firstCause.id],
      candidateHash: 'cooldown', status: 'committed', attempts: 1, createdAt: now,
      eligibleAt: now, settledAt: now, result: 'episode', eventIds: [secondCause.id],
    }];
    fs.writeFileSync(worldPath, JSON.stringify(seeded, null, 2), 'utf-8');

    const blocked = await contact.runContactPass(room.id, {
      ...deps,
      now: now + contact.CONTACT_LIMITS.eligibilityDelayMs + 2,
    });

    expect(blocked.kind).toBe('blocked');
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect((JSON.parse(fs.readFileSync(worldPath, 'utf-8')) as { contacts: unknown[] }).contacts).toHaveLength(1);
  });

  it('keeps a canonical message usable when OS notifications are denied', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now, getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message', text: 'The catalog conflict is ready to review.',
        reason: 'This follows the established catalog work.', sourceEventIds: [cause.id],
      }),
    });
    const attempt = vi.fn(() => 'denied' as const);
    const delivery = await contact.reconcileContactDelivery(room.id, { now, getSettings: () => settings(), attempt });
    await contact.reconcileContactDelivery(room.id, { now: now + 1, getSettings: () => settings(), attempt });
    const opened = await contact.activateContact(created.contactId!, now + 2);

    expect(delivery.unavailable).toEqual([created.contactId]);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(opened).toMatchObject({ ok: true, contact: { status: 'opened', messageEventId: expect.any(String) } });
    expect((await journal.readSeaProjection(room.id)).filter(event => event.provenance?.contactId === created.contactId)).toHaveLength(1);
  });

  it('cancels a ready contact when the Room is muted before delivery', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now, getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message', text: 'Could we review the catalog conflict?',
        reason: 'This follows the existing catalog task.', sourceEventIds: [cause.id],
      }),
    });
    const attempt = vi.fn(() => 'attempted' as const);
    const result = await contact.reconcileContactDelivery(room.id, {
      now, getSettings: () => settings({ proactiveOptOutRoomIds: [room.id] }), attempt,
    });
    const state = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'world.json'), 'utf-8')) as {
      contacts: Array<{ status: string }>;
    };

    expect(result.suppressed).toEqual([created.contactId]);
    expect(attempt).not.toHaveBeenCalled();
    expect(state.contacts[0].status).toBe('cancelled');
  });

  it('marks an unanswered delivered call missed and rejects late acceptance without relationship damage', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now, getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'call', text: 'Could we talk briefly about the catalog conflict?',
        reason: 'A synchronous choice would help the established task.', sourceEventIds: [cause.id],
      }),
    });
    await contact.reconcileContactDelivery(room.id, {
      now, getSettings: () => settings(), attempt: () => 'attempted',
    });
    const expired = await contact.reconcileContactDelivery(room.id, {
      now: now + contact.CONTACT_LIMITS.callExpiryMs + 1,
      getSettings: () => settings(), attempt: () => 'attempted',
    });
    const late = await contact.activateContact(created.contactId!, now + contact.CONTACT_LIMITS.callExpiryMs + 2);
    const events = await journal.readSeaProjection(room.id);

    expect(expired.expired).toEqual([created.contactId]);
    expect(late).toMatchObject({ ok: false, contact: { status: 'missed' } });
    expect(events.filter(event => event.type === 'memory.belief' || event.type === 'resolution')).toHaveLength(0);
  });

  it('rejects acceptance when foreground activity supersedes an already-opened call', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now, getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'call', text: 'Could we talk briefly about the catalog conflict?',
        reason: 'A synchronous choice would help the established task.', sourceEventIds: [cause.id],
      }),
    });
    await contact.activateContact(created.contactId!, now + 1);
    await append({
      type: 'message.user', actorId: 'user', witnesses: ['user', mara.id],
      payload: { text: 'I resolved the catalog conflict in another window.' },
    });

    const accepted = await contact.respondToContact(created.contactId!, 'accept', now + 2);

    expect(accepted).toMatchObject({ ok: false, contact: { status: 'superseded' } });
  });

  it('rejects acceptance when call consent is revoked after the offer opened', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now, getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'call', text: 'Could we talk briefly about the catalog conflict?',
        reason: 'A synchronous choice would help the established task.', sourceEventIds: [cause.id],
      }),
    });
    await contact.activateContact(created.contactId!, now + 1);
    fs.writeFileSync(path.join(tempDir.tmpDir, 'settings.json'), JSON.stringify(settings({
      proactiveCallOptOutParticipantIds: [mara.id],
    }), null, 2), 'utf-8');

    const accepted = await contact.respondToContact(created.contactId!, 'accept', now + 2);

    expect(accepted).toMatchObject({ ok: false, contact: { status: 'cancelled' } });
  });

  it('supersedes delivery when the originating cause is retracted', async () => {
    const cause = await seedGroundedCause();
    const created = await contact.runContactPass(room.id, {
      now, getSettings: () => settings(),
      policy: { kind: 'local', isPermitted: () => true, prefer: () => true },
      llmFn: async () => JSON.stringify({
        decision: 'message', text: 'Could we review the catalog conflict?',
        reason: 'This follows the established catalog work.', sourceEventIds: [cause.id],
      }),
    });
    await append({
      type: 'correction', actorId: mara.id, witnesses: [mara.id],
      payload: { targetId: cause.id, ownerId: mara.id },
    });
    const attempt = vi.fn(() => 'attempted' as const);
    const result = await contact.reconcileContactDelivery(room.id, { now: now + 1, getSettings: () => settings(), attempt });

    expect(result.suppressed).toEqual([created.contactId]);
    expect(attempt).not.toHaveBeenCalled();
    expect(await contact.activateContact(created.contactId!, now + 2)).toMatchObject({ ok: false, contact: { status: 'superseded' } });
  });
});
