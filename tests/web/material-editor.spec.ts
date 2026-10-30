/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CollectionQuery, Material, MaterialEdit, SourceAnchor, SourceWindow } from '@mlearn/contracts';
import { initialTheme } from '../../packages/theme/src/theme';

// Exercise the exported app, real shared controls and RuntimeClient. Only the
// unavailable native IPC boundary is substituted; no screen state is mocked.
const anchor: SourceAnchor = {
  sourceId: 'source', contentRevision: 'media', packageId: 'package', packageVersion: '1', text: 'First',
  locator: { kind: 'video', subtitleRevision: 'subtitles', cueIndex: 0, selectionStart: 0, selectionEnd: 5,
    positionMs: 1000, subtitleOffsetMs: 0, playbackRate: 1 },
};
const materials: Material[] = ['First', 'Second'].map((phrase, index) => ({
  id: `material-${index}`, revision: 1, excluded: false, media: [],
  content: { packageId: 'package', targetId: null, packageRevision: null, sense: null, phrase,
    reading: '', meaning: 'Meaning', context: '', notes: '', examples: [], source: anchor, attachments: [] },
}));
const sourceWindow: SourceWindow = {
  source: { id: 'source', title: 'Source', mediaPath: 'fixture.mp4', mediaRevision: 'media',
    subtitlePath: 'fixture.srt', subtitleRevision: 'subtitles', packageId: 'package', packageVersion: '1',
    positionMs: 1000, durationMs: 10_000, subtitleOffsetMs: 0, subtitleOffsetRevision: 0,
    playbackRate: 1, inspectionTrigger: 'click' },
  cues: [], totalCues: 0,
};
declare global {
  interface Window {
    __materialTest: {
      requests: { type: string; id?: string; query?: Pick<CollectionQuery, 'surface'> }[];
      failOpen: boolean;
      failReturn: boolean;
      failList: boolean;
      failPreview: boolean;
      commands: MaterialEdit[];
      holdOpen: boolean;
      releaseOpen?: () => void;
    };
  }
}
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const root = path.resolve(process.env.MATERIAL_WEB_DIR ?? 'apps/client/dist');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const target = path.resolve(root, `.${path.extname(pathname) ? pathname : '/index.html'}`);
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid fixture asset path');
      const bytes = await readFile(target);
      response.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream' });
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing isolated fixture port');
  origin = `http://127.0.0.1:${address.port}`;
  console.log(`Material fixture server: ${origin}; export: ${root}`);
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  console.log(`Material fixture teardown: ${origin} closed; Playwright owns disposable browser contexts.`);
});

