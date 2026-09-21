#!/usr/bin/env node
/** V10 built-production authority, privacy, concurrency and delivery probe. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'dist-electron', 'electron', 'services');
if (!fs.existsSync(path.join(SERVICES, 'contactService.js'))) {
  console.error('BUILD_REQUIRED: run npm run build first');
  process.exit(2);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'v10-authority-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => profile, isPackaged: false }, ipcMain: { handle() {}, on() {} } };
  return originalLoad.apply(this, arguments);
};
const contact = require(path.join(SERVICES, 'contactService.js'));
const journal = require(path.join(SERVICES, 'journalService.js'));
const worldStore = require(path.join(SERVICES, 'worldStore.js'));
const settingsService = require(path.join(SERVICES, 'settings.js'));
const settingsPath = path.join(profile, 'settings.json');
const settings = {
  livingWorldEnabled: true, proactivityEnabled: true, llmEnabled: true,
  proactiveOptOutParticipantIds: [], proactiveOptOutRoomIds: [], proactiveCallOptOutParticipantIds: [],
  proactiveQuietHoursEnabled: false, proactiveQuietHoursStart: '22:00', proactiveQuietHoursEnd: '08:00',
};
fs.writeFileSync(settingsPath, JSON.stringify(settings));
fs.writeFileSync(path.join(profile, 'world.json'), JSON.stringify({
  rooms: [{ id: 'room-main', title: 'Seed Library', participantIds: ['mara', 'noa'], createdAt: 1 }], threads: [], contacts: [], autonomyJobs: [],
  participants: [
    { id: 'mara', displayName: 'Mara', kind: 'persistent', personaText: 'A careful seed librarian.', setupComplete: true },
    { id: 'noa', displayName: 'Noa', kind: 'persistent', personaText: 'A private reader.', setupComplete: true },
  ],
}));
const policy = { kind: 'local', isPermitted: () => true, prefer: () => true };
let failures = 0;
const check = (label, value, detail) => {
  if (value) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label} — ${detail ?? ''}`); }
};

(async () => {
  await journal.appendEvent('room-main', { roomId: 'room-main', scope: { kind: 'sea' }, type: 'message.user', actorId: 'user', witnesses: ['user', 'mara'], payload: { text: 'Let me know if the seed catalogue changes.' } });
  await journal.appendEvent('room-main', { roomId: 'room-main', scope: { kind: 'sea' }, type: 'message.character', actorId: 'mara', witnesses: ['user', 'mara'], payload: { text: 'I will watch it.' } });
  await journal.appendEvent('room-main', { roomId: 'room-main', scope: { kind: 'sea' }, type: 'disclosure', actorId: 'noa', witnesses: ['noa'], payload: { text: 'PRIVATE_NOA_NOTE: unrelated private family detail' } });
  const occurrence = await journal.appendEvent('room-main', { roomId: 'room-main', scope: { kind: 'sea' }, type: 'occurrence.simulated', actorId: 'mara', witnesses: ['mara'], payload: { authority: 'simulated-occurrence', operationId: 'episode-main', summary: 'Mara found two conflicting seed catalogue entries.', actorIds: ['mara'], sourceEventIds: [], intentionId: 'catalogue', outcome: 'pursued', effectiveAt: Date.now() }, provenance: { autonomyJobId: 'job-main' } });
  const seeded = await worldStore.loadWorld();
  seeded.autonomyJobs = [{ jobId: 'job-main', roomId: 'room-main', candidateKind: 'intention-follow-through', leadParticipantId: 'mara', participantIds: ['mara'], sourceEventIds: [], candidateHash: 'cause', status: 'committed', attempts: 1, createdAt: occurrence.createdAt, eligibleAt: occurrence.createdAt, settledAt: occurrence.createdAt, result: 'episode', eventIds: [occurrence.id] }];
  await worldStore.saveWorld(seeded);
  const now = occurrence.createdAt + contact.CONTACT_LIMITS.eligibilityDelayMs + 1;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  let prompt = '';
  const model = async raw => {
    calls += 1; prompt = raw; await gate;
    const parsed = JSON.parse(raw);
    return JSON.stringify({ decision: 'message', text: 'I found two conflicting seed-catalogue entries. Could we review them?', reason: 'The conflict affects our existing catalogue work.', sourceEventIds: [parsed.eligibleSources[0].id] });
  };
  const deps = { policy, now, getSettings: settingsService.loadSettings, llmFn: model };
  const passA = contact.runContactPass('room-main', deps);
  const passB = contact.runContactPass('room-main', deps);
  check('two servicing paths join the same Room pass', passA === passB, 'promises differed');
  release();
  const [first, second] = await Promise.all([passA, passB]);
  const world = await worldStore.loadWorld();
  const record = world.contacts[0];
  const canonical = (await journal.readSeaProjection('room-main')).filter(event => event.provenance?.contactId === record.contactId);
  check('one model decision produces one durable contact', calls === 1 && first.contactId === second.contactId && world.contacts.length === 1, JSON.stringify({ calls, first, second }));
  check('contact is canonical in the existing Room with exact cause provenance', record.status === 'ready' && canonical.length === 1 && canonical[0].roomId === 'room-main' && record.sourceEventIds.includes(occurrence.id), JSON.stringify(record));
  check('participant-private state is absent from generation authority', !prompt.includes('PRIVATE_NOA_NOTE'), prompt.slice(0, 400));

  const deliveries = [];
  const adapter = input => { deliveries.push(input); return 'attempted'; };
  await contact.reconcileContactDelivery('room-main', { now: now + 1, getSettings: settingsService.loadSettings, attempt: adapter });
  await contact.reconcileContactDelivery('room-main', { now: now + 2, getSettings: settingsService.loadSettings, attempt: adapter });
  check('external delivery is bounded and uses stable identity', deliveries.length === 1 && deliveries[0].notificationId === record.contactId, JSON.stringify(deliveries));
  check('notification preview carries no private/world dialogue', deliveries[0].body === 'Mara sent you a message' && !deliveries[0].body.includes(record.messageText), deliveries[0].body);
  const openedA = await contact.activateContact(record.contactId, now + 3);
  const openedB = await contact.activateContact(record.contactId, now + 4);
  const after = await worldStore.loadWorld();
  check('duplicate activation is idempotent', openedA.ok && openedB.ok && after.contacts[0].history.filter(item => item.status === 'opened').length === 1, JSON.stringify(after.contacts[0]));

  const output = path.join(os.tmpdir(), 'v10-authority-record.json');
  fs.writeFileSync(output, JSON.stringify({ profile, contact: after.contacts[0], canonical, deliveries }, null, 2));
  console.log(failures === 0 ? '\nV10_AUTHORITY_EVIDENCE=PASS' : `\nV10_AUTHORITY_EVIDENCE=BLOCKED (${failures})`);
  console.log(`RECORD=${output}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
