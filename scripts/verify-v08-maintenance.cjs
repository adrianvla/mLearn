#!/usr/bin/env node
/**
 * V08 maintenance crash/retry verification — actual SIGKILL at reflection
 * publication boundaries against the BUILT production services
 * (dist-electron/electron/services/*) on a real filesystem, one fresh
 * disposable profile per probe.
 *
 * Boundaries:
 *  A  crash while the model call is outstanding (durable pending record,
 *     no prepared output) → recovery settles failed, window reopens, replay
 *     derives once.
 *  B  crash after the first derived append, before the marker → recovery
 *     resumes the prepared publication all-or-nothing.
 *  C  crash after the marker append, before settlement → recovery verifies the
 *     existing marker and settles committed without duplicating it.
 *  D  clean run → committed; replay is idempotent.
 *
 * Storage/recovery layer only: no model inference, no Electron runtime.
 * Real-model / real-Electron evidence is recorded separately (see
 * docs/CONVERSATION_LIVING_WORLD_VERIFICATION.md, V08).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'dist-electron', 'electron', 'services');

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`PASS ${label}`);
  else { failures += 1; console.error(`FAIL ${label} — ${detail ?? ''}`); }
}

function runStage(script, profile, label) {
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, V08_PROFILE: profile, V08_LABEL: label },
    encoding: 'utf-8',
    timeout: 120_000,
  });
  return { code: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const STAGES = fs.mkdtempSync(path.join(os.tmpdir(), 'v08-stages-'));
const COMMON = `
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: { getPath: () => process.env.V08_PROFILE, isPackaged: false },
      ipcMain: { handle: () => undefined, on: () => undefined },
    };
  }
  return originalLoad.apply(this, arguments);
};
const SERVICES = ${JSON.stringify(SERVICES)};
`;

// Seeds a fresh profile with one persistent Room (cast: mara) and two witnessed Sea events.
const SEED = path.join(STAGES, 'seed.cjs');
fs.writeFileSync(SEED, `${COMMON}
const fs = require('fs'); const path = require('path');
const journal = require(path.join(SERVICES, 'journalService.js'));
const run = async () => {
  // Production-coherent profile: the crashed run belonged to a consented user.
  fs.writeFileSync(path.join(process.env.V08_PROFILE, 'settings.json'), JSON.stringify({
    ...require(path.join(SERVICES, '..', '..', 'shared', 'constants.js')).DEFAULT_SETTINGS,
    livingWorldEnabled: true,
  }));
  fs.writeFileSync(path.join(process.env.V08_PROFILE, 'world.json'), JSON.stringify({
    rooms: [{ id: 'room-v08', title: 'Garden', participantIds: ['mara'], createdAt: 1 }],
    threads: [],
    participants: [{ id: 'mara', displayName: 'Mara', kind: 'persistent', personaText: 'A patient gardener.', setupComplete: true }],
  }));
  await journal.appendEvent('room-v08', { roomId: 'room-v08', scope: { kind: 'sea' }, type: 'message.user', actorId: 'user', witnesses: ['user', 'mara'], payload: { text: 'Mara promised to repair the tools.' } });
  await journal.appendEvent('room-v08', { roomId: 'room-v08', scope: { kind: 'sea' }, type: 'message.character', actorId: 'mara', witnesses: ['user', 'mara'], payload: { text: 'I will fix them today.' } });
  // A grounded open loop owned by mara: the reflection pass resolves it by id.
  const stream = await journal.readSeaProjection('room-v08');
  await journal.appendEvent('room-v08', {
    roomId: 'room-v08', scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'harness', witnesses: ['mara'],
    payload: { ownerId: 'mara', kind: 'open-loop', text: 'The tools still need repairing.', sourceEventIds: [stream[stream.length - 1].id] },
  });
  console.log('seeded');
  process.exit(0);
};
run().catch((error) => { console.error(error); process.exit(1); });
`);

// Static fake model no longer works: output must cite real event ids and may
// close only the owner's canonically-open loops. The llmFn parses the prompt
// (same JSON the real model receives) and derives a contract-valid response.
const RUN_REFLECTION = path.join(STAGES, 'run-reflection.cjs');
fs.writeFileSync(RUN_REFLECTION, `${COMMON}
const fs = require('fs'); const path = require('path');
const dreamer = require(path.join(SERVICES, 'dreamerService.js'));
const label = process.env.V08_LABEL;
const policy = { kind: 'local', isPermitted: () => true, prefer: () => true };
const killSelf = () => { process.kill(process.pid, 'SIGKILL'); };

const llmFn = async (prompt) => {
  fs.writeFileSync(path.join(process.env.V08_PROFILE, 'last-prompt.json'), prompt);
  if (label === 'A') killSelf(); // crash while the model call is outstanding
  const parsed = JSON.parse(prompt);
  const eventIds = parsed.events.map((event) => event.id);
  const loop = parsed.continuingContext.openLoops[0];
  return JSON.stringify({
    beliefs: [{ ownerId: parsed.owner ? parsed.owner.id : 'mara', kind: 'belief', text: 'Mara intends to repair the shared tools.', sourceEventIds: [eventIds[0]] }],
    resolutions: loop ? [{ ownerId: 'mara', loop: 1, status: 'satisfied', text: 'The tool repair is done.', sourceEventIds: [eventIds[eventIds.length - 1]] }] : [],
  });
};

// Boundary hooks: SIGKILL after specific journal writes land (all awaited).
const originalAppend = fs.promises.appendFile;
let derivedAppends = 0;
fs.promises.appendFile = async (filePath, data) => {
  await originalAppend(filePath, data);
  const line = String(data);
  if (line.includes('"type":"consolidation"')) {
    if (label === 'C') killSelf(); // after the marker append, before settlement
    return;
  }
  derivedAppends += 1;
  if (label === 'B' && derivedAppends >= 1) killSelf(); // after the first derived row only
};

const run = async () => {
  await dreamer.runReflection({ roomId: 'room-v08', scopeKind: 'sea' }, { policy, llmFn, now: 100 });
  console.log('completed');
};
run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
`);

const READ_STATE = path.join(STAGES, 'read-state.cjs');
fs.writeFileSync(READ_STATE, `${COMMON}
const path = require('path');
const journal = require(path.join(SERVICES, 'journalService.js'));
const world = require(path.join(SERVICES, 'worldStore.js'));
const read = async () => {
  const events = await journal.readSeaProjection('room-v08');
  console.log(JSON.stringify({
    // Canonical DERIVED rows only: the seeded open loop has no reflection provenance.
    derived: events.filter((event) => event.provenance?.reflectionId !== undefined
      && (event.type === 'memory.belief' || event.type === 'resolution')).length,
    markers: events.filter((event) => event.type === 'consolidation').length,
    ledger: ((await world.loadWorld()).reflectionRuns ?? []).map((run) => ({ status: run.status, prepared: run.prepared ? run.prepared.kind : undefined })),
  }));
  process.exit(0);
};
read().catch((error) => { console.error(error); process.exit(1); });
`);

const RECOVER = path.join(STAGES, 'recover.cjs');
fs.writeFileSync(RECOVER, `${COMMON}
const path = require('path');
const runtime = require(path.join(SERVICES, 'dreamerRuntime.js'));
const run = async () => {
  await runtime.reconcilePendingMaintenance();
  console.log('recovered');
  process.exit(0);
};
run().catch((error) => { console.error(error); process.exit(1); });
`);

function reseed(label, targetProfile) {
  const result = runStage(SEED, targetProfile, `reseed-${label}`);
  if (result.code !== 0) { failures += 1; console.error(`FAIL reseed ${label}`, result.stderr.slice(-300)); }
}
function recover(label, targetProfile) {
  const result = runStage(RECOVER, targetProfile, label);
  if (result.code !== 0) { failures += 1; console.error(`FAIL ${label}`, result.stderr.slice(-300)); }
}
function readState(label, targetProfile) {
  const result = runStage(READ_STATE, targetProfile, label);
  if (result.code !== 0) { failures += 1; console.error(`FAIL ${label} read`, result.stderr.slice(-300)); return null; }
  return JSON.parse(result.stdout);
}

// ── Probe A ───────────────────────────────────────────────────────────────────
{
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'v08-a-'));
  reseed('A', p);
  const killed = runStage(RUN_REFLECTION, p, 'A');
  check('probe A killed at model-call boundary (SIGKILL)', killed.signal === 'SIGKILL', `code=${killed.code} stderr=${killed.stderr.slice(-200)}`);
  const pre = JSON.parse(runStage(READ_STATE, p, 'read-A0').stdout);
  check('probe A pre-recovery: no canonical derived rows, pending record exists', pre.derived === 0 && pre.markers === 0 && pre.ledger.some((run) => run.status === 'pending'), JSON.stringify(pre));
  recover('recover-A', p);
  const post = JSON.parse(runStage(READ_STATE, p, 'read-A1').stdout);
  check('probe A recovery settles failed fail-closed (window reopens, no rows)', post.derived === 0 && post.ledger.every((run) => run.status !== 'pending'), JSON.stringify(post));
  const replay = runStage(RUN_REFLECTION, p, 'A-replay');
  const replayState = JSON.parse(runStage(READ_STATE, p, 'read-A2').stdout);
  check('probe A replay derives exactly one belief and one resolution, one marker', replayState.derived === 2 && replayState.markers === 1 && replay.code === 0, JSON.stringify(replayState));
  runStage(RUN_REFLECTION, p, 'A-replay2');
  const idem = JSON.parse(runStage(READ_STATE, p, 'read-A3').stdout);
  check('probe A further replay is idempotent', idem.derived === 2 && idem.markers === 1, JSON.stringify(idem));
}

// ── Probe B ───────────────────────────────────────────────────────────────────
{
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'v08-b-'));
  reseed('B', p);
  const killed = runStage(RUN_REFLECTION, p, 'B');
  check('probe B killed after the first derived row', killed.signal === 'SIGKILL', killed.stderr.slice(-200));
  const pre = JSON.parse(runStage(READ_STATE, p, 'read-B0').stdout);
  check('probe B pre-recovery: zero canonical derived rows, pending with prepared drafts', pre.derived === 0 && pre.markers === 0 && pre.ledger.some((run) => run.status === 'pending' && run.prepared === 'reflection'), JSON.stringify(pre));
  recover('recover-B', p);
  const post = JSON.parse(runStage(READ_STATE, p, 'read-B1').stdout);
  check('probe B recovery completes the publication all-or-nothing (2 derived, 1 marker)', post.derived === 2 && post.markers === 1, JSON.stringify(post));
  const committed = post.ledger.find((run) => run.status === 'committed');
  check('probe B record committed with prepared cleared', Boolean(committed) && committed.prepared === undefined, JSON.stringify(post.ledger));
  runStage(RUN_REFLECTION, p, 'B-replay');
  const idem = JSON.parse(runStage(READ_STATE, p, 'read-B2').stdout);
  check('probe B replay is idempotent', idem.derived === 2 && idem.markers === 1, JSON.stringify(idem));
}

// ── Probe C ───────────────────────────────────────────────────────────────────
{
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'v08-c-'));
  reseed('C', p);
  const killed = runStage(RUN_REFLECTION, p, 'C');
  check('probe C killed after the marker append', killed.signal === 'SIGKILL', killed.stderr.slice(-200));
  const pre = JSON.parse(runStage(READ_STATE, p, 'read-C0').stdout);
  check('probe C pre-recovery: publication hidden, record pending', pre.derived === 0 && pre.markers === 0 && pre.ledger.some((run) => run.status === 'pending'), JSON.stringify(pre));
  recover('recover-C', p);
  const post = JSON.parse(runStage(READ_STATE, p, 'read-C1').stdout);
  check('probe C recovery verifies the marker and settles committed without duplicating it', post.derived === 2 && post.markers === 1, JSON.stringify(post));
}

// ── Probe D: clean committed run replays idempotently ────────────────────────
{
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'v08-d-'));
  reseed('D', p);
  const clean = runStage(RUN_REFLECTION, p, 'D');
  if (clean.code !== 0) { failures += 1; console.error('FAIL probe D clean run', clean.stderr.slice(-400)); }
  else {
    const state = JSON.parse(runStage(READ_STATE, p, 'read-D0').stdout);
    const committed = state.ledger.filter((run) => run.status === 'committed');
    check('probe D clean run commits exactly one record', state.derived === 2 && state.markers === 1 && committed.length === 1 && committed[0].prepared === undefined, JSON.stringify(state));
    runStage(RUN_REFLECTION, p, 'D-replay');
    const idem = JSON.parse(runStage(READ_STATE, p, 'read-D1').stdout);
    check('probe D replay is idempotent (no second window)', idem.derived === 2 && idem.markers === 1, JSON.stringify(idem));
  }
}

console.log(failures === 0 ? '\nV08 reflection crash verification: ALL PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
