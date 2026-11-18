import { copyFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { test, expect, installPackage, execute } from './fixture';

const corpusVideo = path.join(homedir(), 'mlearn-test-corpus', 'HERO_-_Blender_Open_Movie-full_movie.webm');
const subtitles = `1
00:00:00,500 --> 00:00:04,000
The children walked home.

2
00:00:04,000 --> 00:01:00,000
The children read a book at home.

3
00:01:00,000 --> 00:01:30,000
Our house is near the river.
`;

// PLAN M01 Review: open content, play/pause/seek, inspect several occurrences, change one
// capability claim, confirm relevant annotations agree, close/reopen and return to the same
// source; a failed/missing file or package keeps existing state.
test('M01 Watch to Inspector to Knowledge with exact resume and recoverable failures', async ({ page, nativeCore }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-m01-'));
  try {
    const video = path.join(directory, 'Evening walk.webm');
    await copyFile(corpusVideo, video);
    await writeFile(path.join(directory, 'Evening walk.srt'), subtitles);

    // A failed catalog keeps the empty profile usable and retries in place.
    nativeCore.catalogMode('fail');
    await page.goto('/settings?section=languages');
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('m01-catalog-failed.png') });
    nativeCore.catalogMode('complete');
    await installPackage(page);

    const opened = await execute(nativeCore, { type: 'open_source', path: video, packageId: 'org.mlearn.english' });
    expect(opened).toMatchObject({ type: 'source' });
    const sourceId = opened.window.source.id;
    await execute(nativeCore, { type: 'attach_subtitles', sourceId, path: path.join(directory, 'Evening walk.srt') });
    await page.goto('/');
    await page.getByRole('button', { name: `Continue ${opened.window.source.title}`, exact: true }).click();

    // Real playback of the local file through the shared media transport.
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeEnabled({ timeout: 30_000 });
    await play.click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const subtitlesWindow = page.getByTestId('subtitle-window');
    await expect(subtitlesWindow.getByRole('button', { name: /^children: / })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const position = page.getByRole('slider', { name: 'Playback position' });
    await position.focus();
    for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(4);
    await page.screenshot({ path: info.outputPath('m01-seeked.png') });

    // Inspect an occurrence, then claim one capability and check the other occurrence agrees.
    const children = subtitlesWindow.getByRole('button', { name: /^children: / });
    const before = await children.first().getAttribute('aria-label');
    await children.first().click();
    const inspector = page.getByTestId('inspector-panel');
    await expect(inspector).toBeVisible();
    const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
    const language = await client.describeLanguage('org.mlearn.english');
    const annotated = language.capabilities.find(item => item.id === language.annotationCapability);
    if (!annotated) throw new Error('The package names no annotation capability');
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: annotated.label, exact: true }).click();
    await inspector.getByRole('button', { name: `Claim ${annotated.label} known`, exact: true }).click();
    await expect(inspector.getByText(/claimed known/).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('m01-claimed.png') });
    await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
    await expect.poll(() => children.first().getAttribute('aria-label')).not.toBe(before);
    const after = await children.first().getAttribute('aria-label');

    // Close and reopen: the same source, position and claim come back.
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: `Continue ${opened.window.source.title}`, exact: true }).click();
    await expect(page.getByTestId('watch-source-title')).toHaveText(opened.window.source.title);
    await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(4);
    await expect(subtitlesWindow.getByRole('button', { name: /^children: / }).first()).toHaveAttribute('aria-label', after ?? '');

    // A moved file shows one plain sentence and a retry; restoring it recovers in place.
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await rename(video, `${video}.moved`);
    await page.getByRole('button', { name: `Continue ${opened.window.source.title}`, exact: true }).click();
    const alert = page.getByRole('alert').first();
    await expect(alert).toBeVisible({ timeout: 30_000 });
    expect(await alert.innerText()).not.toMatch(/Error|errno|\.webm|No such file|os error/);
    await page.screenshot({ path: info.outputPath('m01-missing-file.png') });
    await rename(`${video}.moved`, video);
    await page.getByRole('button', { name: /^Retry/ }).first().click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({ timeout: 30_000 });
    await expect(subtitlesWindow.getByRole('button', { name: /^children: / }).first()).toHaveAttribute('aria-label', after ?? '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
