#!/usr/bin/env node
/**
 * V09 real-model semantic probe through built autonomy, shared LLM routing,
 * canonical journal/world storage, V08 reflection, and compiled later context.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'dist-electron', 'electron', 'services');
const SHARED = path.join(ROOT, 'dist-electron', 'shared');
const MODEL = process.env.V09_OLLAMA_MODEL || 'gemma4-e4b-q4:latest';
if (!fs.existsSync(path.join(SERVICES, 'autonomyService.js'))) {
  console.error('BUILD_REQUIRED: run npm run build first');
  process.exit(2);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'v09-real-model-'));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => profile, isPackaged: false }, ipcMain: { handle() {}, on() {} } };
  return originalLoad.apply(this, arguments);
};

const { DEFAULT_SETTINGS } = require(path.join(SHARED, 'types.js'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  ...DEFAULT_SETTINGS,
  llmProvider: 'ollama', ollamaModel: MODEL, llmEnabled: true,
  livingWorldEnabled: true, worldAutonomyEnabled: true, proactivityEnabled: false,
}));
const people = [
  { id: 'mara', displayName: 'Mara', kind: 'persistent', personaText: 'A patient community gardener who loves cataloguing saved seeds, values reliable shared routines, and often collaborates with Eli on small practical projects.', setupComplete: true },
  { id: 'eli', displayName: 'Eli', kind: 'persistent', personaText: 'A warm, dependable illustrator who enjoys making clear hand-lettered labels, readily helps Mara with small seed-library tasks when invited, and likes turning garden ideas into useful shared objects.', setupComplete: true },
  { id: 'noa', displayName: 'Noa', kind: 'persistent', personaText: 'A private reader who was absent from the garden exchange.', setupComplete: true },
];
fs.writeFileSync(path.join(profile, 'world.json'), JSON.stringify({
  rooms: [{ id: 'room-real-v09', title: 'Seed Library', participantIds: people.map(person => person.id), createdAt: 1 }],
  threads: [], participants: people,
}));

const autonomy = require(path.join(SERVICES, 'autonomyService.js'));
const journal = require(path.join(SERVICES, 'journalService.js'));
const worldStore = require(path.join(SERVICES, 'worldStore.js'));
const llmRouter = require(path.join(SERVICES, 'llmRouter.js'));
const dreamerService = require(path.join(SERVICES, 'dreamerService.js'));
const settingsService = require(path.join(SERVICES, 'settings.js'));
const { compileContext } = require(path.join(SHARED, 'contextCompiler.js'));
const { getInferencePolicy } = require(path.join(SHARED, 'inferencePolicy.js'));

async function main() {
  const user = await journal.appendEvent('room-real-v09', {
    roomId: 'room-real-v09', scope: { kind: 'sea' }, type: 'message.user', actorId: 'user',
    witnesses: ['user', 'mara', 'eli'],
    payload: { text: 'The seed-donation box is unpacked, the empty envelopes are on our shared table, and damp weather tonight would spoil the loose seeds. I am heading out now.' },
  });
  const foreground = await journal.appendEvent('room-real-v09', {
    roomId: 'room-real-v09', scope: { kind: 'sea' }, type: 'message.character', actorId: 'mara',
    witnesses: ['user', 'mara', 'eli'],
    payload: { text: 'Seed keeping matters to me, Eli has a good eye for labels, and this quiet hour is our practical chance to protect the loose seeds before the damp weather. I want to make a modest shared seed catalogue.' },
  });
  await journal.appendEvent('room-real-v09', {
    roomId: 'room-real-v09', scope: { kind: 'sea' }, type: 'disclosure', actorId: 'mara', witnesses: ['mara'],
    payload: { text: 'PRIVATE_MARA_NOTE: I am nervous about showing unfinished catalogues.' },
  });
  await journal.appendEvent('room-real-v09', {
    roomId: 'room-real-v09', scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'mara', witnesses: ['mara'],
    payload: { ownerId: 'mara', kind: 'open-loop', text: 'Decide how to protect and catalogue the loose donated seeds before damp weather.', sourceEventIds: [foreground.id] },
  });

  const settings = settingsService.loadSettings();
  const policy = getInferencePolicy(settings);
  const modelCalls = [];
  const llmFn = async (prompt, participantId) => {
    const output = await llmRouter.completeJob(
      [{ role: 'user', content: prompt }], new AbortController().signal,
      autonomy.AUTONOMY_LIMITS.outputCharacters, 'background',
    );
    modelCalls.push({ participantId, prompt: JSON.parse(prompt), output });
    return output;
  };
  let first;
  let intentionNow = foreground.createdAt + autonomy.AUTONOMY_LIMITS.interestDelayMs + 1;
  for (let attempt = 0; attempt < 4 && first?.kind !== 'committed'; attempt++) {
    first = await autonomy.runAutonomyPass('room-real-v09', {
      policy, llmFn, now: intentionNow, getSettings: settingsService.loadSettings,
    });
    const record = first.jobId
      ? (await worldStore.loadWorld()).autonomyJobs.find(job => job.jobId === first.jobId)
      : undefined;
    intentionNow = (record?.retryAt ?? intentionNow) + 1;
  }
  if (first.kind !== 'committed') throw new Error(`REAL_MODEL_DID_NOT_ORIGINATE_INTENTION: ${JSON.stringify(first)}`);
  const intention = (await journal.readSeaProjection('room-real-v09')).find(event => event.type === 'intention');
  let second = await autonomy.runAutonomyPass('room-real-v09', {
    policy, llmFn,
    now: intention.createdAt + autonomy.AUTONOMY_LIMITS.followThroughDelayMs + 1,
    getSettings: settingsService.loadSettings,
  });
  if (second.kind === 'deferred' || second.kind === 'failed' || second.kind === 'blocked') {
    const record = (await worldStore.loadWorld()).autonomyJobs.find(job => job.jobId === second.jobId);
    second = await autonomy.runAutonomyPass('room-real-v09', {
      policy, llmFn, now: record.retryAt + 1, getSettings: settingsService.loadSettings,
    });
  }
  if (second.kind !== 'committed') throw new Error(`REAL_MODEL_DID_NOT_COMMIT_EPISODE: ${JSON.stringify({ second, modelCalls })}`);

  const reflectionCalls = [];
  let events;
  for (let schedulerPass = 0; schedulerPass < 3; schedulerPass++) {
    await dreamerService.runDreamer('room-real-v09', {
      policy,
      now: Date.now() + schedulerPass,
      llmFn: async (prompt) => {
        const output = await llmRouter.completeJob(
          [{ role: 'user', content: prompt }], new AbortController().signal, 12000, 'background',
        );
        reflectionCalls.push({ prompt: JSON.parse(prompt), output });
        return output;
      },
    });
    events = await journal.readSeaProjection('room-real-v09');
    if (events.some(event => event.provenance?.reflectionId
      && (event.type === 'memory.belief' || event.type === 'resolution'))) break;
  }
  const occurrence = events.find(event => event.type === 'occurrence.simulated');
  const world = await worldStore.loadWorld();
  const room = world.rooms.find(candidate => candidate.id === 'room-real-v09');
  const maraContext = compileContext({ room, participant: people[0], participants: people, seaEvents: events });
  const laterPrompt = JSON.stringify({
    task: 'Answer as Mara in one natural sentence. The user has returned and asks: What became of the seed-donation materials while I was away? Use only this entitled context; do not invent user participation.',
    perspective: maraContext,
  });
  const laterResponse = await llmRouter.completeJob(
    [{ role: 'user', content: laterPrompt }], new AbortController().signal, 1200, 'foreground',
  );

  const job = world.autonomyJobs.find(candidate => candidate.jobId === second.jobId);
  const reflectionRows = events.filter(event => event.provenance?.reflectionId
    && (event.type === 'memory.belief' || event.type === 'resolution'));
  const occurrenceReflected = reflectionRows.some(event => [
    ...(event.payload.sourceEventIds ?? []),
    ...(event.payload.dependencyEventIds ?? []),
  ].includes(occurrence.id));
  const eliCall = modelCalls.find(call => call.participantId === 'eli');
  const userAbsent = occurrence && !occurrence.witnesses.includes('user')
    && !occurrence.payload.actorIds.includes('user');
  const privateSafe = !JSON.stringify(eliCall?.prompt ?? {}).includes('PRIVATE_MARA_NOTE');
  const laterContextContainsOccurrence = maraContext.witnessedOccurrences.some(item => item.eventId === occurrence.id);
  const record = {
    profile,
    model: MODEL,
    foregroundSourceIds: [user.id, foreground.id],
    first,
    second,
    intention: intention.payload,
    occurrence: { id: occurrence.id, actorId: occurrence.actorId, witnesses: occurrence.witnesses, payload: occurrence.payload },
    job: { id: job.jobId, status: job.status, result: job.result, eventIds: job.eventIds, participantContextHashes: job.participantContextHashes },
    modelCalls: modelCalls.map(call => ({ participantId: call.participantId, task: call.prompt.task, output: call.output })),
    reflectionRows: reflectionRows.map(event => ({ type: event.type, actorId: event.actorId, witnesses: event.witnesses, payload: event.payload })),
    reflectionCalls: reflectionCalls.map(call => ({ task: call.prompt.task, output: call.output })),
    laterContextContainsOccurrence,
    laterResponse,
    checks: { userAbsent, privateSafe, certified: job.eventIds.length > 0, occurrenceReflected, laterContextContainsOccurrence },
  };
  const outputPath = path.join(os.tmpdir(), 'v09-real-model-record.json');
  fs.writeFileSync(outputPath, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  const structural = Object.values(record.checks).every(Boolean) && laterResponse.trim().length > 0;
  console.log(`\nV09_REAL_MODEL_STRUCTURAL_EVIDENCE=${structural ? 'PASS' : 'BLOCKED'}`);
  console.log('V09_REAL_MODEL_SEMANTIC_EVIDENCE=NEEDS_REVIEW');
  console.log(`RECORD=${outputPath}`);
  if (!structural) process.exitCode = 2;
}

main().catch(error => { console.error(error); process.exit(1); });
