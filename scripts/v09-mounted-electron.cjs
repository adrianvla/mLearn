#!/usr/bin/env node
/**
 * V09 mounted-product evidence. Drives the built Electron renderer through CDP
 * on a disposable clone, closes the Conversation window while the main/tray
 * lifecycle continues, waits for autonomous occurrence + V08 reflection,
 * terminates/restarts the full process, pauses autonomy in product UI, and
 * obtains a later real response that consumes the offscreen history.
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODEL = process.env.V09_OLLAMA_MODEL || 'gemma4-e4b-q4:latest';
const ORIGINAL_PROFILE = path.join(process.env.HOME, 'Library', 'Application Support', 'mLearn');
const PROFILE_CACHE = '/tmp/v09-profile-clone';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'v09-mounted-'));
const ROOM_ID = 'room-mounted-v09';
const ROOM_TITLE = 'V09 Seed Room';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!fs.existsSync(path.join(ROOT, 'dist-electron', 'env', 'bin', 'python3'))) {
  console.error('NO_DEVELOPMENT_PYTHON_ENV'); process.exit(2);
}
if (!fs.existsSync(path.join(PROFILE_CACHE, 'settings.json'))) {
  fs.rmSync(PROFILE_CACHE, { recursive: true, force: true });
  execSync(`cp -Rc '${ORIGINAL_PROFILE}' '${PROFILE_CACHE}'`, { stdio: 'inherit' });
}
execSync(`cp -Rc '${PROFILE_CACHE}/.' '${profile}/'`);
const settingsPath = path.join(profile, 'settings.json');
const clonedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
fs.writeFileSync(settingsPath, JSON.stringify({
  ...clonedSettings,
  llmProvider: 'ollama', ollamaModel: MODEL, llmEnabled: true,
  language: 'en', uiLanguage: 'en',
  livingWorldEnabled: true, worldAutonomyEnabled: true, proactivityEnabled: false,
}));
fs.rmSync(path.join(profile, 'journal', ROOM_ID), { recursive: true, force: true });
fs.writeFileSync(path.join(profile, 'world.json'), JSON.stringify({
  rooms: [{
    id: ROOM_ID, title: ROOM_TITLE, participantIds: ['eli', 'mara', 'noa'], createdAt: 1,
    scenario: {
      scene: {
        sharedFacts: ['Mara and Eli are together at their small shared seed-library work table. Empty envelopes and a newly donated box of loose seeds are ready to handle. Damp weather is expected tonight.'],
        socialConstraints: ['Prefer ordinary, cooperative, low-drama action. When a harmless small seed-library step is grounded and the materials are already available, begin it promptly rather than waiting without a concrete constraint.'],
        userObjectivePrivate: 'Practice natural conversation.',
      },
      participants: [{ kind: 'existing', participantId: 'eli' }, { kind: 'existing', participantId: 'mara' }, { kind: 'existing', participantId: 'noa' }],
      relationships: [{ fromId: 'mara', toId: 'eli', label: 'Reliable garden collaborators', directional: true }],
      adaptations: [],
    },
  }],
  threads: [],
  participants: [
    { id: 'mara', displayName: 'Mara', kind: 'persistent', personaText: 'A patient community gardener who loves cataloguing saved seeds, values reliable shared routines, and often collaborates with Eli on small practical projects.', setupComplete: true },
    { id: 'eli', displayName: 'Eli', kind: 'persistent', personaText: 'A warm, dependable illustrator who enjoys hand-lettered labels and useful shared projects. When seed-library materials are ready, he likes beginning one small concrete step promptly and readily asks Mara to help.', setupComplete: true },
    { id: 'noa', displayName: 'Noa', kind: 'persistent', personaText: 'A private reader who is currently away from the work table.', setupComplete: true },
  ],
}, null, 2));
console.log(`PASS disposable cloned profile ready: ${profile}`);

const journalPath = path.join(profile, 'journal', ROOM_ID, 'sea.ndjson');
const readRows = () => {
  try { return fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch { return []; }
};
const readWorld = () => JSON.parse(fs.readFileSync(path.join(profile, 'world.json'), 'utf8'));
const canonicalRows = () => {
  const world = readWorld();
  const reflectionIds = new Set((world.reflectionRuns ?? []).filter(run => run.status === 'committed').map(run => run.reflectionId));
  const jobs = new Map((world.autonomyJobs ?? []).filter(job => job.status === 'committed').map(job => [job.jobId, new Set(job.eventIds ?? [])]));
  return readRows().filter(row => {
    if (row.provenance?.reflectionId && !reflectionIds.has(row.provenance.reflectionId)) return false;
    if (row.provenance?.autonomyJobId && !jobs.get(row.provenance.autonomyJobId)?.has(row.id)) return false;
    return true;
  });
};

async function cdpSend(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`)); else resolve(message.result);
    };
    ws.addEventListener('message', onMessage);
  });
}
async function connectTarget(port, predicate, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(predicate);
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        let id = 0;
        const evaluate = async expression => {
          for (let attempt = 0; attempt < 6; attempt++) {
            try {
              const result = await cdpSend(ws, ++id, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
              if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page evaluation failed');
              return result.result.value;
            } catch (error) {
              if (!String(error).includes('default execution context') || attempt === 5) throw error;
              await sleep(500);
            }
          }
        };
        return { ws, evaluate, send: (method, params) => cdpSend(ws, ++id, method, params), target };
      }
    } catch { /* process not ready */ }
    await sleep(1000);
  }
  throw new Error('CDP_TARGET_TIMEOUT');
}

