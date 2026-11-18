import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { test, expect, installPackage, execute } from './fixture';

// PLAN M03 Review: capture a word/context and segment, edit it, repeat the capture without
// accidental duplication, inspect the saved source and reopen it. Fail one bulk item and retry
// without repeating successful writes.
test('M03 capture to Material and back to the exact source', async ({ page, nativeCore }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-m03-'));
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  try {
    const video = path.join(directory, 'River walk.webm');
    await copyFile(path.join(homedir(), 'mlearn-test-corpus', 'HERO_-_Blender_Open_Movie-full_movie.webm'), video);
    await writeFile(path.join(directory, 'River walk.srt'), '1\n00:00:00,000 --> 00:00:30,000\nThe children walked home along the river.\n');
    await installPackage(page);
    const opened = await execute(nativeCore, { type: 'open_source', path: video, packageId: 'org.mlearn.english' });
    const sourceId = opened.window.source.id;
    await execute(nativeCore, { type: 'attach_subtitles', sourceId, path: path.join(directory, 'River walk.srt') });
    await page.goto('/');
    await page.getByRole('button', { name: `Continue ${opened.window.source.title}`, exact: true }).click();
    const subtitles = page.getByTestId('subtitle-window');
    const inspector = page.getByTestId('inspector-panel');

    // Capture a word with its context from the Inspector.
    await subtitles.getByRole('button', { name: /^children: / }).click();
    await inspector.getByRole('button', { name: 'Capture children', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Open saved children: revision 1', exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: /^Close Inspect/ }).click();

    // Repeating the word capture offers the saved item instead of a second one.
    await subtitles.getByRole('button', { name: /^children: / }).click();
    await expect(inspector.getByRole('button', { name: 'Capture children', exact: true })).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: 'Capture this context: children', exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Inspector actions', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Open saved children', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await inspector.getByRole('button', { name: /^Close Inspect/ }).click();

    // Capture the whole subtitle segment, then capture it again: a duplicate is resolved explicitly.
    for (const attempt of [1, 2]) {
      await page.getByRole('button', { name: 'Capture subtitle', exact: true }).click();
      const capture = page.getByRole('dialog', { name: 'Capture source', exact: true });
      await expect(capture.getByTestId('material-phrase')).toHaveValue('The children walked home along the river.');
      await capture.getByRole('button', { name: 'Save Material', exact: true }).click();
      if (attempt === 2) {
        await expect(capture.getByTestId('material-duplicates')).toBeVisible();
        await page.screenshot({ path: info.outputPath('m03-duplicate.png') });
        await capture.getByRole('button', { name: /^Use existing: The children walked home/ }).click();
      }
      await expect(capture.getByRole('button', { name: 'Save Material', exact: true })).toHaveCount(0, { timeout: 20_000 });
      await capture.getByRole('button', { name: 'Close', exact: true }).click();
    }
    const segments = await client.materials({ after: null, query: 'The children walked home', sourceId: null, includeExcluded: true });
    expect(segments.items.filter(item => item.content.phrase === 'The children walked home along the river.')).toHaveLength(1);

    // Edit the captured word, then return to the exact source occurrence.
    await subtitles.getByRole('button', { name: /^children: / }).click();
    await inspector.getByRole('button', { name: 'Inspector actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open saved children', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
    await page.getByTestId('material-notes').fill('Plural of child.');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Return to source', exact: true }).click();
    await expect(page.getByTestId('returned-source-selection')).toContainText('children');
    await page.screenshot({ path: info.outputPath('m03-returned.png') });
    await inspector.getByRole('button', { name: /^Close Inspect/ }).click();

    // Bulk capture whose receipt is lost after the runtime committed it: the retry repeats no write.
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Vocabulary', exact: true }).click();
    let lost = false;
    await page.route(`${nativeCore.url}/invoke`, async route => {
      const body = route.request().postDataJSON();
      if (!lost && typeof body.args?.request === 'string' && JSON.parse(body.args.request).type === 'capture_materials') {
        lost = true;
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    const bulk = page.getByRole('button', { name: 'Capture all eligible in this view', exact: true });
    await bulk.click();
    const vocabulary = page.getByRole('dialog', { name: 'Vocabulary' });
    await expect(vocabulary.getByRole('button', { name: /^Retry failed captures \(\d+\)$/ })).toBeVisible();
    expect(await vocabulary.innerText()).not.toMatch(/Failed to fetch|fetch|HTTP/);
    await page.screenshot({ path: info.outputPath('m03-bulk-lost.png') });
    expect(lost).toBe(true);
    await vocabulary.getByRole('button', { name: /^Retry failed captures \(\d+\)$/ }).click();
    await expect.poll(async () => {
      const page = await client.materials({ after: null, query: '', sourceId: null, includeExcluded: true });
      const phrases = page.items.map(item => item.content.phrase.toLowerCase());
      return { unique: new Set(phrases).size === phrases.length, bulkCaptured: phrases.length > 2 };
    }, { timeout: 30_000 }).toEqual({ unique: true, bulkCaptured: true });
    await page.unroute(`${nativeCore.url}/invoke`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
