/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReviewCommand, ReviewEncounter, ReviewSession } from '@mlearn/contracts';
import { builtInThemes, initialTheme } from '../../packages/theme/src/theme';

const encounter: ReviewEncounter = {
  id: 'encounter-1', workId: 'work-1', materialId: 'material-1', materialRevision: 1,
  packageId: 'package', packageVersion: '1', packageRevision: 'revision',
  probeId: 'written', probeContractVersion: 1, direction: 'written', cue: '勇気',
  answer: null, source: null, requiredMedia: null, supplied: [], correction: false,
  targets: [
    { id: 'reading', label: 'Reading', mnemonic: 'r', key: null },
    { id: 'meaning', label: 'Meaning', mnemonic: 'm', key: null },
    { id: 'pitch', label: 'Pitch', mnemonic: 'p', key: null },
  ],
  conditions: { revealed: false, exposureCount: 1, assistance: [], delivery: 'not_required' },
};
declare global {
  interface Window {
    __reviewTest: {
      commands: ReviewCommand[];
      session: ReviewSession | null;
      fail: boolean;
      hold: boolean;
      release?: () => void;
    };
  }
}
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const wav = Buffer.alloc(44 + 320000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(320000, 40);
  const root = path.resolve(process.env.REVIEW_WEB_DIR ?? 'apps/client/dist');
  const contentTypes: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (pathname === '/review-audio.wav') {
        response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(wav); return;
      }
      const target = path.resolve(root, `.${path.extname(pathname) ? pathname : '/index.html'}`);
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid fixture asset path');
      const bytes = await readFile(target);
      response.writeHead(200, { 'Content-Type': contentTypes[path.extname(target)] ?? 'application/octet-stream' }); response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing Review fixture port');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function start(page: Page, dark: boolean, finite = false, audio = false, practice = false, fromHome = false) {
  page.on('pageerror', error => console.error('Review browser error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Review browser console:', message.text()); });
  // Only the native IPC boundary is mocked. Session persistence, receipts and
  // failures belong to this fixture, never to the production screen.
  await page.addInitScript(({ encounter, theme, practice }) => {
    const stored = sessionStorage.getItem('review-fixture');
    const state: Window['__reviewTest'] = {
      session: stored ? JSON.parse(stored) : practice ? {
        id: 'selected-practice', revision: 1,
        mode: { kind: 'practice', items: [{ materialId: encounter.materialId, source: null }] },
        state: 'active', completed: 0, total: 1, encounter, canUndo: false, message: null,
      } : null, commands: [], fail: false, hold: false,
    };
    const receipts = new Map<string, { revision: number }>();
    let previous: ReviewEncounter | null = null;
    let suspended: ReviewEncounter | null = null;
    const failure = (message: string) => JSON.stringify({ type: 'error', code: 'unavailable', message });
    Object.assign(window, {
      isTauri: true, __MLEARN_MEDIA_BASE__: 'http://127.0.0.1/fixture-media/', __reviewTest: state,
      // Home installs host drag listeners; this fixture supplies no drag events.
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1, unregisterCallback: () => {},
        invoke: async (hostCommand: string, args: { request?: string }) => {
          if (hostCommand === 'plugin:event|listen') return 1;
          if (hostCommand === 'plugin:event|unlisten') return;
          if (hostCommand === 'window_material_active') return false;
          if (hostCommand === 'authored_media_uri') return `${location.origin}/review-audio.wav`;
          if (hostCommand !== 'runtime_execute') throw new Error(`Unexpected host call: ${hostCommand}`);
          const request = JSON.parse(args.request ?? '');
          if (request.type === 'snapshot') return JSON.stringify({ type: 'snapshot', snapshot: {
            protocolVersion: 1, revision: 1,
            theme,
            installedPlugins: [], availablePlugins: [], codePolicy: 'desktop', catalogConfigured: true,
          } });
          if (request.type === 'review_sessions') return JSON.stringify({ type: 'review_sessions', sessions: state.session ? [state.session] : [] });
          if (request.type === 'recent_sources') return JSON.stringify({ type: 'sources', sources: [] });
          if (request.type === 'recent_documents') return JSON.stringify({ type: 'documents', sources: [] });
          if (request.type === 'review_session') return JSON.stringify({ type: 'review_session', session: state.session });
          if (request.type !== 'review') return failure(`Unexpected Review request: ${request.type}`);
          const command: ReviewCommand = request.command;
          state.commands.push(command);
          if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
          if (state.fail) { state.fail = false; return failure('Review write unavailable'); }
          const identity = command.kind === 'start' ? command.start : command.mutation;
          const receipt = receipts.get(identity.commandId);
          if (!receipt) {
            if (command.kind === 'start') state.session = {
              id: command.start.sessionId, revision: 1, mode: command.start.mode, state: 'active',
              completed: 0, total: command.start.mode.kind === 'finite' ? 3 : null, encounter: structuredClone(encounter),
              canUndo: false, message: null,
            };
            else {
              const value = state.session;
              if (!value || value.revision !== command.mutation.expectedRevision) return failure('Stale Review revision');
              if (value.state === 'paused' && command.kind !== 'pause' && command.kind !== 'resume')
                return failure('Resume Review before changing it');
              value.revision++;
              if (command.kind === 'reveal' && value.encounter) {
                value.encounter.answer = 'Courage'; value.encounter.conditions.revealed = true;
              }
              if (command.kind === 'pause') {
                value.state = 'paused';
                const conditions = value.encounter?.conditions;
                if (conditions && (conditions.delivery === 'pending' || conditions.delivery === 'started'))
                  conditions.delivery = 'interrupted';
              }
              if (command.kind === 'resume') value.state = 'active';
              if (command.kind === 'delivery' && value.encounter) value.encounter.conditions.delivery = command.delivery;
              if (command.kind === 'submit') {
                previous = value.encounter; value.encounter = null; value.completed++; value.canUndo = true;
                if (value.total !== null && value.completed === value.total) value.state = 'complete';
              }
              if (command.kind === 'next') value.encounter = { ...structuredClone(encounter), id: `encounter-${value.completed + 1}` };
              if (command.kind === 'undo') {
                suspended = value.encounter;
                if (previous) value.encounter = { ...previous, correction: true };
                value.completed--; value.state = 'active'; value.canUndo = false;
              }
              if (command.kind === 'correct') {
                value.encounter = suspended; value.completed++; value.canUndo = true;
              }
            }
            if (!state.session) return failure('Missing fixture session');
            receipts.set(identity.commandId, { revision: state.session.revision });
            sessionStorage.setItem('review-fixture', JSON.stringify(state.session));
          }
          if (command.kind === 'delivery' && command.delivery === 'started')
            console.debug('review-fixture-delivery-started');
          return JSON.stringify({ type: 'review', commit: {
            commandId: identity.commandId, committedRevision: receipts.get(identity.commandId)?.revision, session: state.session,
          } });
        },
      },
    });
  }, { encounter: audio ? { ...encounter, direction: 'audio', requiredMedia: 'authored-audio',
    conditions: { ...encounter.conditions, delivery: 'pending' } } satisfies ReviewEncounter : encounter,
    theme: dark ? builtInThemes[1] : initialTheme, practice });
  if (fromHome) {
    await page.goto(`${origin}/`);
    await page.getByTestId('home-open-review').click();
  } else await page.goto(`${origin}/review${practice ? '?sessionId=selected-practice' : ''}`);
  if (practice) {
    // Reader already admitted this native session; entering Review must only resume it.
    await expect(page.getByTestId('review-cue')).toBeVisible();
  } else if (finite) {
    const field = page.getByRole('textbox', { name: 'Finite Review limit', exact: true });
    const button = page.getByRole('button', { name: 'Start finite Review', exact: true });
    await field.fill('0'); await expect(button).toBeDisabled();
    await field.fill('129'); await expect(button).toBeDisabled();
    await field.fill('3'); await button.click();
  } else await page.getByRole('button', { name: 'Start Review', exact: true }).click();
  await expect(page.getByTestId('review-cue')).toBeVisible();
}
const submitCount = (page: Page) => page.evaluate(() => window.__reviewTest.commands.filter(command => command.kind === 'submit').length);
async function playAudio(page: Page) {
  const started = page.waitForEvent('console', {
    predicate: message => message.type() === 'debug' && message.text() === 'review-fixture-delivery-started',
  });
  await Promise.all([started, page.locator('video').evaluate(async element => {
    if (!(element instanceof HTMLVideoElement)) throw new TypeError('Expected audio player');
    await element.play();
  })]);
}

