/// <reference types="node" />
import { expect, type Page, type Request } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from './messenger-native-fixture';

declare global { interface Window { __watchSearchSeek: Promise<number> } }

let directory: string;
let videoPath: string;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  directory = await mkdtemp(join(tmpdir(), 'mlearn-watch-search-'));
  if (process.env.MLEARN_WATCH_FIXTURE) videoPath = resolve(process.env.MLEARN_WATCH_FIXTURE);
  else {
    // Reuse the native acceptance fixture generator, not private learner media
    // or an invented video/controller response.
    await promisify(execFile)('python3', ['tools/create-watch-fixture.py', directory], { timeout: 90_000 });
    videoPath = join(directory, 'watch-fixture.mp4');
  }
  await writeFile(join(directory, 'search.srt'),
    '1\n00:00:00,000 --> 00:00:15,000\nChildren walked home.\n\n2\n00:00:15,000 --> 00:00:30,000\nChildren came home.\n');
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function transcript(page: Page) {
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Transcript', exact: true }).click();
  return page.getByRole('dialog', { name: 'Transcript', exact: true });
}

async function watchSeek(page: Page) {
  await page.locator('video').evaluate(video => {
    if (!(video instanceof HTMLVideoElement)) throw new Error('Missing real video');
    window.__watchSearchSeek = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Video seek did not finish')); }, 5000);
      const finished = () => { cleanup(); resolve(video.currentTime); };
      const cleanup = () => { clearTimeout(timeout); video.removeEventListener('seeked', finished); };
      video.addEventListener('seeked', finished, { once: true });
    });
  });
}