async function start(page: Page, selected = '', failOpen = false, withMedia = false, audio = false) {
  const items: Material[] = withMedia ? materials.map((material, index) => index === 0 ? {
    ...material,
    media: [{ id: 'preview-image', kind: 'image', name: 'preview.gif', mimeType: 'image/gif', byteLength: 42 }],
    content: { ...material.content, attachments: [{ mediaId: 'preview-image', segment: null }] },
  } : material) : materials;
  await page.addInitScript(({ materials, theme, anchor, sourceWindow, failOpen, audio }) => {
    if (audio) {
      materials[0].media = [{ id: 'audio', kind: 'audio', name: 'word.wav', mimeType: 'audio/wav', byteLength: 128 }];
      materials[0].content.attachments = [{ mediaId: 'audio', segment: null }];
    }
    const state: Window['__materialTest'] = {
      requests: [], commands: [], failOpen, failReturn: false, failList: false, failPreview: false, holdOpen: false,
    };
    Object.assign(window, {
      isTauri: true, __MLEARN_MEDIA_BASE__: 'http://127.0.0.1/fixture-media/',
      __materialTest: state,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string, args: { request?: string }) => {
          if (command === 'plugin:event|listen') return 1;
          if (command === 'window_material_active') return false;
          if (command === 'authored_media_uri') {
            if (state.failPreview) throw new Error('Preview unavailable');
            return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          }
          if (command !== 'runtime_execute') throw new Error(`Unexpected host call: ${command}`);
          const request: { type: string; id?: string; command?: MaterialEdit } = JSON.parse(args.request ?? '');
          state.requests.push(request);
          const failure = (message: string) => JSON.stringify({ type: 'error', code: 'unavailable', message });
          switch (request.type) {
            case 'snapshot': return JSON.stringify({ type: 'snapshot', snapshot: {
              protocolVersion: 1, revision: 1, theme, installedPlugins: [
                { id: 'package', version: '1', displayName: 'Fixture language', capabilities: ['text.analyze.v1'] },
              ], availablePlugins: [], codePolicy: 'desktop', catalogConfigured: true,
            } });
            case 'collection':
            case 'refresh_material_collection':
              if (state.failList) { state.failList = false; return failure('List unavailable'); }
              return JSON.stringify({ type: 'collection', result: { state: 'ready', page: {
                items: materials.map(material => ({ kind: 'material', material, target: null, knowledge: [] })),
                count: materials.length, next: null, previous: null, packageRevision: null, knowledgeRevision: 0, materialRevision: 1,
              } } });
            case 'material':
              if (state.holdOpen) await new Promise<void>(resolve => { state.releaseOpen = resolve; });
              if (state.failOpen) { state.failOpen = false; return failure('Open unavailable'); }
              return JSON.stringify({ type: 'material', material: materials.find(item => item.id === request.id) });
            case 'update_material': {
              const command = request.command;
              if (!command) throw new Error('Missing authored edit');
              state.commands.push(command);
              const existing = materials.find(item => item.id === command.id);
              if (!existing) throw new Error('Missing authored item');
              const saved = { ...existing, content: command.content, excluded: command.excluded,
                revision: command.expectedRevision + 1 };
              materials.splice(materials.indexOf(existing), 1, saved);
              return JSON.stringify({ type: 'material_written', outcome: {
                status: 'saved', material: saved, committedRevision: saved.revision, reused: false,
              } });
            }
            case 'return_material_source':
              if (state.failReturn) { state.failReturn = false; return failure('Source unavailable'); }
              return JSON.stringify({ type: 'material_source', window: sourceWindow, anchor });
            default: return failure(`Unimplemented fixture action: ${request.type}`);
          }
        },
      },
    });
  }, { materials: items, theme: initialTheme, anchor, sourceWindow, failOpen, audio });
  await page.goto(`${origin}/materials${selected}`);
  await expect(page.getByRole('button', { name: 'Edit First', exact: true, includeHidden: true })).toBeAttached();
}

test('failed preview retries in the same editor without losing authored fields', async ({ page }) => {
  await start(page, '', false, true);
  await page.getByRole('button', { name: 'Edit First', exact: true }).click();
  await page.getByTestId('material-notes').fill('Keep this draft');
  await page.evaluate(() => { window.__materialTest.failPreview = true; });
  const preview = page.getByRole('button', { name: 'Preview preview.gif', exact: true });
  await preview.click();
  await expect(page.getByRole('alert')).toHaveText('Preview unavailable');
  await page.evaluate(() => { window.__materialTest.failPreview = false; });
  await preview.click();
  const image = page.getByRole('img', { name: 'preview.gif', exact: true });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty('naturalWidth', 1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('material-notes')).toHaveValue('Keep this draft');
});