for (const playing of [false, true]) {
  test(`Back retains ${playing ? 'started' : 'ready'} Review audio until its interruption saves and preserves retry`, async ({ page }, info) => {
    await start(page, playing, false, true, false, true);
    await expect(page.getByRole('button', { name: 'Stop audio', exact: true })).toBeEnabled();
    if (playing) await playAudio(page);
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
    const before = await page.evaluate(() => window.__reviewTest.session);
    await page.evaluate(() => { window.__reviewTest.hold = true; window.__reviewTest.fail = true; });
    try {
      await page.goBack();
      await expect(page.getByText('Saving Review…', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/review(?:\?|$)/);
      await expect(page.locator('video')).toHaveCount(0);
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: info.outputPath(`back-audio-${playing ? 'started' : 'ready'}-${width}-pending.png`) });
      }
      await page.evaluate(() => { window.__reviewTest.hold = false; window.__reviewTest.release?.(); });
      const retry = page.getByRole('button', { name: 'Retry Review save', exact: true });
      await expect(retry).toBeEnabled();
      await expect(page.getByText('Review write unavailable', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/review(?:\?|$)/);
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: info.outputPath(`back-audio-${playing ? 'started' : 'ready'}-${width}-failure.png`) });
      }
      await retry.click();
      await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
      await page.goBack();
      await expect(page).toHaveURL(`${origin}/`);
      const after = await page.evaluate(() => window.__reviewTest.session);
      expect(after?.encounter?.conditions.delivery).toBe('interrupted');
      expect(after?.encounter?.id).toBe(before?.encounter?.id);
      expect(after?.completed).toBe(before?.completed);
      expect(await submitCount(page)).toBe(0);
      const terminal = await page.evaluate(() => window.__reviewTest.commands.filter(command =>
        command.kind === 'delivery' && command.delivery === 'interrupted'));
      expect(terminal).toHaveLength(2);
      expect(terminal[0]).toEqual(terminal[1]);
    } finally {
      await page.evaluate(() => { window.__reviewTest.hold = false; window.__reviewTest.release?.(); });
    }
  });
}