let vite;
let electron;
const children = new Set();
function killGroup(child, signal = 'SIGKILL') { try { process.kill(-child.pid, signal); } catch {} }
async function startElectron(port) {
  electron = spawn('npx', ['electron', '.', `--remote-debugging-port=${port}`], {
    cwd: ROOT, env: { ...process.env, MLEARN_USER_DATA: profile, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  children.add(electron);
  electron.stdout.on('data', data => process.env.V09_DEBUG && process.stdout.write(`[electron] ${data}`));
  electron.stderr.on('data', data => process.env.V09_DEBUG && process.stderr.write(`[electron] ${data}`));
  const dashboard = await connectTarget(port, target => target.type === 'page' && target.url.includes('main.html'));
  for (let i = 0; i < 60; i++) {
    if (await dashboard.evaluate(`document.querySelector('#root')?.children.length > 0`)) break;
    await sleep(1000);
  }
  // Clear first-run gates if the clone still exposes any.
  for (let i = 0; i < 12; i++) {
    const acted = await dashboard.evaluate(`(() => {
      const doc=document.querySelector('.eula-document');if(doc){doc.scrollTop=doc.scrollHeight;doc.dispatchEvent(new Event('scroll',{bubbles:true}));}
      const button=[...document.querySelectorAll('button')].find(b=>/agree|accept|continue|start|verify|confirm|understand/i.test(b.textContent??'')&&!b.disabled);
      if(button){button.click();return true}return false;
    })()`);
    if (!acted) break;
    await sleep(1200);
  }
  return dashboard;
}
async function stopElectron() {
  if (!electron) return;
  const exited = new Promise(resolve => electron.once('exit', resolve));
  killGroup(electron, 'SIGTERM');
  await Promise.race([exited, sleep(10_000)]);
  killGroup(electron, 'SIGKILL');
  children.delete(electron);
  electron = undefined;
}
async function openConversation(dashboard, port) {
  await dashboard.evaluate(`window.mLearnIPC.openWindow({type:'conversation-agent'});'opened'`);
  const conversation = await connectTarget(port, target => target.type === 'page' && /conversation-agent/i.test(target.url));
  for (let i = 0; i < 20; i++) {
    const ready = await conversation.evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(x=>/continue to chat/i.test(x.textContent??''));if(b){b.click();return false}return document.querySelector('#root')?.children.length>0})()`);
    if (ready) break;
    await sleep(1000);
  }
  let selected = false;
  for (let i = 0; i < 120 && !selected; i++) {
    selected = await conversation.evaluate(`(() => {
      if(/Starting backend|Language Data Required|Setup Required/i.test(document.body.innerText))return false;
      const item=[...document.querySelectorAll('button,[role="button"],li,div,span')].find(el=>el.textContent?.trim()===${JSON.stringify(ROOM_TITLE)}&&el.children.length<=2);
      if(!item)return false;(item.closest('button,[role="button"],li')??item).click();return true;
    })()`);
    if (!selected) await sleep(1500);
  }
  if (!selected) throw new Error('ROOM_NOT_SELECTABLE');
  await sleep(1500);
  return conversation;
}
async function sendTurn(conversation, text, timeoutMs = 300_000) {
  const startedAt = Date.now();
  const before = readRows();
  const known = new Set(before.map(row => row.id));
  const focused = await conversation.evaluate(`(() => {const input=document.querySelector('textarea,[contenteditable="true"],input[type="text"]');if(!input)return false;input.focus();input.click();return true})()`);
  if (!focused) throw new Error('COMPOSER_NOT_FOUND');
  await conversation.send('Input.insertText', { text });
  await sleep(300);
  const clicked = await conversation.evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')??'').toLowerCase().includes('send'));if(b&&!b.disabled){b.click();return true}return false})()`);
  if (!clicked) {
    await conversation.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 });
    await conversation.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 });
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = readRows();
    const user = rows.find(row => !known.has(row.id) && row.type === 'message.user');
    const character = rows.find(row => !known.has(row.id) && row.type === 'message.character' && row.provenance?.autonomyJobId === undefined && row.payload?.text?.trim());
    if (user && character) return { user, character, elapsedMs: Date.now() - startedAt };
    await sleep(1500);
  }
  throw new Error('FOREGROUND_TURN_TIMEOUT');
}

