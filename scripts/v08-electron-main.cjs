#!/usr/bin/env node
/**
 * V08 actual-Electron maintenance evidence: runs the REAL Electron main
 * process, registers the PRODUCTION world IPC handlers, and drives the
 * WORLD_TRIGGER_REFLECTION IPC channel exactly as a renderer would. All
 * writes go to a disposable profile (MLEARN_USER_DATA); the local model is
 * reached through the real ollamaService provider path (no mocks).
 *
 * Usage: MLEARN_USER_DATA=<dir> npx electron scripts/v08-electron-main.cjs
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'dist-electron', 'electron', 'services');

const electron = require('electron');
const { app, ipcMain } = electron;

// Apply the production userData override (first import, before any service
// resolves a userData-derived path).
require(path.join(ROOT, 'dist-electron', 'electron', 'userDataOverride.js'));

// Capture the production handler registrations (same registration path the app uses).
const handlers = new Map();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => { handlers.set(channel, fn); return originalHandle(channel, fn); };

const run = async () => {
  const profile = process.env.MLEARN_USER_DATA;
  if (!profile || !fs.existsSync(profile)) throw new Error(`disposable profile missing: ${profile}`);
  const actualUserData = app.getPath('userData');
  if (actualUserData !== profile) throw new Error(`userData override not applied: ${actualUserData}`);

  const world = require(path.join(SERVICES, 'worldStore.js'));
  const journal = require(path.join(SERVICES, 'journalService.js'));
  const worldIpc = require(path.join(SERVICES, 'worldIpc.js'));
  void worldIpc.setupWorldIPC();

  // Real profile state (same seeding the controlled waves used).
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    ...require(path.join(ROOT, 'dist-electron', 'shared', 'constants.js')).DEFAULT_SETTINGS,
    llmProvider: 'ollama',
    ollamaModel: 'gemma3:4b',
    llmEnabled: true,
    livingWorldEnabled: true,
  }));
  fs.writeFileSync(path.join(profile, 'world.json'), JSON.stringify({
    rooms: [{
      id: 'room-elec', title: 'Garden', participantIds: ['mara', 'eli'], createdAt: 1,
      scenario: {
        scene: { sharedFacts: ['Two neighbors share a small garden plot behind their houses.'], userObjectivePrivate: 'Practice natural conversation.', socialConstraints: ['Let everyone contribute to the plan.'] },
        participants: [
          { kind: 'temporary', localId: 'mara', profile: { name: 'Mara', personaText: 'A patient planner who likes careful layouts.', goals: ['Make space for herbs'], behaviorConstraints: [], initialKnowledge: [] } },
          { kind: 'temporary', localId: 'eli', profile: { name: 'Eli', personaText: 'A spontaneous neighbor who enjoys shared projects.', goals: ['Grow flowers'], behaviorConstraints: [], initialKnowledge: [] } },
        ],
        relationships: [{ fromId: 'mara', toId: 'eli', label: 'Unsure about reliability', directional: true }],
        adaptations: [],
      },
    }],
    threads: [],
    participants: [
      { id: 'mara', displayName: 'Mara', kind: 'persistent', personaText: 'A patient planner.', setupComplete: true },
      { id: 'eli', displayName: 'Eli', kind: 'persistent', personaText: 'A spontaneous neighbor.', setupComplete: true },
    ],
  }));
  await journal.appendEvent('room-elec', { roomId: 'room-elec', scope: { kind: 'sea' }, type: 'message.user', actorId: 'user', witnesses: ['user', 'mara', 'eli'], payload: { text: 'The garden needs a plan before planting season.' } });
  await journal.appendEvent('room-elec', { roomId: 'room-elec', scope: { kind: 'sea' }, type: 'message.character', actorId: 'mara', witnesses: ['user', 'mara', 'eli'], payload: { text: "I'll draft a layout with herb beds and note what tools we're missing." } });
  await journal.appendEvent('room-elec', { roomId: 'room-elec', scope: { kind: 'sea' }, type: 'message.character', actorId: 'eli', witnesses: ['user', 'mara', 'eli'], payload: { text: 'Flowers first for me, they take longer to bloom. Mara, should we fix the broken rake today?' } });

  // Renderer-shaped fire-and-forget trigger over the production IPC channel.
  const trigger = handlers.get('world-trigger-reflection');
  if (!trigger) throw new Error('WORLD_TRIGGER_REFLECTION handler not registered');
  const started = Date.now();
  await trigger({}, { roomId: 'room-elec' });
  const elapsedMs = Date.now() - started;

  const events = await journal.readSeaProjection('room-elec');
  const room = (await world.loadWorld()).rooms.find((item) => item.id === 'room-elec');
  const record = {
    surface: 'real Electron main process; production WORLD_TRIGGER_REFLECTION IPC handler; real ollamaService provider path',
    model: 'gemma3:4b',
    elapsedMs,
    derivedEvents: events
      .filter((event) => event.type === 'memory.belief' || event.type === 'resolution')
      .map((event) => ({ type: event.type, actorId: event.actorId, witnesses: event.witnesses, payload: event.payload, provenance: event.provenance })),
    consolidationMarkers: events.filter((event) => event.type === 'consolidation').map((event) => event.payload),
    scenarioEvolved: events.filter((event) => event.type === 'scenario_evolved').map((event) => event.payload),
    scenarioDevelopments: (room?.scenario?.developments ?? []).map((dev) => ({ text: dev.text, kind: dev.kind })),
    scenarioStatus: room?.scenario?.status ?? 'active',
    ledger: ((await world.loadWorld()).reflectionRuns ?? []).map(({ prepared: _prepared, ...rest }) => rest),
  };
  const outPath = path.join(require('os').tmpdir(), 'v08-electron-record.json');
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  console.log(`ELECTRON_RECORD=${outPath}`);
  console.log(JSON.stringify(record, null, 2));
  const hasDerived = record.derivedEvents.length > 0;
  const hasEvolution = record.scenarioEvolved.length > 0;
  console.log(`\nELECTRON_EVIDENCE=${hasDerived && hasEvolution ? 'PASS' : 'BLOCKED'}`);
  process.exitCode = hasDerived && hasEvolution ? 0 : 2;
};

app.whenReady().then(() => {
  run().then(() => undefined).catch((error) => { console.error(error); process.exit(1); });
});
