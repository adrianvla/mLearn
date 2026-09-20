#!/usr/bin/env node
/**
 * V08 MOUNTED Electron evidence: runs the real built application (production
 * main + real renderer window + preload) against a disposable profile and the
 * real local model, drives the actual Conversation UI over CDP, and verifies
 * the Living World loop: persistent Room → real interaction → AUTOMATIC
 * reflection (no manual trigger) → reload → return → evolved situation state
 * present in the same continuity.
 *
 * Usage: node scripts/v08-mounted-electron.cjs
 * Requires: npm run build (dist/ + dist-electron/), a running local Ollama
 * with an installed Ollama model, MLEARN_USER_DATA disposable profile (created here).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODEL = process.env.V08_OLLAMA_MODEL || 'gemma4-e4b-q4:latest';
// A free port per run: an orphaned Electron from a previous timed-out run
// must never receive this harness's traffic (it would look like the app
// failing to mount).
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);

const { execSync } = require('child_process');

// Full cloned-profile pattern (VERIFY-08/DATA-01; same as the V07
// verification): clone the user's installed profile ONCE with APFS
// copy-on-write so the app sees its real installed language data — the
// original profile is only ever read. Development Electron resolves the
// checked-in build's dist-electron/env as its runtime. Per-run profiles clone
// the cache (seconds), then patch settings and seed a deterministic persistent
// world. Every profile write lands in the disposable clone only.
const ORIGINAL_PROFILE = path.join(process.env.HOME, 'Library', 'Application Support', 'mLearn');
const PROFILE_CACHE = '/tmp/v08-profile-clone';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'v08-mounted-'));

if (!fs.existsSync(path.join(ROOT, 'dist-electron', 'env', 'bin', 'python3'))) {
  console.error('NO_DEVELOPMENT_PYTHON_ENV: build runtime missing at', path.join(ROOT, 'dist-electron', 'env'));
  process.exit(2);
}
if (!fs.existsSync(path.join(PROFILE_CACHE, 'settings.json'))) {
  console.log('Cloning the installed profile into cache (first run only)...');
  fs.rmSync(PROFILE_CACHE, { recursive: true, force: true });
  execSync(`cp -Rc '${ORIGINAL_PROFILE}' '${PROFILE_CACHE}'`, { stdio: 'inherit' });
}
console.log('Cloning disposable profile...');
execSync(`cp -Rc '${PROFILE_CACHE}/.' '${profile}/'`);
if (!fs.existsSync(path.join(profile, 'settings.json'))) {
  console.error('CLONE_INVALID: cloned profile has no settings.json');
  process.exit(2);
}
console.log('PASS disposable cloned profile ready');

// Patch the CLONE's settings: real local model, Living World consent ON
// (this run verifies the Living World loop; consent-off behavior is covered
// by deterministic gate tests), proactive notifications off.
const clonedSettings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  ...clonedSettings,
  llmProvider: 'ollama',
  ollamaModel: MODEL,
  llmEnabled: true,
  livingWorldEnabled: true,
  proactivityEnabled: false,
}));

// Seed a deterministic persistent world into the clone (replacing the
// copied world entity state; journal directories of unrelated rooms are
// inert because no entity references them).
fs.writeFileSync(path.join(profile, 'world.json'), JSON.stringify({
  rooms: [{
    id: 'room-mounted', title: 'Garden', participantIds: ['mara', 'eli'], createdAt: 1,
    scenario: {
      scene: {
        sharedFacts: ['Two neighbors share a small garden plot behind their houses.'],
        userObjectivePrivate: 'Practice natural conversation.',
        socialConstraints: ['Let everyone contribute to the plan.'],
      },
      participants: [
        { kind: 'existing', participantId: 'mara' },
        { kind: 'existing', participantId: 'eli' },
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpSend(ws, id, method, params) {
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === id) {
        ws.removeEventListener('message', onMessage);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      }
    };
    ws.addEventListener('message', onMessage);
  });
}

let electron = null;
let vite = null;

async function main() {
  // Hard watchdog: never leave orphaned Electron/Vite behind. Only the
  // tracked detached child process groups are killed — never this process's
  // own group.
  const watchdog = setTimeout(() => {
    console.error('HARD_TIMEOUT');
    try { if (electron) process.kill(-electron.pid, 'SIGKILL'); } catch {}
    try { if (vite) process.kill(-vite.pid, 'SIGKILL'); } catch {}
    process.exit(2);
  }, 12 * 60_000);
  watchdog.unref();
  // Fail fast if the chosen port is already bound (a leftover instance).
  try {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    console.error(`PORT_BUSY: ${CDP_PORT} — rerun (random port picked per run)`);
    process.exit(2);
  } catch { /* free */ }
  // Renderer mode contract: NODE_ENV=development loads the renderer from the
  // vite dev server (localhost:3000) — the source html cannot execute TSX
  // under file:// in non-packaged mode. Same contract as `npm run dev`.
  vite = spawn('npx', ['vite', '--port', '3000', '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  electron = spawn('npx', ['electron', '.', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: ROOT,
    env: { ...process.env, MLEARN_USER_DATA: profile, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  electron.stdout.on('data', (d) => process.env.V08_DEBUG && process.stdout.write(`[electron] ${d}`));
  electron.stderr.on('data', (d) => process.env.V08_DEBUG && process.stdout.write(`[electron:err] ${d}`));
  const shutdown = async (code) => {
    try { process.kill(-electron.pid, 'SIGKILL'); } catch {}
    try { process.kill(-vite.pid, 'SIGKILL'); } catch {}
    process.exit(code);
  };
  process.on('exit', () => { try { process.kill(-electron.pid, 'SIGKILL'); } catch {} try { process.kill(-vite.pid, 'SIGKILL'); } catch {} });

  // Wait for the vite dev server before electron expects it.
  for (let i = 0; i < 60; i++) {
    try {
      await fetch('http://localhost:3000/src/html/main.html', { method: 'HEAD' });
      break;
    } catch { await sleep(1000); }
  }

  // Wait for the CDP endpoint and the real app window (main.html).
  let appTarget = null;
  for (let i = 0; i < 60 && !appTarget; i++) {
    await sleep(1000);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      appTarget = list.find((t) => t.type === 'page' && t.url.includes('main.html')) ?? null;
    } catch { /* not up yet */ }
  }
  if (!appTarget) { console.error('NO_APP_TARGET'); await shutdown(2); return; }
  console.log('PASS app window target found:', appTarget.url.slice(0, 70));

  const ws = new WebSocket(appTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let messageId = 0;
  const dashSend = (method, params) => cdpSend(ws, ++messageId, method, params);
  const dashEvaluate = async (expression) => {
    const result = await dashSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`page error: ${result.exceptionDetails.exception?.description ?? 'unknown'}`);
    return result.result.value;
  };

  // Wait for the app to mount (Solid render into #root).
  let mounted = false;
  for (let i = 0; i < 60 && !mounted; i++) {
    await sleep(1000);
    try {
      mounted = await dashEvaluate(`document.querySelector('#root')?.children.length > 0`);
    } catch { /* navigations */ }
  }
  if (!mounted) { console.error('APP_NOT_MOUNTED'); await shutdown(2); return; }
  console.log('PASS app mounted in real Electron window');

  // First-run EULA gate: scroll the document to the bottom (enables the
  // agree toggle), flip the toggle, click Accept — real UI order.
  for (let i = 0; i < 10; i++) {
    const eulaGone = await dashEvaluate(`(() => {
      const doc = document.querySelector('.eula-document');
      if (!doc) return document.querySelector('.eula-overlay') === null;
      doc.scrollTop = doc.scrollHeight;
      doc.dispatchEvent(new Event('scroll', { bubbles: true }));
      return false;
    })()`);
    if (eulaGone) break;
    await dashEvaluate(`(() => { document.querySelector('.eula-toggle input, .eula-toggle')?.click(); return 'toggled'; })()`);
    await sleep(500);
    await dashEvaluate(`(() => { document.querySelector('.eula-accept-btn:not(:disabled)')?.click(); return 'accepted'; })()`);
    await sleep(1500);
    const gone = await dashEvaluate(`document.querySelector('.eula-overlay') === null`);
    if (gone) break;
  }
  console.log('PASS EULA gate passed (or absent)');

  // Dismiss any other first-run gates (age verification, intro) with clicks.
  for (let i = 0; i < 15; i++) {
    const gate = await dashEvaluate(`(() => {
      const clickables = [...document.querySelectorAll('button')];
      const gateButton = clickables.find(b =>
        /agree|accept|continue|start|verify|confirm|understand/i.test(b.textContent ?? ''));
      if (gateButton) { gateButton.click(); return gateButton.textContent; }
      return null;
    })()`);
    if (gate === null) break;
    await sleep(1500);
  }
  console.log('PASS first-run gates dismissed');

  // The dashboard hosts the Conversation surface as a child window: open it
  // through the same production bridge call the AI Tutor card uses.
  const convOpened = await dashEvaluate(`(() => {
    try {
      window.mLearnIPC.openWindow({ type: 'conversation-agent' });
      return 'opened';
    } catch (error) { return 'OPEN_FAILED: ' + error.message; }
  })()`);
  if (convOpened !== 'opened') { console.error(convOpened); await shutdown(2); return; }
  // Wait for the conversation window target.
  let convTarget = null;
  for (let i = 0; i < 60 && !convTarget; i++) {
    await sleep(1000);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      convTarget = list.find((t) => t.type === 'page' && /conversation|agent/i.test(t.url)) ?? null;
    } catch { /* listing */ }
  }
  if (!convTarget) { console.error('NO_CONVERSATION_TARGET'); await shutdown(2); return; }
  console.log('PASS conversation window opened:', convTarget.url.slice(0, 80));
  // Drive the conversation window from here on.
  const convWs = new WebSocket(convTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { convWs.onopen = resolve; convWs.onerror = reject; });
  const send = (method, params) => cdpSend(convWs, ++messageId, method, params);
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`page error: ${result.exceptionDetails.exception?.description ?? 'unknown'}`);
    return result.result.value;
  };

  // First-run intro dialog: "Continue to Chat" gates the conversation UI.
  // The loop exits only when the button is GONE (sidebar presence behind a
  // modal proves nothing).
  let introGone = false;
  for (let i = 0; i < 15 && !introGone; i++) {
    introGone = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /continue to chat/i.test(b.textContent ?? ''));
      if (btn) { btn.click(); return false; }
      return true;
    })()`);
    if (!introGone) await sleep(2000);
  }
  if (!introGone) { console.error('INTRO_MODAL_STUCK'); await shutdown(2); return; }
  console.log('PASS intro dialog dismissed (or absent)');

  // Select the persistent Room in the sidebar (real UI interaction), waiting
  // for the local backend to finish starting (its progress overlay gates the
  // sidebar) and the roster to load.
  let selected = 'ROOM_NOT_FOUND';
  for (let i = 0; i < 150 && selected !== 'clicked'; i++) {
    const state = await evaluate(`(() => {
      const body = document.body.innerText;
      if (/Starting backend|Language Data Required|Setup Required/i.test(body)) return 'gated';
      const candidates = [...document.querySelectorAll('button, [role="button"], li, div, span')]
        .filter(el => el.textContent?.trim() === 'Garden' || el.textContent?.trim().startsWith('Garden'))
        .filter(el => el.children.length <= 2);
      const room = candidates.find(el => el.closest('button, [role="button"], li')) ?? candidates[0];
      if (!room) return 'ROOM_NOT_FOUND';
      room.click();
      return 'clicked';
    })()`);
    if (state === 'clicked') { selected = 'clicked'; break; }
    if (i % 15 === 14) console.log(`still waiting for UI readiness (${i + 1} rounds):`, state);
    selected = state;
    await sleep(2000);
  }
  if (selected !== 'clicked') {
    // Surface the actual blocker (e.g. backend setup gate) before failing.
    try {
      await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => /show details/i.test(b.textContent ?? '')); b?.click(); return 'ok'; })()`);
      await sleep(1500);
      const blocker = await evaluate(`document.body.innerText.slice(0, 1200).replace(/\\n+/g, ' | ')`);
      console.error('ROOM_NOT_FOUND — current DOM state:', blocker);
    } catch (dumpError) { console.error('ROOM_NOT_FOUND (dump failed)', dumpError); }
    await shutdown(2);
    return;
  }
  await sleep(2000);
  console.log('PASS persistent Room selected via sidebar click');

  const journalPath = path.join(profile, 'journal', 'room-mounted', 'sea.ndjson');
  const readRows = () => {
    try { return fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
    catch { return []; }
  };
  // Wait for a REAL character reply: a new message.character row beyond the
  // pre-typing snapshot (the user event itself must never satisfy this).
  const waitForNewEvent = async (type, beforeRows, timeoutMs, label) => {
    const knownIds = new Set(beforeRows.map((r) => r.id));
    const deadline = Date.now() + timeoutMs;
    let found = null;
    while (!found && Date.now() < deadline) {
      await sleep(2000);
      found = readRows().find((r) => r.type === type && !knownIds.has(r.id)
        && (type !== 'message.character' || (typeof r.payload?.text === 'string' && r.payload.text.trim().length > 0))) ?? null;
    }
    if (!found) {
      const nowRows = readRows();
      const appended = nowRows.filter((r) => !knownIds.has(r.id)).map((r) => r.type);
      try {
        const state = await evaluate(`document.body.innerText.slice(0, 700).replace(/\\n+/g, ' | ')`);
        console.error(`TIMEOUT: ${label} — appended types: [${appended.join(', ')}] UI state:`, state);
      } catch (dumpError) { console.error(`TIMEOUT: ${label} (dump failed)`, dumpError); }
      throw new Error(`TIMEOUT_WAITING_FOR: ${label}`);
    }
    return found;
  };

  // Turn 1: type + Enter through trusted CDP input events (the composer is a
  // Solid controlled component and ignores synthetic JS key events).
  const beforeTyping = readRows();
  const typed = await evaluate(`(() => {
    const input = document.querySelector('textarea, [contenteditable="true"], input[type="text"]');
    if (!input) return 'INPUT_NOT_FOUND';
    input.focus();
    input.click();
    return 'focused';
  })()`);
  if (typed !== 'focused') { console.error(typed); await shutdown(2); return; }
  await send('Input.insertText', { text: 'Mara, Eli — what is the plan for the broken rake this week?' });
  await sleep(500);
  // Send = Cmd+Enter (App keydown contract) or the enabled Send button.
  const sendClicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('send'));
    if (btn && !btn.disabled) { btn.click(); return 'send-clicked'; }
    return 'SEND_BUTTON_NOT_ENABLED';
  })()`);
  if (sendClicked !== 'send-clicked') {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 });
  }
  console.log('sent real user message through the mounted UI');
  await waitForNewEvent('message.user', beforeTyping, 60_000, 'user event append');
  console.log('PASS user event committed to Sea');
  await waitForNewEvent('message.character', beforeTyping, 240_000, 'real character reply');
  console.log('PASS real character reply committed to Sea');

  // AUTOMATIC reflection: the foreground exchange itself triggers main-owned
  // maintenance (no manual trigger here). Wait for derived rows in the journal.
  const canonicalRows = () => {
    const state = JSON.parse(fs.readFileSync(path.join(profile, 'world.json'), 'utf8'));
    const committed = new Set((state.reflectionRuns ?? []).filter(r => r.status === 'committed').map(r => r.reflectionId));
    return readRows().filter(row => !row.provenance?.reflectionId || committed.has(row.provenance.reflectionId));
  };
  const derivedCount = () => canonicalRows().filter(e => e.provenance?.reflectionId
    && (e.type === 'memory.belief' || e.type === 'resolution')).length;
  const derivedBefore = beforeTyping.filter(e => e.provenance?.reflectionId
    && (e.type === 'memory.belief' || e.type === 'resolution')).length;
  const deadlineReflection = Date.now() + 300_000;
  while (derivedCount() <= derivedBefore && Date.now() < deadlineReflection) await sleep(3000);
  if (derivedCount() <= derivedBefore) { console.error('TIMEOUT: automatic reflection derived rows'); await shutdown(2); return; }
  console.log('PASS automatic reflection committed derived rows without any manual trigger');

  while (!canonicalRows().some(e => e.type === 'scenario_evolved') && Date.now() < deadlineReflection) await sleep(1000);
  if (!canonicalRows().some(e => e.type === 'scenario_evolved')) throw new Error('NO_COMMITTED_SCENARIO_BEFORE_RELOAD');

  // Reload (leave/reload/return path), then verify continuity + evolution.
  await send('Page.reload', {});
  await sleep(6000);
  let remounted = false;
  for (let i = 0; i < 30 && !remounted; i++) {
    await sleep(1000);
    try { remounted = await evaluate(`document.querySelector('#root')?.children.length > 0`); } catch { /* reloading */ }
  }
  if (!remounted) { console.error('APP_NOT_REMOUNTED'); await shutdown(2); return; }
  console.log('PASS app reloaded and remounted');

  // Return to the Room and confirm history + evolved situation context.
  await sleep(3000);
  const visible = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasRoom: text.includes('Garden'),
      hasHistory: text.includes('broken rake') || text.includes('rake'),
    };
  })()`);
  if (!visible.hasRoom || !visible.hasHistory) { console.error('ROOM_NOT_VISIBLE_AFTER_RELOAD'); await shutdown(2); return; }
  console.log('PASS Room continuity after reload:', JSON.stringify(visible));

  // Second real exchange in the same continuity (post-reload turn).
  const beforeTurnTwo = readRows();
  await evaluate(`(() => {
    const input = document.querySelector('textarea, [contenteditable="true"], input[type="text"]');
    input?.focus();
    input?.click();
    return 'ok';
  })()`);
  await send('Input.insertText', { text: 'Thanks both. Mara, how does the situation look now?' });
  await sleep(500);
  await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('send')); if (btn && !btn.disabled) btn.click(); return 'ok'; })()`);
  await sleep(300);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 });
  await waitForNewEvent('message.user', beforeTurnTwo, 60_000, 'post-reload user event');
  await waitForNewEvent('message.character', beforeTurnTwo, 240_000, 'post-reload real reply');
  console.log('PASS real exchange after reload in the same Room continuity');

  // Verify the evolved situation state (world.json scenario) influenced the
  // continuity: the scenario must carry valid, cited interpretations or the room
  // must still hold its coherent state after reload.
  const world = JSON.parse(fs.readFileSync(path.join(profile, 'world.json'), 'utf8'));
  const room = world.rooms.find((r) => r.id === 'room-mounted');
  const events = canonicalRows();
  const derived = events.filter((e) => e.provenance?.reflectionId !== undefined && e.type !== 'consolidation');
  const evolved = events.filter((e) => e.type === 'scenario_evolved');
  const record = {
    profile: path.basename(profile),
    surface: `real mounted Electron app; real renderer UI over CDP; real ollama ${MODEL}`,
    derivedRows: derived.map((e) => ({ type: e.type, witnesses: e.witnesses, payload: e.payload })),
    scenarioEvolvedRows: evolved.length,
    scenarioStatus: room?.scenario?.status ?? 'active',
    scenarioInterpretations: (room?.scenario?.developments ?? []).map((d) => ({ authority: d.authority, kind: d.kind, text: d.text, sourceEventIds: d.sourceEventIds })),
    roomEvents: events.length,
  };
  fs.writeFileSync(path.join(os.tmpdir(), 'v08-mounted-record.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  const pass = record.derivedRows.some(row => row.type === 'memory.belief' || row.type === 'resolution')
    && record.scenarioEvolvedRows > 0 && visible.hasRoom && visible.hasHistory
    && record.scenarioInterpretations.every(item => item.authority === 'interpretation')
    && events.filter(e => e.type === 'message.character' && typeof e.payload?.text === 'string' && e.payload.text.trim()).length >= 2;
  // Transport and durability cannot establish semantic support for model prose.
  console.log(`MOUNTED_TRANSPORT_EVIDENCE=${pass ? 'PASS' : 'BLOCKED'}`);
  console.log(`\nMOUNTED_ELECTRON_EVIDENCE=${pass ? 'NEEDS_SEMANTIC_REVIEW' : 'BLOCKED'}`);
  await shutdown(pass ? 0 : 2);
}

main().catch(async (error) => { console.error('FATAL', error); process.exit(1); });