test('selected Word Practice opens its admitted session and resumes without starting scheduled Review', async ({ page }, info) => {
  await start(page, info.project.name.endsWith('dark'), false, false, true);
  await expect(page.getByRole('heading', { name: 'Word Practice', exact: true })).toBeVisible();
  await expect(page.getByText('0 / 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Review', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('practice-cue.png'), fullPage: true });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('review-answer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await page.getByRole('button', { name: 'Fluent', exact: true }).click();
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__reviewTest.commands.some(command => command.kind === 'start'))).toBe(false);
  const submitted = await page.evaluate(() => window.__reviewTest.commands.find(command => command.kind === 'submit'));
  expect(submitted?.mutation.sessionId).toBe('selected-practice');
  await page.screenshot({ path: info.outputPath('practice-complete.png'), fullPage: true });
});

for (const playing of [false, true]) {
  test(`Home persists interrupted ${playing ? 'started' : 'ready'} audio before removing Review`, async ({ page }, info) => {
    // Given the exact ready or playing encounter, without a learner response.
    await start(page, playing || info.project.name.endsWith('dark'), false, true);
    await expect(page.getByRole('button', { name: 'Stop audio', exact: true })).toBeEnabled();
    if (playing) {
      await playAudio(page);
      await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
    }
    const before = await page.evaluate(() => window.__reviewTest.session);
    // When Home removes the activity, without first reopening the session.
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    // Then interruption is already durable and no retrieval evidence is invented.
    const after = await page.evaluate(() => window.__reviewTest.session);
    expect(after?.encounter?.conditions.delivery).toBe('interrupted');
    expect(after?.id).toBe(before?.id);
    expect(after?.state).toBe('active');
    expect(after?.encounter?.id).toBe(before?.encounter?.id);
    expect(after?.encounter?.conditions.exposureCount).toBe(before?.encounter?.conditions.exposureCount);
    expect(after?.completed).toBe(before?.completed);
    expect(await submitCount(page)).toBe(0);
    expect(await page.evaluate(() => window.__reviewTest.commands.filter(command =>
      command.kind === 'delivery' && command.delivery === 'interrupted').length)).toBe(1);
    await expect(page.locator('video')).toHaveCount(0);
  });

  test(`Home gates ${playing ? 'started' : 'ready'} audio departure on the terminal save and preserves retry`, async ({ page }, info) => {
    // Given audio whose terminal delivery acknowledgement can be held and failed.
    await start(page, playing || info.project.name.endsWith('dark'), false, true);
    await expect(page.getByRole('button', { name: 'Stop audio', exact: true })).toBeEnabled();
    if (playing) {
      await playAudio(page);
    }
    const home = page.getByRole('button', { name: 'Home', exact: true });
    await expect(home).toBeEnabled();
    const before = await page.evaluate(() => window.__reviewTest.session);
    await page.evaluate(() => { window.__reviewTest.hold = true; window.__reviewTest.fail = true; });
    // When Home requests interruption, the held acknowledgement owns departure.
    await home.click();
    await expect(page.getByText('Saving Review…', { exact: true })).toBeVisible();
    await expect(home).toBeDisabled();
    await expect(page).toHaveURL(/\/review(?:\?|$)/);
    await expect(page.getByTestId('review-cue')).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
    expect(await page.evaluate(() => window.__reviewTest.session?.encounter?.conditions.delivery))
      .toBe(playing ? 'started' : 'pending');
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`home-audio-${playing ? 'dark' : 'light'}-${width}-pending.png`) });
    }
    await page.evaluate(() => { window.__reviewTest.hold = false; window.__reviewTest.release?.(); });
    // Then failure retains the activity and retry reuses the identical command.
    const retry = page.getByRole('button', { name: 'Retry Review save', exact: true });
    await expect(retry).toBeEnabled();
    await expect(page.getByText('Review write unavailable', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/review(?:\?|$)/);
    await expect(home).toBeDisabled();
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`home-audio-${playing ? 'dark' : 'light'}-${width}-failure.png`) });
    }
    await retry.click();
    await expect(home).toBeEnabled();
    const terminal = await page.evaluate(() => window.__reviewTest.commands.filter(command =>
      command.kind === 'delivery' && command.delivery === 'interrupted'));
    expect(terminal).toHaveLength(2);
    expect(terminal[0]).toEqual(terminal[1]);
    await home.click();
    await expect(page).toHaveURL(`${origin}/`);
    const after = await page.evaluate(() => window.__reviewTest.session);
    expect(after?.encounter?.conditions.delivery).toBe('interrupted');
    expect(after?.encounter?.id).toBe(before?.encounter?.id);
    expect(after?.encounter?.conditions.exposureCount).toBe(before?.encounter?.conditions.exposureCount);
    expect(after?.completed).toBe(before?.completed);
    expect(await submitCount(page)).toBe(0);
    expect(await page.evaluate(() => window.__reviewTest.commands.filter(command =>
      command.kind === 'delivery' && command.delivery === 'interrupted'))).toEqual(terminal);
  });

  test(`session Pause interrupts ${playing ? 'started' : 'ready'} audio and leaves Resume usable`, async ({ page }, info) => {
    await start(page, info.project.name.endsWith('dark'), false, true);
    await expect(page.getByRole('button', { name: 'Stop audio', exact: true })).toBeVisible();
    if (playing) {
      await playAudio(page);
    }
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(pause).toBeEnabled();
    await pause.click();
    const resume = page.getByRole('button', { name: 'Resume', exact: true });
    await expect(resume).toBeEnabled();
    await resume.click();
    await expect(page.getByText('Audio playback interrupted.', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry Review save', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.__reviewTest.session?.encounter?.conditions.delivery)).toBe('interrupted');
    await page.screenshot({ path: info.outputPath(`audio-${playing ? 'started' : 'ready'}-resumed.png`), fullPage: true });
  });
}

test('Close Adjust retains explicit Missed and Untested when rating from the collapsed controls', async ({ page }, info) => {
  await start(page, info.project.name.endsWith('dark'));
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByRole('button', { name: 'Reading: Missed', exact: true }).click();
  await page.getByRole('button', { name: 'Pitch: Untested', exact: true }).click();
  await page.getByRole('button', { name: 'Close Adjust', exact: true }).click();
  await page.getByRole('button', { name: 'Fluent', exact: true }).click();
  await expect(page.getByTestId('review-answer')).toHaveCount(0);
  const submission = await page.evaluate(() => window.__reviewTest.commands.find(command => command.kind === 'submit'));
  expect(submission?.response.grades).toEqual([
    { targetId: 'reading', quality: 'missed', method: 'remembered', easy: false },
    { targetId: 'meaning', quality: 'fluent', method: 'remembered', easy: false },
    { targetId: 'pitch', quality: null, method: 'remembered', easy: false },
  ]);
});

test('unavailable native host keeps Home recovery reachable from the direct Review route', async ({ page }) => {
  await page.goto(`${origin}/review`);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
});

test('explicit finite membership stays visible and completes only after its admitted work', async ({ page }, info) => {
  await start(page, info.project.name.endsWith('dark'), true);
  await expect(page.getByText('0 / 3', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__reviewTest.commands.find(command => command.kind === 'start')?.start.mode))
    .toEqual({ kind: 'finite', limit: 3 });
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await page.getByRole('button', { name: 'Fluent', exact: true }).click();
  }
  await expect(page.getByText('Review complete', { exact: true })).toBeVisible();
  await expect(page.getByText('3 / 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
});

test('Reveal is durable, and text, IME, selection, modal and held keys retain input ownership', async ({ page }, info) => {
  await start(page, info.project.name.endsWith('dark'));
  await expect(page.getByTestId('review-answer')).toHaveCount(0);
  await page.keyboard.press('1');
  expect(await submitCount(page)).toBe(0);
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.getByTestId('review-answer')).toHaveText('Courage');
  // Content badges must follow the accepted theme just like other content.
  // This protects the asynchronous light-to-dark startup subscription boundary.
  const foreground = await page.getByTestId('review-answer').evaluate(node => getComputedStyle(node).color);
  await expect(page.getByText('Reading', { exact: true })).toHaveCSS('color', foreground);
  await page.screenshot({ path: info.outputPath('revealed.png'), fullPage: true });
  await page.evaluate(() => {
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true, bubbles: true, cancelable: true }));
    const input = document.createElement('input'); input.id = 'unrelated-input'; document.body.append(input); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
    const editable = document.createElement('div'); editable.contentEditable = 'true'; editable.id = 'unrelated-editable';
    document.body.append(editable); editable.focus();
    editable.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
    editable.remove(); input.remove();
    const answer = document.querySelector('[data-testid="review-answer"]');
    if (!answer) throw new Error('Missing revealed answer');
    const selection = document.getSelection(); const range = document.createRange(); range.selectNodeContents(answer);
    selection?.removeAllRanges(); selection?.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
    selection?.removeAllRanges();
    const dialog = document.createElement('div'); dialog.setAttribute('aria-modal', 'true'); document.body.append(dialog);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true, cancelable: true }));
    dialog.remove();
  });
  expect(await submitCount(page)).toBe(0);
  await page.keyboard.press('3');
  await expect(page.getByTestId('review-answer')).toHaveCount(0);
  expect(await submitCount(page)).toBe(1);
});