test('audio binding requires explicit authoring and phrase edits revoke it', async ({ page }, testInfo) => {
  // Given a historical unbound audio attachment in the real Material editor.
  await start(page, '', false, false, true);
  await page.getByRole('button', { name: 'Edit First', exact: true }).click();
  const bind = page.getByRole('button', { name: 'Use word.wav for listening', exact: true });
  await expect(bind).toHaveAttribute('aria-pressed', 'false');
  await bind.click();
  await expect(bind).toHaveAttribute('aria-pressed', 'true');
  // When the authored phrase changes, its previous listening assertion expires.
  await page.getByTestId('material-phrase').fill('Different phrase');
  await expect(bind).toHaveAttribute('aria-pressed', 'false');
  await bind.click();
  await page.screenshot({ path: testInfo.outputPath('explicit-audio-binding.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  // Then the durable command contains only the newly affirmed target snapshot.
  await expect(page.getByTestId('material-result')).toBeVisible();
  const commands = await page.evaluate(() => window.__materialTest.commands);
  expect(commands).toHaveLength(1);
  expect(commands[0].content.attachments[0].audioBinding).toEqual({
    packageId: 'package', targetId: null, phrase: 'Different phrase',
  });
  await expect(bind).toHaveAttribute('aria-pressed', 'true');
});

for (const trigger of ['Add Material', 'Edit Second']) {
  test(`editor takes non-input focus and restores exact ${trigger} trigger`, async ({ page }) => {
    // Given a real list and a keyboard-focused authoring trigger.
    await start(page);
    const button = page.getByRole('button', { name: trigger, exact: true });
    await button.focus();
    // When keyboard activation opens the editor, then its heading owns focus.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: trigger === 'Add Material' ? 'Add Material' : 'Edit Material', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close editor', exact: true })).toBeFocused();
    // When the focused Close control unmounts, then the exact trigger regains focus.
    await page.keyboard.press('Enter');
    await expect(button).toBeFocused();
    await expect(page.getByTestId('material-phrase')).toHaveCount(0);
  });
}

test('failed opening retries that record without discarding the existing draft or list', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Edit First', exact: true }).click();
  await page.getByTestId('material-notes').fill('Unsaved notes');
  await page.evaluate(() => { window.__materialTest.failOpen = true; });
  await page.getByRole('button', { name: 'Next Material', exact: true }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Open unavailable');
  await expect(page.getByTestId('material-notes')).toHaveValue('Unsaved notes');
  await expect(page.getByTestId('material-card-material-0')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Retry Material list', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry opening Material', exact: true }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByTestId('material-phrase')).toHaveValue('Second');
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item => item.type === 'material').map(item => item.id)))
    .toEqual(['material-0', 'material-1', 'material-1']);
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item => item.type === 'collection').length)).toBe(1);
});

test('editor source retry is beside its action and preserves fields until real navigation', async ({ page }, testInfo) => {
  await start(page);
  await page.getByRole('button', { name: 'Edit Second', exact: true }).click();
  await page.getByTestId('material-notes').fill('Keep these notes');
  await page.evaluate(() => { window.__materialTest.failReturn = true; });
  await page.getByRole('button', { name: 'Return to source', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Source unavailable');
  await expect(page.getByTestId('material-notes')).toHaveValue('Keep these notes');
  const retry = page.getByRole('button', { name: 'Retry returning to source', exact: true });
  const retryBox = await retry.boundingBox();
  const fieldBox = await page.getByTestId('material-phrase').boundingBox();
  expect(retryBox && fieldBox && retryBox.y < fieldBox.y).toBe(true);
  await retry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('editor-source-recovery.png') });
  await expect(page.getByRole('button', { name: 'Retry Material list', exact: true })).toHaveCount(0);
  const navigated = page.waitForURL(url => url.pathname === '/watch');
  await retry.click();
  await navigated;
  expect(new URL(page.url()).searchParams.get('materialId')).toBe('material-1');
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item => item.type === 'return_material_source').map(item => item.id)))
    .toEqual(['material-1', 'material-1']);
});

test('list recovery preserves an open draft and repeats only the list request', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Edit First', exact: true }).click();
  await page.getByTestId('material-notes').fill('Draft survives list recovery');
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await page.evaluate(() => { window.__materialTest.failList = true; });
  await page.getByRole('button', { name: 'Material', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('List unavailable');
  await expect(page.getByTestId('material-card-material-1')).toBeAttached();
  await page.getByRole('button', { name: 'Retry Material list', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('material-notes')).toHaveValue('Draft survives list recovery');
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item =>
    item.type === 'collection' && item.query?.surface === 'material').length)).toBe(3);
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item =>
    item.type === 'collection' && item.query?.surface === 'knowledge').length)).toBe(1);
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item => item.type === 'material').length)).toBe(1);
});

