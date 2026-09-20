#!/usr/bin/env node
/**
 * V08 real-provider maintenance run — exercises the REAL main-process
 * maintenance path (dreamerRuntime.consolidateContext → runReflection +
 * evolveScenario → dreamerLlm.complete → ollamaService.chatCompletion)
 * against the actually installed local model. This is the real-provider
 * evidence layer for reflection/evolution output quality; it is NOT a full
 * mounted-Electron UI run (that gate is recorded separately in
 * docs/CONVERSATION_LIVING_WORLD_VERIFICATION.md).
 */

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'dist-electron', 'electron', 'services');
const MODEL = process.env.V08_OLLAMA_MODEL || 'gemma4-e4b-q4:latest';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'v08-real-'));
process.env.V08_PROFILE = profile;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => profile, isPackaged: false },
      ipcMain: { handle: () => undefined, on: () => undefined },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Real settings: local Ollama provider with the actually installed model.
// Living World consent is required for every persistent maintenance path.
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  ...require(path.join(ROOT, 'dist-electron', 'shared', 'constants.js')).DEFAULT_SETTINGS,
  llmProvider: 'ollama',
  ollamaModel: MODEL,
  llmEnabled: true,
  livingWorldEnabled: true,
}));

const SERVICES_DIR = SERVICES;
const world = require(path.join(SERVICES_DIR, 'worldStore.js'));
const journal = require(path.join(SERVICES_DIR, 'journalService.js'));
const runtime = require(path.join(SERVICES_DIR, 'dreamerRuntime.js'));