test('Adjust preserves exceptions and untested outcomes; failed saves retry identity and Undo corrects the original attempt', async ({ page }, info) => {
  await start(page, info.project.name.endsWith('dark'));
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByRole('button', { name: 'Reading: Missed', exact: true }).click();
  await page.getByRole('button', { name: 'Pitch: Untested', exact: true }).click();
  await page.screenshot({ path: info.outputPath('adjust.png'), fullPage: true });
  await page.evaluate(() => { window.__reviewTest.fail = true; });
  await page.keyboard.press('4'); await page.keyboard.press('4');
  await expect(page.getByRole('alert')).toHaveText('Review write unavailable');
  await page.screenshot({ path: info.outputPath('failed-save.png'), fullPage: true });
  await page.getByRole('button', { name: 'Retry Review save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reveal', exact: true })).toBeVisible();
  const submissions = await page.evaluate(() => window.__reviewTest.commands.filter(command => command.kind === 'submit'));
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  expect(submissions[0].response.grades).toEqual([
    { targetId: 'reading', quality: 'missed', method: 'remembered', easy: false },
    { targetId: 'meaning', quality: 'fluent', method: 'remembered', easy: true },
    { targetId: 'pitch', quality: null, method: 'remembered', easy: false },
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('review-answer')).toHaveText('Courage');
  await page.getByRole('button', { name: 'Struggled', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reveal', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__reviewTest.commands.filter(command => command.kind === 'correct').length)).toBe(1);
});

test('pending writes do not show committed answers; pause and restart preserve exact exposure', async ({ page }, info) => {
  await start(page, info.project.name.endsWith('dark'));
  await page.screenshot({ path: info.outputPath('cue.png'), fullPage: true });
  await page.evaluate(() => { window.__reviewTest.hold = true; });
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.getByText('Saving Review…', { exact: true })).toBeVisible();
  await expect(page.getByTestId('review-answer')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('pending-save.png'), fullPage: true });
  await page.evaluate(() => { window.__reviewTest.hold = false; window.__reviewTest.release?.(); });
  await expect(page.getByTestId('review-answer')).toHaveText('Courage');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Review paused', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('paused.png'), fullPage: true });
  await page.reload();
  await expect(page.getByText('Review paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('review-answer')).toHaveText('Courage');
  expect(await page.evaluate(() => window.__reviewTest.commands.some(command => command.kind === 'reveal'))).toBe(false);
  const bounds = await page.getByTestId('review-cue').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.width).toBeLessThanOrEqual(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
