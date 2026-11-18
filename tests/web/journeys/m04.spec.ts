import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { test, expect, installPackage, execute } from './fixture';

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