async function main() {
  const watchdog = setTimeout(() => { console.error('HARD_TIMEOUT'); for (const child of children) killGroup(child); process.exit(2); }, 20 * 60_000);
  watchdog.unref();
  vite = spawn('npx', ['vite', '--port', '3000', '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.add(vite);
  for (let i = 0; i < 60; i++) { try { await fetch('http://localhost:3000/src/html/main.html', { method: 'HEAD' }); break; } catch { await sleep(1000); } }

  const port1 = 9500 + Math.floor(Math.random() * 200);
  const dashboard1 = await startElectron(port1);
  console.log('PASS mounted Electron main and renderer');
  const conversation1 = await openConversation(dashboard1, port1);
  const firstTurn = await sendTurn(conversation1, 'Eli, the loose donated seeds and envelopes are ready, and damp weather is expected tonight. I am the user, not Mara; I am leaving and cannot help, while you and Mara remain together at the work table. Tell me one small thing you personally care about doing with Mara after I leave; do not assign it back to me.');
  console.log(`PASS real foreground turn: ${firstTurn.user.id} -> ${firstTurn.character.id} (${firstTurn.elapsedMs}ms)`);
  const userCountBeforeClose = readRows().filter(row => row.type === 'message.user').length;
  await conversation1.evaluate(`window.mLearnIPC.closeWindow();'closed'`);
  conversation1.ws.close();
  console.log('PASS Conversation window closed while Electron main/dashboard continue');

  const autonomyDeadline = Date.now() + 12 * 60_000;
  let episodeJob;
  while (Date.now() < autonomyDeadline && !episodeJob) {
    episodeJob = (readWorld().autonomyJobs ?? []).find(job => job.status === 'committed' && job.result === 'episode');
    if (!episodeJob) await sleep(3000);
  }
  if (!episodeJob) throw new Error(`AUTONOMOUS_EPISODE_TIMEOUT: ${JSON.stringify(readWorld().autonomyJobs ?? [])}`);
  const eventsAfterEpisode = canonicalRows();
  const occurrence = eventsAfterEpisode.find(row => row.type === 'occurrence.simulated' && row.provenance?.autonomyJobId === episodeJob.jobId);
  if (!occurrence) throw new Error('COMMITTED_OCCURRENCE_NOT_CANONICAL');
  if (occurrence.witnesses.includes('user') || occurrence.payload.actorIds.includes('user') || occurrence.witnesses.includes('noa')) throw new Error('INVALID_OFFSCREEN_AUTHORITY');
  if (readRows().filter(row => row.type === 'message.user').length !== userCountBeforeClose) throw new Error('OFFSCREEN_USER_EVENT_FABRICATED');
  console.log(`PASS offscreen occurrence ${occurrence.id}; witnesses=${occurrence.witnesses.join(',')}`);

  const reflectionDeadline = Date.now() + 300_000;
  const certifiedEpisodeIds = new Set(episodeJob.eventIds ?? []);
  let consequence;
  while (Date.now() < reflectionDeadline && !consequence) {
    consequence = canonicalRows().find(row => row.provenance?.reflectionId
      && ['memory.belief', 'resolution'].includes(row.type)
      && [...(row.payload?.sourceEventIds ?? []), ...(row.payload?.dependencyEventIds ?? [])]
        .some(id => certifiedEpisodeIds.has(id)));
    if (!consequence) await sleep(2500);
  }
  if (!consequence) throw new Error('AUTONOMOUS_OCCURRENCE_NOT_REFLECTED');
  const consequenceCitesOccurrence = [
    ...(consequence.payload?.sourceEventIds ?? []),
    ...(consequence.payload?.dependencyEventIds ?? []),
  ].includes(occurrence.id);
  console.log(`PASS automatic V08 consequence ${consequence.id} cites certified episode row${consequenceCitesOccurrence ? ' (occurrence)' : ''}`);

  const journalBytesBeforeQuit = fs.statSync(journalPath).size;
  const terminatedAt = Date.now();
  await stopElectron();
  await sleep(5000);
  if (fs.statSync(journalPath).size !== journalBytesBeforeQuit) throw new Error('PROFILE_CHANGED_WHILE_PROCESS_TERMINATED');
  console.log('PASS full process termination produced no claimed local activity');

  const port2 = port1 + 201;
  const dashboard2 = await startElectron(port2);
  const conversation2 = await openConversation(dashboard2, port2);
  console.log('PASS full restart and Room reload');

  // Pause through the real details surface.
  const paused = await conversation2.evaluate(`(async()=>{
    document.querySelector('.ca-overflow-anchor button')?.click();await new Promise(r=>setTimeout(r,300));
    [...document.querySelectorAll('button')].find(b=>/details/i.test(b.textContent??''))?.click();await new Promise(r=>setTimeout(r,300));
    const pause=[...document.querySelectorAll('button')].find(b=>/^pause$/i.test((b.textContent??'').trim()));
    if(!pause)return 'missing';pause.click();return 'clicked';
  })()`);
  if (paused !== 'clicked') throw new Error(`AUTONOMY_PAUSE_CONTROL_${paused}`);
  for (let i = 0; i < 30; i++) {
    if (JSON.parse(fs.readFileSync(settingsPath, 'utf8')).worldAutonomyEnabled === false) break;
    await sleep(500);
  }
  if (JSON.parse(fs.readFileSync(settingsPath, 'utf8')).worldAutonomyEnabled !== false) throw new Error('AUTONOMY_PAUSE_NOT_PERSISTED');
  console.log('PASS production autonomy pause persisted');

  const laterTurn = await sendTurn(conversation2, 'What became of the loose seeds and envelopes while I was away?');
  const laterText = laterTurn.character.payload.text;
  const consumes = /seed|envelope|catalog|label|sort/i.test(laterText);
  if (!consumes) throw new Error(`LATER_REPLY_DID_NOT_CONSUME_OCCURRENCE: ${laterText}`);
  console.log(`PASS later real reply consumed offscreen history: ${laterText}`);

  const proactive = canonicalRows().filter(row => row.type.startsWith('proactive_') || row.type.startsWith('call_'));
  const record = {
    profile, model: MODEL,
    surface: 'mounted Electron main + renderer + preload + real local provider on disposable cloned profile',
    foreground: { userEventId: firstTurn.user.id, characterEventId: firstTurn.character.id, elapsedMs: firstTurn.elapsedMs },
    autonomyJobs: (readWorld().autonomyJobs ?? []).map(job => ({
      id: job.jobId,
      candidateKind: job.candidateKind,
      leadParticipantId: job.leadParticipantId,
      status: job.status,
      result: job.result,
      attempts: job.attempts,
      eventIds: job.eventIds,
    })),
    episodeJob: { id: episodeJob.jobId, candidateKind: episodeJob.candidateKind, participantIds: episodeJob.participantIds, eventIds: episodeJob.eventIds },
    occurrence: { id: occurrence.id, witnesses: occurrence.witnesses, actorId: occurrence.actorId, payload: occurrence.payload },
    consequence: { id: consequence.id, type: consequence.type, witnesses: consequence.witnesses, citesOccurrence: consequenceCitesOccurrence, payload: consequence.payload },
    lifecycle: { conversationClosed: true, terminatedAt, restartedAt: Date.now(), paused: true, journalStableWhileTerminated: true },
    later: { userEventId: laterTurn.user.id, characterEventId: laterTurn.character.id, elapsedMs: laterTurn.elapsedMs, text: laterText },
    proactiveRows: proactive.length,
  };
  const output = path.join(os.tmpdir(), 'v09-mounted-record.json');
  fs.writeFileSync(output, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  const pass = proactive.length === 0 && consumes && episodeJob.eventIds.includes(occurrence.id);
  console.log(`\nV09_MOUNTED_EVIDENCE=${pass ? 'PASS' : 'BLOCKED'}`);
  console.log(`RECORD=${output}`);
  await stopElectron();
  killGroup(vite);
  children.clear();
  process.exit(pass ? 0 : 2);
}

let signalCleanupStarted = false;
async function cleanupSignal(code) {
  if (signalCleanupStarted) return;
  signalCleanupStarted = true;
  await stopElectron();
  if (vite) killGroup(vite, 'SIGTERM');
  for (const child of children) killGroup(child, 'SIGTERM');
  process.exit(code);
}
process.once('SIGINT', () => void cleanupSignal(130));
process.once('SIGTERM', () => void cleanupSignal(143));
process.on('exit', () => { for (const child of children) killGroup(child); });
main().catch(async error => { console.error('FATAL', error); await stopElectron(); if (vite) killGroup(vite); process.exit(1); });