test('closing while another record opens rejects its late editor publication', async ({ page }) => {
  await start(page);
  const first = page.getByRole('button', { name: 'Edit First', exact: true });
  await first.click();
  await page.evaluate(() => { window.__materialTest.holdOpen = true; });
  await page.getByRole('button', { name: 'Next Material', exact: true }).click();
  await page.waitForFunction(() => !!window.__materialTest.releaseOpen);
  await expect(page.getByText('Opening Material…', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading Material…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search Material', exact: true, includeHidden: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(first).toBeFocused();
  await page.evaluate(() => { window.__materialTest.holdOpen = false; window.__materialTest.releaseOpen?.(); });
  // A following scoped read runs behind the held open in the real client queue.
  await page.getByRole('button', { name: 'Refresh Material', exact: true }).click();
  await expect(page.getByText('Loading Material…', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('material-phrase')).toHaveCount(0);
});

test('direct-entry switching keeps the current item and saved label across Knowledge navigation', async ({ page }) => {
  await start(page, '?id=material-0');
  await expect(page.getByTestId('material-phrase')).toHaveValue('First');
  await page.getByRole('button', { name: 'Next Material', exact: true }).click();
  await expect(page.getByTestId('material-phrase')).toHaveValue('Second');
  await page.getByTestId('material-phrase').fill('Second renamed');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^Current Material selection:/ })).toHaveText('Second renamed');
  await page.getByTestId('material-notes').fill('Retained current-item draft');
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('button', { name: 'Material', exact: true }).click();
  await expect(page.getByTestId('material-phrase')).toHaveValue('Second renamed');
  await expect(page.getByTestId('material-notes')).toHaveValue('Retained current-item draft');
  await expect(page.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0);
});

test('a long Material label keeps switching controls compact and keyboard accessible', async ({ page }, info) => {
  await start(page);
  await page.getByRole('button', { name: 'Edit First', exact: true }).click();
  const phrase = 'A long Material title '.repeat(24).trim();
  await page.getByTestId('material-phrase').fill(phrase);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const selected = page.getByRole('combobox', { name: /^Current Material selection:/ });
  await expect(selected).toHaveText(phrase);
  for (const width of [1080, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await selected.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`material-long-selection-${width}.png`) });
    const bounds = await selected.boundingBox();
    const dialog = await page.getByRole('dialog', { name: 'Edit Material', exact: true }).boundingBox();
    if (!bounds || !dialog) throw new Error('Material switcher has no visible bounds');
    expect(bounds.height, 'A selection label must not displace the editing workflow').toBeLessThan(900 / 4);
    expect(bounds.x).toBeGreaterThanOrEqual(dialog.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(dialog.x + dialog.width);
  }
  await selected.focus();
  await selected.press('Space');
  await page.getByRole('option', { name: 'Second', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('material-phrase')).toHaveValue('Second');
});

test('direct-route open failure leaves the list available and retries the selected record', async ({ page }) => {
  await start(page, '?id=material-1', true);
  await expect(page.getByRole('alert')).toHaveText('Open unavailable');
  await expect(page.getByRole('button', { name: 'Edit First', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry opening Material', exact: true }).click();
  await expect(page.getByTestId('material-phrase')).toHaveValue('Second');
  await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item => item.type === 'material').map(item => item.id)))
    .toEqual(['material-1', 'material-1']);
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item => item.type === 'collection').length)).toBe(1);
});

test('list source retry repeats the initiating record rather than reloading the list', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { window.__materialTest.failReturn = true; });
  await page.getByRole('button', { name: 'Return to source: Second', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Source unavailable');
  const navigated = page.waitForURL(url => url.pathname === '/watch');
  await page.getByRole('button', { name: 'Retry returning to source', exact: true }).click();
  await navigated;
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item => item.type === 'return_material_source').map(item => item.id)))
    .toEqual(['material-1', 'material-1']);
  expect(await page.evaluate(() => window.__materialTest.requests.filter(item => item.type === 'collection').length)).toBe(1);
});