test('literal transcript search preserves playback across restart and checkpoint-safe Home departure', async ({ page, nativeCore }, info) => {
  test.setTimeout(120_000);
  // Only desktop shell event registration and media byte delivery are adapted.
  // Package execution, subtitle timing, source identity and persistence are real.
  await page.route(`${nativeCore.url}/invoke`, async route => {
    const command = route.request().postDataJSON().command;
    if (command === 'plugin:event|listen') {
      await route.fulfill({ json: { value: 1 } }); return;
    }
    await route.continue();
  });
  const media = await readFile(videoPath);
  await page.route(`${nativeCore.url}/unsupported-media/**`, async route => {
    const range = route.request().headers().range;
    if (!range) {
      await route.fulfill({ body: media, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' } }); return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) throw new Error(`Unexpected browser media range: ${range}`);
    const start = Number(match[1]), end = Math.min(Number(match[2] || media.length - 1), media.length - 1);
    await route.fulfill({ status: 206, body: media.subarray(start, end + 1), contentType: 'video/mp4',
      headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${media.length}` } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
  await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
  await page.getByRole('button', { name: /^Install .*English/ }).click();
  await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
  const call = async (request: unknown) => JSON.parse(await nativeCore.invoke('runtime_execute', { request: JSON.stringify(request) }));
  const opened = await call({ type: 'open_source', path: videoPath, packageId: 'org.mlearn.english' });
  const sourceId = opened.window.source.id;
  await call({ type: 'attach_subtitles', sourceId, path: join(directory, 'search.srt') });
  await call({ type: 'set_subtitle_offset', sourceId, offsetMs: 2000 });
  await call({ type: 'set_playback_rate', sourceId, rate: 1.5 });
  await call({ type: 'save_position', sourceId, positionMs: 3000, durationMs: 30000 });
  expect((await call({ type: 'resume_source', sourceId })).window.source).toMatchObject({
    positionMs: 3000, subtitleOffsetMs: 2000, playbackRate: 1.5,
  });
  await page.goto(`/watch?id=${encodeURIComponent(sourceId)}`);
  await page.locator('video').evaluate(video => {
    if (!(video instanceof HTMLVideoElement)) throw new Error('Missing real video');
    if (video.readyState >= 2 && !video.seeking) return;
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Authored video did not decode')); }, 10000);
      const check = () => { if (video.readyState >= 2 && !video.seeking) { cleanup(); resolve(); } };
      const cleanup = () => {
        clearTimeout(timeout); video.removeEventListener('loadeddata', check); video.removeEventListener('seeked', check);
      };
      video.addEventListener('loadeddata', check); video.addEventListener('seeked', check); check();
    });
  });
  expect(await page.locator('video').evaluate(video => {
    if (!(video instanceof HTMLVideoElement)) throw new Error('Missing real video');
    return video.currentTime;
  })).toBe(3);
  let dialog = await transcript(page);
  await dialog.getByRole('textbox', { name: 'Search transcript', exact: true }).fill('came');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  const cue = dialog.getByRole('button', { name: 'Go to cue 2 at 0:13', exact: true });
  await expect(cue).toBeVisible();
  await page.screenshot({ path: info.outputPath('transcript-search-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('transcript-search-phone.png') });
  await watchSeek(page);
  const cuePosition = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke`) return false;
    const raw = response.request().postDataJSON().args?.request;
    return typeof raw === 'string' && JSON.parse(raw).type === 'cue_position';
  });
  await cue.click();
  expect(JSON.parse((await (await cuePosition).json()).value)).toMatchObject({
    type: 'cue_position', position: { cueIndex: 1, positionMs: 13000 },
  });
  expect(await page.evaluate(() => window.__watchSearchSeek)).toBe(13);
  await expect(dialog).toBeHidden();
  // Restart only after the connected source-analysis result has rendered,
  // rather than racing a deliberate SIGKILL against a pending guest request.
  await expect(page.getByRole('button', { name: 'came: untracked', exact: true })).toBeVisible();
  await nativeCore.crashRestart();
  dialog = await transcript(page);
  await expect(dialog.getByRole('textbox', { name: 'Search transcript', exact: true })).toHaveValue('came');
  const back = dialog.getByRole('button', { name: 'Return to playback position', exact: true });
  await expect(back).toBeVisible();
  await page.screenshot({ path: info.outputPath('transcript-search-return-phone.png') });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.screenshot({ path: info.outputPath('transcript-search-return-desktop.png') });
  await watchSeek(page);
  const checkpoint = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke`) return false;
    const raw = response.request().postDataJSON().args?.request;
    if (typeof raw !== 'string') return false;
    const request = JSON.parse(raw);
    return request.type === 'save_position' && request.positionMs === 3000;
  });
  await back.click();
  expect(await page.evaluate(() => window.__watchSearchSeek)).toBe(3);
  await checkpoint;
  const resumed = await call({ type: 'resume_source', sourceId });
  expect(resumed.window.source).toMatchObject({ positionMs: 3000, subtitleOffsetMs: 2000, playbackRate: 1.5 });
  expect(nativeCore.metadata().providerRequests).toBe(0);

  // A failed transport receipt must keep the source and its explicit recovery.
  const isCheckpoint = (request: Request) => {
    if (request.url() !== `${nativeCore.url}/invoke`) return false;
    const raw = request.postDataJSON().args?.request;
    if (typeof raw !== 'string') return false;
    const value = JSON.parse(raw);
    return value.type === 'save_position' && value.sourceId === sourceId;
  };
  let checkpointMode: 'fail' | 'pass' | 'hold' = 'fail';
  let releaseCheckpoint = () => {};
  const heldCheckpoint = new Promise<void>(resolve => { releaseCheckpoint = resolve; });
  await page.route(`${nativeCore.url}/invoke`, async route => {
    if (!isCheckpoint(route.request())) {
      await route.fallback(); return;
    }
    if (checkpointMode === 'fail') {
      await route.abort('failed'); return;
    }
    if (checkpointMode === 'hold') await heldCheckpoint;
    await route.fallback();
  });
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    const failed = page.waitForEvent('requestfailed', { predicate: isCheckpoint });
    const home = page.getByRole('button', { name: 'Home', exact: true });
    await home.click();
    await failed;
    const retry = page.getByRole('button', { name: 'Retry saving position', exact: true });
    await expect(retry).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/watch');
    await expect(page.locator('video')).toBeVisible();
    await page.screenshot({ path: info.outputPath('watch-home-checkpoint-failed-390.png') });

    checkpointMode = 'pass';
    const recovered = page.waitForResponse(response => isCheckpoint(response.request()));
    await retry.click();
    await (await recovered).finished();
    await expect(retry).toHaveCount(0);

    // Exercise departure from actual decoded, playing media, not only the
    // already-paused transcript state used above.
    const player = await page.locator('video').elementHandle();
    if (!player) throw new Error('Decoded Watch player is missing');
    const playback = () => player.evaluate(video => {
      if (!(video instanceof HTMLVideoElement)) throw new Error('Watch player is not a video');
      return { paused: video.paused, positionMs: Math.round(video.currentTime * 1000) };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect((await playback()).paused).toBe(false);

    // Subscribe before Home. Navigation may complete only after the real save,
    // but playback must stop immediately while that receipt is held.
    checkpointMode = 'hold';
    const admitted = page.waitForRequest(isCheckpoint);
    await home.click();
    await admitted;
    const stopped = await playback();
    expect(stopped.paused).toBe(true);
    await expect(home).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel opening', exact: true })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/watch');
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('watch-home-checkpoint-pending-390.png') });
    const saved = page.waitForResponse(response => isCheckpoint(response.request()));
    releaseCheckpoint();
    await (await saved).finished();
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    expect((await playback()).paused).toBe(true);
    await page.locator('body').press('Space');
    expect((await playback()).paused).toBe(true);
    await nativeCore.crashRestart();
    expect((await call({ type: 'resume_source', sourceId })).window.source).toMatchObject({
      positionMs: stopped.positionMs, subtitleOffsetMs: 2000, playbackRate: 1.5,
    });
  } finally {
    checkpointMode = 'pass';
    releaseCheckpoint();
    await page.unroute(`${nativeCore.url}/invoke`);
  }
});
