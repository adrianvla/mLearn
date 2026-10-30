/// <reference types="node" />
import { test, expect, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

async function installEnglish(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
  await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
  await page.getByRole('button', { name: /^Install .*English/ }).click();
  await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
}

function requestOf(payload: { args?: { request?: string } }) {
  return payload.args?.request ? JSON.parse(payload.args.request) : null;
}

for (const width of [390, 1080]) test(`Reader Back retains failed checkpoint recovery and the prior Material draft at ${width}`, async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('profile') });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  let rejectCheckpoints = true;
  try {
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const document = await client.openDocument(resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
    const original = document.source.appearance.fontSize;
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Material', exact: true }).click();
    const draft = 'Unsubmitted Material search before Reader Back';
    await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill(draft);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: `Continue ${document.source.title}`, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
    const isCheckpoint = (request: Request) => request.url() === `${backend.url}/invoke`
      && request.method() === 'POST'
      && requestOf(request.postDataJSON())?.type === 'checkpoint_document'
      && requestOf(request.postDataJSON())?.checkpoint.sourceId === document.source.id;
    await page.route(`${backend.url}/invoke`, async route => {
      if (rejectCheckpoints && isCheckpoint(route.request())) await route.abort('failed');
      else await route.continue();
    });
    const appearanceFailed = page.waitForEvent('requestfailed', { predicate: isCheckpoint });
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('button', { name: 'Larger text', exact: true }).click();
    await appearanceFailed;
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Retry saving position', exact: true });
    await expect(retry).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/reader\\?id=${document.source.id}`));
    await expect(retry).toBeVisible();
    expect((await client.resumeDocument(document.source.id)).source.appearance.fontSize).toBe(original);
    await page.screenshot({ path: info.outputPath(`reader-back-failure-${width}.png`) });

    rejectCheckpoints = false;
    const persisted = page.waitForResponse(response => isCheckpoint(response.request()));
    await retry.click();
    await (await persisted).finished();
    await expect(retry).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Material', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search Material', exact: true })).toHaveValue(draft);
    await backend.crashRestart();
    expect((await client.resumeDocument(document.source.id)).source.appearance.fontSize).toBe(original + 2);
    await page.screenshot({ path: info.outputPath(`reader-back-material-restored-${width}.png`) });
  } finally {
    rejectCheckpoints = false;
    try { await page.unroute(`${backend.url}/invoke`); }
    finally { await backend.close(); }
  }
});

test('Reader keeps failed checkpoint recovery before saved-Material departure', async ({ page }, info) => {
  test.setTimeout(90_000);
  const profile = info.outputPath('profile');
  await mkdir(profile, { recursive: true });
  const backend = await startRuntimeBrowserQa({ profile });
  let rejectCheckpoints = true;
  let failedCheckpoints = 0;
  try {
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const client = createRuntimeClient({
      commandId: randomUUID,
      execute: request => backend.invoke('runtime_execute', { request }),
    });
    const document = await client.openDocument(resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
    const original = document.source.appearance.fontSize;
    const isCheckpoint = (request: Request) => request.url() === `${backend.url}/invoke`
      && request.method() === 'POST'
      && requestOf(request.postDataJSON())?.type === 'checkpoint_document'
      && requestOf(request.postDataJSON())?.checkpoint.sourceId === document.source.id;
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/reader?id=${encodeURIComponent(document.source.id)}`);
    await expect(page.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
    await page.route(`${backend.url}/invoke`, async route => {
      if (rejectCheckpoints && isCheckpoint(route.request())) {
        failedCheckpoints += 1;
        await route.abort('failed');
      } else await route.continue();
    });

    // A real appearance change is dirty while native checkpoints are unavailable.
    const appearanceFailed = page.waitForEvent('requestfailed', { predicate: isCheckpoint });
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('button', { name: 'Larger text', exact: true }).click();
    await appearanceFailed;
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry saving position', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
    const inspector = page.getByTestId('inspector-panel');
    await inspector.getByRole('button', { name: 'Capture Children', exact: true }).click();
    const saved = inspector.getByRole('button', { name: 'Open saved Children: revision 1', exact: true });
    await expect(saved).toBeVisible();
    const departureFailed = page.waitForEvent('requestfailed', { predicate: isCheckpoint });
    await saved.click();
    await departureFailed;
    const sourceAfterFailure = (await client.resumeDocument(document.source.id)).source;
    await writeFile(info.outputPath('reader-material-departure-failure.json'), JSON.stringify({
      sourceId: document.source.id, originalFontSize: original, wantedFontSize: original + 2,
      sourceAfterFailure, failedCheckpoints, url: page.url(), inspectorVisible: await inspector.isVisible(),
    }));
    await page.screenshot({ path: info.outputPath('reader-material-departure-failure-390.png') });
    await expect(page).toHaveURL(new RegExp(`/reader\\?id=${document.source.id}`));
    await expect(inspector.getByRole('alert')).toBeVisible();
    expect(sourceAfterFailure.appearance.fontSize).toBe(original);

    // Explicit recovery saves the same dirty source before departure is retried.
    rejectCheckpoints = false;
    await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    const persisted = page.waitForResponse(response => isCheckpoint(response.request()));
    await page.getByRole('button', { name: 'Retry saving position', exact: true }).click();
    await (await persisted).finished();
    await expect(page.getByRole('button', { name: 'Retry saving position', exact: true })).toHaveCount(0);
    expect((await client.resumeDocument(document.source.id)).source.appearance.fontSize).toBe(original + 2);
    await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
    await inspector.getByRole('button', { name: 'Capture options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open saved Children', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Phrase', exact: true })).toHaveValue('Children');
    expect(new URL(page.url()).searchParams.get('sourceId')).toBe(document.source.id);
    await page.screenshot({ path: info.outputPath('reader-material-departure-recovered-390.png') });
  } finally {
    rejectCheckpoints = false;
    await page.unroute(`${backend.url}/invoke`);
    await backend.close();
  }
});

test('Reader search opens the actual source span and returns to the saved reading position after native restart', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/reader-search-return-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const document = await client.openDocument(resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
    await page.goto(`/reader?id=${document.source.id}`);
    await expect(page.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save position', exact: true }).click();
    const original = (await client.resumeDocument(document.source.id)).source.position;
    expect(original).not.toBeNull();
    const opener = page.getByRole('button', { name: 'Search source', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Search source', exact: true });
    await dialog.getByRole('textbox', { name: 'Search this source', exact: true }).fill('bridge');
    const searched = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
      && requestOf(response.request().postDataJSON())?.type === 'search_document');
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    const result = JSON.parse((await (await searched).json()).value);
    expect(result.type).toBe('document_search');
    expect(result.page.hits).toHaveLength(1);
    const hit = result.page.hits[0];
    expect(hit.position.offset).toBe(10);
    expect(hit.anchor.text).toBe('The small bridge is quiet.');
    expect(hit.anchor.locator).toMatchObject({ kind: 'document', selectionStart: 10, selectionEnd: 16 });
    await page.screenshot({ path: info.outputPath('reader-search-results-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('reader-search-results-phone.png') });
    const returned = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
      && requestOf(response.request().postDataJSON())?.type === 'return_source_anchor');
    await dialog.getByRole('button', { name: hit.anchor.text, exact: true }).click();
    expect(JSON.parse((await (await returned).json()).value)).toMatchObject({
      type: 'document_material_source', anchor: hit.anchor, window: { source: { position: hit.position } },
    });
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await page.getByRole('button', { name: 'Save position', exact: true }).click();
    // Reading checkpoints describe the first visible source byte, not the
    // selected word. This short unwrapped line starts at byte0.
    expect((await client.resumeDocument(document.source.id)).source.position).toEqual({ ...hit.position, offset: 0 });
    await backend.crashRestart();
    await opener.click();
    await dialog.getByRole('button', { name: 'Return to reading position', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Save position', exact: true }).click();
    expect((await client.resumeDocument(document.source.id)).source.position).toEqual(original);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
    expect((await client.materials({ after: null, sourceId: null, includeExcluded: true, query: '' })).items).toEqual([]);
    expect(backend.metadata().providerRequests).toBe(0);
  } finally { await backend.close(); }
});

test('Reader search pages native Unicode matches without loading or dropping the rest of the source', async ({ page }) => {
  const profile = `${process.env.RUN_TMP ?? '.mlearn/m10'}/reader-search-pages-${randomUUID()}`;
  await mkdir(profile, { recursive: true });
  const path = resolve(profile, 'search.txt');
  await writeFile(path, Array.from({ length: 40 }, (_, index) => `🌱 東京 passage ${index}`).join('\n\n'));
  const backend = await startRuntimeBrowserQa({ profile });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const document = await client.openDocument(path, 'org.mlearn.english');
    await page.goto(`/reader?id=${document.source.id}`);
    await expect(page.getByTestId('reader-document-ready')).toBeVisible();
    await page.getByRole('button', { name: 'Search source', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search source', exact: true });
    await dialog.getByRole('textbox', { name: 'Search this source', exact: true }).fill('東京');
    for (const [start, count] of [[0, 16], [16, 16], [32, 8]]) {
      const searched = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
        && requestOf(response.request().postDataJSON())?.type === 'search_document');
      await dialog.getByRole('button', { name: start ? 'More search results' : 'Search', exact: true }).click();
      const result = JSON.parse((await (await searched).json()).value);
      expect(result.page.hits).toHaveLength(count);
      expect(result.page.hits.map((hit: { position: { offset: number } }) => hit.position.offset)).toEqual(Array(count).fill(5));
      await expect(dialog.getByRole('button', { name: new RegExp(`^🌱 東京 passage ${start}$`) })).toBeVisible();
      await expect(dialog.getByRole('button', { name: /^🌱 東京 passage \d+$/ })).toHaveCount(count);
    }
    await expect(dialog.getByRole('button', { name: 'More search results', exact: true })).toBeDisabled();
    expect(backend.metadata().providerRequests).toBe(0);
  } finally { await backend.close(); }
});

test('stopping a held Reader search rejects its late page and a failed search retries after native restart', async ({ page }) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/reader-search-stop-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  let release: (() => void) | undefined;
  try {
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const document = await client.openDocument(resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
    await page.goto(`/reader?id=${document.source.id}`);
    await expect(page.getByTestId('reader-document-ready')).toBeVisible();
    let entered: () => void = () => {};
    let finished: () => void = () => {};
    const held = new Promise<void>(resolve => { entered = resolve; });
    const done = new Promise<void>(resolve => { finished = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let heldOnce = false;
    let failOnce = true;
    await page.route(`${backend.url}/invoke`, async route => {
      const request = requestOf(route.request().postDataJSON());
      if (request?.type !== 'search_document') { await route.continue(); return; }
      if (request.query.text === 'Children' && !heldOnce) {
        heldOnce = true;
        const response = await route.fetch();
        await response.body();
        entered();
        await gate;
        await route.fulfill({ response }); finished(); return;
      }
      if (request.query.text === 'absent' && failOnce) { failOnce = false; await route.abort('failed'); return; }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Search source', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search source', exact: true });
    const query = dialog.getByRole('textbox', { name: 'Search this source', exact: true });
    await query.fill('Children');
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    await held;
    await dialog.getByRole('button', { name: 'Stop search', exact: true }).click();
    await query.fill('bridge');
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'The small bridge is quiet.', exact: true })).toBeVisible();
    release?.(); await done;
    await expect(dialog.getByRole('button', { name: 'Children walked home.', exact: true })).toHaveCount(0);
    await expect(query).toHaveValue('bridge');
    await query.fill('absent');
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible();
    await backend.crashRestart();
    await dialog.getByRole('button', { name: 'Retry search', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'More search results', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
  } finally {
    release?.();
    await page.unrouteAll({ behavior: 'wait' });
    await backend.close();
  }
});
