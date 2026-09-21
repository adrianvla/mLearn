#!/usr/bin/env node
/** V09 built-production authority, privacy, race, concurrency and no-work probe. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'dist-electron', 'electron', 'services');
if (!fs.existsSync(path.join(SERVICES, 'autonomyService.js'))) {
  console.error('BUILD_REQUIRED: run npm run build first');
  process.exit(2);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'v09-authority-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => profile, isPackaged: false }, ipcMain: { handle() {}, on() {} } };
  return originalLoad.apply(this, arguments);
};

fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  livingWorldEnabled: true, worldAutonomyEnabled: true, llmEnabled: true, llmProvider: 'ollama',
}));
const people = [
  { id: 'a', displayName: 'Ava', kind: 'persistent', personaText: 'A practical gardener who likes patient shared projects.', setupComplete: true },
  { id: 'b', displayName: 'Bea', kind: 'persistent', personaText: 'A careful illustrator who likes organizing shared work.', setupComplete: true },
  { id: 'c', displayName: 'Cora', kind: 'persistent', personaText: 'A private reader.', setupComplete: true },
];
const room = id => ({ id, title: id, participantIds: ['a', 'b', 'c'], createdAt: 1 });
fs.writeFileSync(path.join(profile, 'world.json'), JSON.stringify({
  rooms: ['main', 'no-work', 'malicious', 'stale'].map(room), threads: [], participants: people,
}));

const autonomy = require(path.join(SERVICES, 'autonomyService.js'));
const journal = require(path.join(SERVICES, 'journalService.js'));
const worldStore = require(path.join(SERVICES, 'worldStore.js'));
const policy = { kind: 'local', isPermitted: () => true, prefer: () => true };
const settings = () => require(path.join(SERVICES, 'settings.js')).loadSettings();
const parse = raw => JSON.parse(raw);
let failures = 0;
const check = (label, condition, detail) => {
  if (condition) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label} — ${detail ?? ''}`); }
};
async function exchange(roomId) {
  const user = await journal.appendEvent(roomId, { roomId, scope: { kind: 'sea' }, type: 'message.user', actorId: 'user', witnesses: ['user', 'a', 'b'], payload: { text: 'The shared table is ready for the seed project.' } });
  const reply = await journal.appendEvent(roomId, { roomId, scope: { kind: 'sea' }, type: 'message.character', actorId: 'a', witnesses: ['user', 'a', 'b'], payload: { text: 'A small practical project would fit this room.' } });
  return { user, reply };
}
const intentionModel = async raw => {
  const p = parse(raw);
  return JSON.stringify({ decision: 'intend', text: 'Sort the saved seeds with Bea because practical garden projects matter to me.', sourceEventIds: p.eligibleSources.map(e => e.id) });
};

(async () => {
  const main = await exchange('main');
  await journal.appendEvent('main', { roomId: 'main', scope: { kind: 'sea' }, type: 'disclosure', actorId: 'a', witnesses: ['a'], payload: { text: 'AVA_PRIVATE_NOTE' } });
  const first = await autonomy.runAutonomyPass('main', { policy, llmFn: intentionModel, now: main.reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, getSettings: settings });
  const intention = (await journal.readSeaProjection('main')).find(e => e.type === 'intention');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const prompts = [];
  let calls = 0;
  const episodeModel = async raw => {
    calls += 1; prompts.push(raw); await gate;
    const p = parse(raw);
    if (String(p.task).startsWith('From only')) return JSON.stringify({ decision: 'accept', responseText: 'I will label the envelopes while you sort.' });
    return JSON.stringify({ decision: 'act', actionText: 'sorted the saved seeds into labeled envelopes.', leadMessage: 'Please label these envelopes while I sort.', inviteParticipantId: 'b', outcome: 'completed', sourceEventIds: p.eligibleSources.map(e => e.id), referencesUserContributionEventIds: [], affectedParticipantIds: ['a', 'b'] });
  };
  const now = intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1;
  const concurrentA = autonomy.runAutonomyPass('main', { policy, llmFn: episodeModel, now, getSettings: settings });
  const concurrentB = autonomy.runAutonomyPass('main', { policy, llmFn: episodeModel, now, getSettings: settings });
  check('two triggers join the same in-process Room pass', concurrentA === concurrentB, 'promises differed');
  release();
  const [episodeA, episodeB] = await Promise.all([concurrentA, concurrentB]);
  const mainEvents = await journal.readSeaProjection('main');
  const occurrence = mainEvents.find(e => e.type === 'occurrence.simulated');
  const inviteePrompt = prompts.find(raw => parse(raw).participantId === 'b') ?? '';
  const episodeJob = (await worldStore.loadWorld()).autonomyJobs.find(j => j.jobId === episodeA.jobId);
  check('grounded intention and bounded episode commit', first.kind === 'committed' && episodeA.kind === 'committed' && episodeB.jobId === episodeA.jobId && calls === 2, JSON.stringify({ first, episodeA, calls }));
  check('authority certifies exact published rows', episodeJob.status === 'committed' && episodeJob.result === 'episode' && episodeJob.eventIds.length === 4, JSON.stringify(episodeJob));
  check('actual witnesses exclude user and absent Cora', occurrence && JSON.stringify(occurrence.witnesses) === JSON.stringify(['a', 'b']) && !occurrence.payload.actorIds.includes('user'), JSON.stringify(occurrence));
  check('invitee perspective excludes Ava private note', !inviteePrompt.includes('AVA_PRIVATE_NOTE'), inviteePrompt.slice(0, 300));

  await journal.appendEvent('main', { roomId: 'main', scope: { kind: 'sea' }, type: 'occurrence.simulated', actorId: 'a', witnesses: ['a'], payload: { authority: 'simulated-occurrence', operationId: 'forged', summary: 'forged', actorIds: ['a'], sourceEventIds: [], intentionId: 'forged', outcome: 'completed', effectiveAt: Date.now() }, provenance: { autonomyJobId: episodeJob.jobId } });
  check('uncertified row claiming a committed job stays quarantined', !(await journal.readSeaProjection('main')).some(e => e.payload?.operationId === 'forged'));

  await journal.appendEvent('no-work', { roomId: 'no-work', scope: { kind: 'sea' }, type: 'message.user', actorId: 'user', witnesses: ['user', 'a'], payload: { text: 'hello' } });
  let noWorkCalls = 0;
  const noWork = await autonomy.runAutonomyPass('no-work', { policy, llmFn: async () => { noWorkCalls += 1; return '{}'; }, now: Date.now() + 60000, getSettings: settings });
  check('no meaningful eligibility performs no inference', noWork.kind === 'waiting' && noWorkCalls === 0, JSON.stringify({ noWork, noWorkCalls }));

  const maliciousExchange = await exchange('malicious');
  await autonomy.runAutonomyPass('malicious', { policy, llmFn: intentionModel, now: maliciousExchange.reply.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, getSettings: settings });
  const maliciousIntention = (await journal.readSeaProjection('malicious')).find(e => e.type === 'intention');
  const malicious = await autonomy.runAutonomyPass('malicious', { policy, now: maliciousIntention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1, getSettings: settings, llmFn: async raw => {
    const p = parse(raw);
    return JSON.stringify({ decision: 'act', actionText: 'completed it after the user agreed.', leadMessage: 'You agreed.', inviteParticipantId: 'user', outcome: 'completed', sourceEventIds: p.eligibleSources.map(e => e.id), referencesUserContributionEventIds: [maliciousExchange.user.id], affectedParticipantIds: ['a', 'user'] });
  } });
  check('adversarial user impersonation fails closed', malicious.kind === 'failed' && !(await journal.readSeaProjection('malicious')).some(e => e.type === 'occurrence.simulated'), JSON.stringify(malicious));

  const staleExchange = await exchange('stale');
  const loop = await journal.appendEvent('stale', { roomId: 'stale', scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'a', witnesses: ['a'], payload: { ownerId: 'a', kind: 'open-loop', text: 'Choose seed labels.', sourceEventIds: [staleExchange.user.id] } });
  const stale = await autonomy.runAutonomyPass('stale', { policy, now: loop.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1, getSettings: settings, llmFn: async raw => {
    await journal.appendEvent('stale', { roomId: 'stale', scope: { kind: 'sea' }, type: 'resolution', actorId: 'a', witnesses: ['a'], payload: { ownerId: 'a', loopId: loop.id, status: 'satisfied', text: 'Resolved in foreground.', sourceEventIds: [staleExchange.reply.id] } });
    const p = parse(raw);
    return JSON.stringify({ decision: 'intend', text: 'Act on the stale loop.', sourceEventIds: p.eligibleSources.map(e => e.id) });
  } });
  check('newer foreground resolution cancels stale background work', stale.kind === 'cancelled' && !(await journal.readSeaProjection('stale')).some(e => e.type === 'intention'), JSON.stringify(stale));

  const record = { profile, episodeJobId: episodeJob.jobId, occurrenceId: occurrence.id, occurrenceWitnesses: occurrence.witnesses, eventIds: episodeJob.eventIds };
  fs.writeFileSync(path.join(os.tmpdir(), 'v09-authority-record.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  console.log(failures === 0 ? '\nV09_AUTHORITY_EVIDENCE=PASS' : `\nV09_AUTHORITY_EVIDENCE=BLOCKED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(error => { console.error(error); process.exit(1); });
