import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { emptyMaterial } from '../../../apps/client/src/features/material/content';
import { test, expect, installPackage, execute } from './fixture';

/** One second of a quiet 440 Hz tone as 8 kHz mono 16-bit PCM WAV. */
function tone(): Buffer {
  const samples = 8000, data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++)
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / 8000) * 6000), index * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// PLAN M04 Review (audio probe): Material with authored audio bound to its phrase is reviewed as a
// listening encounter on the real runtime; where the host cannot play it, recovery stays plain.
test('M04 authored audio probe is presented as a listening encounter in Review', async ({ page, nativeCore }, info) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-m04-audio-'));
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  try {
    await installPackage(page);
    const packageId = 'org.mlearn.english';
    const recording = path.join(directory, 'harbour.wav');
    await writeFile(recording, tone());
    const saved = await client.createMaterial({
      ...client.prepareMaterial({ ...emptyMaterial(packageId), phrase: 'harbour', meaning: 'a sheltered port' }),
      mediaImports: [{ path: recording, kind: 'audio', name: 'harbour.wav', segment: null,
        audioBinding: { packageId, targetId: null, phrase: 'harbour' } }],
    });
    expect(saved.status).toBe('saved');
    const stored = (await client.materials({ after: null, query: 'harbour', sourceId: null, includeExcluded: true })).items;
    expect(stored.flatMap(item => item.content.attachments.map(attachment => attachment.audioBinding?.phrase ?? null)))
      .toEqual(['harbour']);
    await page.goto('/');
    await page.getByTestId('home-open-review').click();
    await page.getByRole('button', { name: 'Session size', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finite Review limit', exact: true }).fill('3');
    await page.getByRole('button', { name: 'Start finite Review', exact: true }).click();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    // Rate the written encounters until the listening encounter is presented. After a rating the
    // next encounter is admitted asynchronously, so wait for it (or the end of the session).
    const [started] = await client.reviewSessions();
    if (!started) throw new Error('No Review session was admitted');
    const settled = async (completed: number) => {
      await expect.poll(async () => {
        const value = await client.reviewSession(started.id);
        return value.completed === completed && (value.encounter !== null || value.completed === value.total);
      }, { timeout: 20_000 }).toBe(true);
      return client.reviewSession(started.id);
    };
    let session = await settled(0);
    const seen: string[] = [];
    for (let turn = 0; turn < 3 && session.encounter; turn++) {
      seen.push(session.encounter.direction);
      if (session.encounter.direction === 'audio') break;
      await page.getByRole('button', { name: 'Reveal', exact: true }).click();
      // Why an answer counts as assisted is stated in plain words, never as an internal id.
      expect(await page.locator('body').innerText()).not.toMatch(/\b(prior_disclosure|repeated_exposure)\b/);
      // Focused recall opens with per-capability ratings, so its whole-item action reads "All Fluent".
      await page.getByRole('button', { name: /^(All )?Fluent$/ }).first().click();
      session = await settled(turn + 1);
    }
    expect(session.encounter?.direction, `presented: ${seen.join(', ')} of ${session.total}`).toBe('audio');
    expect(session.encounter?.requiredMedia).not.toBeNull();
    await expect(page.getByText('Authored audio', { exact: true })).toBeVisible();
    // This browser host never fabricates native media playback (see tools/runtime-browser-qa.mjs),
    // so the recording cannot play here: the failure is one plain sentence with Retry, and any
    // raw detail stays behind Details. Actual playback is checked in the native desktop app.
    await expect(page.getByText('This audio couldn’t be played.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry audio', exact: true })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/unsupported-media|HTTP|Failed to fetch|MEDIA_ERR/);
    await page.screenshot({ path: info.outputPath('m04-audio-probe.png') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// PLAN M04 Review: use material captured in M03; rate mixed capabilities, Undo/correct, force a
// recoverable write failure, retry/restart, resume the exact revealed state, and return to the
// original video.
test('M04 Review with mixed ratings, correction, failed write recovery, restart and source return', async ({ page, nativeCore }, info) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(20_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-m04-'));
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  try {
    const video = path.join(directory, 'Rival.webm');
    await copyFile(path.join(homedir(), 'mlearn-test-corpus', 'HERO_-_Blender_Open_Movie-full_movie.webm'), video);
    await writeFile(path.join(directory, 'Rival.srt'), '1\n00:00:00,000 --> 00:00:30,000\n昨日の俺と同じだと思うなよ！\n');
    await installPackage(page, /Japanese/);
    const opened = await execute(nativeCore, { type: 'open_source', path: video, packageId: 'org.mlearn.japanese' });
    await execute(nativeCore, { type: 'attach_subtitles', sourceId: opened.window.source.id, path: path.join(directory, 'Rival.srt') });
    await page.goto('/');
    await page.getByRole('button', { name: `Continue ${opened.window.source.title}`, exact: true }).click();
    const inspector = page.getByTestId('inspector-panel');
    for (const word of ['昨日', '俺']) {
      await page.getByTestId('subtitle-window').getByRole('button', { name: new RegExp(`^${word}: `) }).click();
      await inspector.getByRole('button', { name: `Capture ${word}`, exact: true }).click();
      await expect(inspector.getByRole('button', { name: `Open saved ${word}: revision 1`, exact: true })).toBeVisible();
      await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
    }

    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByTestId('home-open-review').click();
    await page.getByRole('button', { name: 'Session size', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finite Review limit', exact: true }).fill('2');
    await page.getByRole('button', { name: 'Start finite Review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible();
    const [started] = await client.reviewSessions();
    if (!started) throw new Error('No Review session was admitted');
    await expect(page.getByTestId('review-cue')).toBeVisible();
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();

    // Mixed capabilities: the first capability is missed, the others are fluent; the save
    // fails once in transport and Retry resubmits the same answer, recorded once.
    let failed = false;
    await page.route(`${nativeCore.url}/invoke`, async route => {
      const body = route.request().postDataJSON();
      const request = typeof body.args?.request === 'string' ? JSON.parse(body.args.request) : null;
      if (!failed && request?.type === 'review' && request.command?.kind === 'submit') {
        failed = true;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Adjust', exact: true }).click();
    const capabilities = await page.getByRole('button', { name: /: Missed$/ }).evaluateAll(nodes =>
      nodes.map(node => (node.getAttribute('aria-label') ?? '').replace(/: Missed$/, '')));
    expect(capabilities.length).toBeGreaterThan(1);
    await page.getByRole('button', { name: `${capabilities[0]}: Missed`, exact: true }).click();
    await page.screenshot({ path: info.outputPath('m04-adjust.png') });
    for (const capability of capabilities.slice(1))
      await page.getByRole('button', { name: `${capability}: Fluent`, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry Review save', exact: true })).toBeVisible();
    expect(failed).toBe(true);
    await page.screenshot({ path: info.outputPath('m04-save-failed.png') });
    await page.getByRole('button', { name: 'Retry Review save', exact: true }).click();
    await page.unroute(`${nativeCore.url}/invoke`);
    await expect.poll(async () => (await client.reviewSession(started.id)).completed).toBe(1);

    // Undo returns to the rated item; the correction replaces, not doubles, the response.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await client.reviewSession(started.id)).completed).toBe(0);
    await expect(page.getByTestId('review-answer')).toBeVisible();
    await page.getByRole('button', { name: 'Fluent', exact: true }).click();
    await expect.poll(async () => (await client.reviewSession(started.id)).completed).toBe(1);

    // Reveal the second item, restart the native owner and resume the exact revealed state.
    await expect(page.getByTestId('review-cue')).toBeVisible();
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    const revealed = (await client.reviewSession(started.id)).encounter;
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByText('Review paused', { exact: true })).toBeVisible();
    await nativeCore.crashRestart();
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    expect((await client.reviewSession(started.id)).encounter).toEqual(revealed);

    // Return to the original video occurrence of the reviewed item.
    await page.getByRole('button', { name: 'Return to source', exact: true }).click();
    await expect(page).toHaveURL(/\/watch/);
    await expect(page.getByTestId('subtitle-window')).toContainText('昨日');
    await page.screenshot({ path: info.outputPath('m04-returned.png') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