async function main() {
  // A persistent Room with two AI cast members and a seeded situation.
  fs.writeFileSync(path.join(profile, 'world.json'), JSON.stringify({
    rooms: [{
      id: 'room-real', title: 'Garden', participantIds: ['mara', 'eli'], createdAt: 1,
      scenario: {
        scene: {
          sharedFacts: ['Two neighbors share a small garden plot behind their houses.'],
          userObjectivePrivate: 'Practice natural conversation.',
          socialConstraints: ['Let everyone contribute to the plan.'],
        },
        participants: [
          { kind: 'temporary', localId: 'mara', profile: { name: 'Mara', personaText: 'A patient planner who likes tidy rows.', goals: ['Make space for herbs'], behaviorConstraints: [], initialKnowledge: [] } },
          { kind: 'temporary', localId: 'eli', profile: { name: 'Eli', personaText: 'A spontaneous neighbor who enjoys shared projects.', goals: ['Grow flowers'], behaviorConstraints: [], initialKnowledge: [] } },
        ],
        relationships: [{ fromId: 'mara', toId: 'eli', label: 'Unsure about reliability', directional: true }],
        adaptations: ['Generated fictional neighbors'],
      },
    }],
    threads: [],
    participants: [
      { id: 'mara', displayName: 'Mara', kind: 'persistent', personaText: 'A patient planner.', setupComplete: true },
      { id: 'eli', displayName: 'Eli', kind: 'persistent', personaText: 'A spontaneous neighbor.', setupComplete: true },
    ],
  }));
  // Real prior interaction (real journal writes).
  await journal.appendEvent('room-real', { roomId: 'room-real', scope: { kind: 'sea' }, type: 'message.user', actorId: 'user', witnesses: ['user', 'mara', 'eli'], payload: { text: 'The garden needs a plan before planting season.' } });
  await journal.appendEvent('room-real', { roomId: 'room-real', scope: { kind: 'sea' }, type: 'message.character', actorId: 'mara', witnesses: ['user', 'mara', 'eli'], payload: { text: "I'll draft a layout with herb beds and note what tools we're missing." } });
  await journal.appendEvent('room-real', { roomId: 'room-real', scope: { kind: 'sea' }, type: 'message.character', actorId: 'eli', witnesses: ['user', 'mara', 'eli'], payload: { text: 'Good — but flowers first, they take longer to bloom. Mara, should we fix the broken rake today?' } });
  // A grounded open loop from the real history (the tool repair), owned by
  // Mara: the reflection pass must be able to resolve THIS loop by id.
  const loopSource = (await journal.readSeaProjection('room-real')).at(-1);
  await journal.appendEvent('room-real', {
    roomId: 'room-real', scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'harness', witnesses: ['mara'],
    payload: { ownerId: 'mara', kind: 'open-loop', text: 'Eli asked whether the broken rake gets fixed today.', sourceEventIds: [loopSource.id] },
  });
  await journal.appendEvent('room-real', {
    roomId: 'room-real', scope: { kind: 'sea' }, type: 'message.character', actorId: 'eli', witnesses: ['user', 'mara', 'eli'],
    payload: { text: 'I fixed the broken rake and put it back in the shed.', replyToEventId: loopSource.id },
  });

  const started = Date.now();
  await runtime.consolidateContext({ roomId: 'room-real' }, { getSettings: () => require(path.join(SERVICES_DIR, 'settings.js')).loadSettings() });
  const elapsed = Date.now() - started;

  const events = await journal.readSeaProjection('room-real');
  // Reflection EVIDENCE = rows the reflection pass derived (provenance);
  // seeded fixtures (e.g. the pre-existing open loop) are never evidence.
  const derived = events.filter((event) => event.provenance?.reflectionId !== undefined
    && (event.type === 'memory.belief' || event.type === 'resolution'));
  const markers = events.filter((event) => event.type === 'consolidation');
  const evolved = events.filter((event) => event.type === 'scenario_evolved');
  const room = (await world.loadWorld()).rooms.find((item) => item.id === 'room-real');

  const record = {
    profile: path.basename(profile),
    model: `${MODEL} via real ollamaService path (dreamerLlm.complete)`,
    elapsedMs: elapsed,
    derived: derived.map((event) => ({
      type: event.type, witnesses: event.witnesses,
      payload: event.payload, provenance: event.provenance, createdAt: event.createdAt,
    })),
    markers: markers.map((event) => event.payload),
    evolvedEvents: evolved.map((event) => event.payload),
    scenarioInterpretations: (room?.scenario?.developments ?? []).map((dev) => ({ authority: dev.authority, text: dev.text, kind: dev.kind, createdAt: dev.createdAt })),
    scenarioStatus: room?.scenario?.status ?? 'active',
    ledger: ((await world.loadWorld()).reflectionRuns ?? []).map(({ prepared: _prepared, ...rest }) => rest),
  };
  const recordPath = path.join(os.tmpdir(), 'v08-real-model.json');
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  const hasDerived = record.derived.length > 0;
  const hasEvolution = record.evolvedEvents.length > 0;
  // Semantic authority boundary: every derived interpretation must cite real
  // source events (its owner's entitled view), and no derived row may be an
  // occurrence type — reflection can only commit memory.belief / resolution.
  const realSourceIds = new Set(events.filter((event) => event.provenance?.reflectionId === undefined).map((event) => event.id));
  const derivedCitationsValid = record.derived.every((event) =>
    Array.isArray(event.payload?.sourceEventIds) && event.payload.sourceEventIds.length > 0
    && event.payload.sourceEventIds.every((id) => realSourceIds.has(id)));
  const beliefRows = record.derived.filter((event) => event.type === 'memory.belief'
    && ['belief', 'open-loop', 'relationship'].includes(event.payload?.kind));
  const interpretationOnly = record.derived.filter((event) => event.type === 'memory.belief').length === beliefRows.length;
  const scenarioInterpretationOnly = record.scenarioInterpretations.every((item) => item.authority === 'interpretation');
  const loopResolved = record.derived.some((event) => event.type === 'resolution'
    && event.payload?.loopId && event.payload?.status);
  console.log(`\nSTRUCTURAL_MODEL_EVIDENCE=${hasEvolution && hasDerived && record.markers.length > 0 && derivedCitationsValid && interpretationOnly && scenarioInterpretationOnly ? 'PASS' : 'BLOCKED'}`);
  console.log(`LOOP_RESOLUTION_EVIDENCE=${loopResolved ? 'NEEDS_SEMANTIC_REVIEW' : 'NOT_EXERCISED'}`);
  console.log('LIVE_MODEL_EVIDENCE=NEEDS_SEMANTIC_REVIEW');
  if (!hasEvolution || !hasDerived || !derivedCitationsValid || !interpretationOnly || !scenarioInterpretationOnly) process.exitCode = 2;
}

main().then(() => { process.exit(process.exitCode ?? 0); }).catch((error) => { console.error(error); process.exit(1); });
