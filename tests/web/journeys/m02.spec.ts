import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { test, expect, installPackage, execute } from './fixture';

const corpusVideo = path.join(homedir(), 'mlearn-test-corpus', 'HERO_-_Blender_Open_Movie-full_movie.webm');
const styled = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,40

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:20.00,Default,,0,0,0,,{\\an8}The children walked home.
Dialogue: 0,0:00:20.00,0:00:40.00,Default,,0,0,0,Banner;10,{\\pos(10,10)}The bridge is quiet.
`;

// PLAN M02 Review: change source and definition language independently; install/retry/update a
// package; navigate and resynchronize subtitles; inspect ambiguity and a long entry. Confirm stale
// analysis cannot repaint the wrong source. Check documented subtitle limitations.
test('M02 subtitle interaction, package management, ambiguity, stale analysis and subtitle limitations', async ({ page, nativeCore }, info) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(20_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-m02-'));
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  // Reads stored source state without a source action, which would cancel the page's own source work.
  const stored = async (id: string) => {
    const source = (await client.recentSources()).find(value => value.id === id);
    if (!source) throw new Error('The source is not stored');
    return source;
  };
  try {
    // Install fails in place, retries, then updates.
    nativeCore.catalogMode('fail');
    await page.goto('/settings?section=languages');
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(await page.getByRole('alert').first().innerText()).not.toMatch(/HTTP|\d{3}|catalog\.json|fixture/i);
    nativeCore.catalogMode('complete');
    await installPackage(page);
    // Installed at the catalog's release: nothing to update, so no Update is offered.
    // (Updating to a newer release is exercised natively: English 0.1.1 -> 0.1.11.)
    await expect(page.getByLabel(/^English.* installed$/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toHaveCount(0);
    // A newer release in the catalog is offered as an update and replaces the installed one.
    nativeCore.catalogRelease('org.mlearn.english', '0.1.12-update');
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Update .*English/ }).click();
    await expect(page.getByText('Version 0.1.12', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toHaveCount(0);
    expect((await client.snapshot()).installedPlugins.find(plugin => plugin.id === 'org.mlearn.english')?.version).toBe('0.1.12-update');
    await installPackage(page, /Japanese/);

    // Remove a package after confirming what stays, then install it again.
    await page.getByRole('button', { name: /^Remove Japanese/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove language package', exact: true });
    await expect(confirm).toContainText('Saved words, Material and progress are kept');
    await confirm.getByRole('button', { name: 'Remove package', exact: true }).click();
    await expect(page.getByLabel(/^Japanese.* installed$/)).toHaveCount(0);
    await expect(page.getByLabel(/^English.* installed$/)).toBeVisible();
    expect((await client.snapshot()).installedPlugins.map(plugin => plugin.id)).not.toContain('org.mlearn.japanese');
    await installPackage(page, /Japanese/);

    // Two videos with documented subtitle formats.
    const sources = [];
    for (const [name, file, body] of [['Walk', 'Walk.ass', styled], ['Harbour', 'Harbour.srt', '1\n00:00:00,000 --> 00:00:40,000\nShips sail at dawn.\n']]) {
      const video = path.join(directory, `${name}.webm`);
      await copyFile(corpusVideo, video);
      // Source identity follows media content; trailing bytes make two distinct, playable videos.
      await appendFile(video, name);
      await writeFile(path.join(directory, file), body);
      const opened = await execute(nativeCore, { type: 'open_source', path: video, packageId: 'org.mlearn.english' });
      await execute(nativeCore, { type: 'attach_subtitles', sourceId: opened.window.source.id, path: path.join(directory, file) });
      sources.push(opened.window.source);
    }
    const [walk, harbour] = sources;
    await page.goto(`/watch?id=${walk.id}`);
    const subtitles = page.getByTestId('subtitle-window');
    await expect(subtitles.getByRole('button', { name: /^children: / })).toBeVisible();
    await expect(subtitles).not.toContainText('\\an8');

    // Subtitle limitations are stated, not hidden.
    await page.getByRole('button', { name: 'Playback options', exact: true }).click();
    const options = page.getByRole('dialog', { name: 'Playback and subtitles', exact: true });
    await expect(options.getByTestId('subtitle-limitations')).toHaveText(/text and timing.*styling, positioning and effects/);

    // Navigate and resynchronize.
    await options.getByRole('button', { name: 'Align next subtitle', exact: true }).click();
    await expect.poll(async () => (await stored(walk.id)).subtitleOffsetMs).not.toBe(0);
    await options.getByRole('button', { name: 'Reset synchronization', exact: true }).click();
    await expect.poll(async () => (await stored(walk.id)).subtitleOffsetMs).toBe(0);
    await page.screenshot({ path: info.outputPath('m02-limitations.png') });
    await options.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Transcript', exact: true }).click();
    await page.getByTestId('transcript-search-input').fill('bridge');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('dialog', { name: 'Transcript' }).getByRole('button', { name: /^Play from|^Go to|The bridge is quiet/ }).first().click();
    await expect(subtitles.getByRole('button', { name: /^bridge: / })).toBeVisible();
    await page.keyboard.press('Escape');

    // Ambiguity and a long entry stay inside the Inspector.
    await subtitles.getByRole('button', { name: /^quiet: / }).click();
    const inspector = page.getByTestId('inspector-panel');
    await expect(inspector.getByRole('button', { name: /^Dictionary alternatives \(\d+\)/ })).toBeVisible();
    await inspector.getByRole('button', { name: /^Dictionary alternatives \(\d+\)/ }).click();
    const viewport = page.viewportSize();
    const bounds = await inspector.boundingBox();
    expect(bounds && viewport && bounds.y + bounds.height <= viewport.height + 1).toBe(true);
    await page.screenshot({ path: info.outputPath('m02-alternatives.png') });
    await inspector.getByRole('button', { name: /^Close Inspect/ }).click();

    // Source language is per source: this video changes language, the other keeps English.
    await page.getByRole('button', { name: 'Playback options', exact: true }).click();
    await options.getByRole('combobox', { name: /^Source language/ }).click();
    await page.getByRole('option', { name: /Japanese/ }).click();
    await expect.poll(async () => (await stored(walk.id)).packageId).toBe('org.mlearn.japanese');
    expect((await stored(harbour.id)).packageId).toBe('org.mlearn.english');
    await options.getByRole('combobox', { name: /^Source language/ }).click();
    await page.getByRole('option', { name: /^English/ }).click();
    await expect.poll(async () => (await stored(walk.id)).packageId).toBe('org.mlearn.english');
    await options.getByRole('button', { name: 'Close', exact: true }).click();

    // Tracks carried inside the video: embedded text subtitles can be used, picture subtitles and
    // audio switching are explained in place. The remuxed corpus video adds a second audio track,
    // English text, ASS and picture subtitle tracks (crates/runtime/examples/multitrack_webm.rs).
    const tracked = path.join(directory, 'Harbour tracks.webm');
    await promisify(execFile)(path.resolve('target/debug/examples/multitrack_webm'), [corpusVideo, tracked]);
    const multitrack = await execute(nativeCore, { type: 'open_source', path: tracked, packageId: 'org.mlearn.english' });
    await page.goto(`/watch?id=${multitrack.window.source.id}`);
    await page.getByRole('button', { name: 'Playback options', exact: true }).click();
    const trackOptions = page.getByRole('dialog', { name: 'Playback and subtitles', exact: true });
    await expect(trackOptions.getByText('Subtitles in this video', { exact: true })).toBeVisible();
    await expect(trackOptions.getByText('These subtitles are pictures, so they can’t be shown as text.', { exact: true })).toBeVisible();
    // Chromium exposes no audio track list, so switching is explained rather than offered.
    await expect(trackOptions.getByRole('combobox', { name: /^Audio track/ })).toBeDisabled();
    await expect(trackOptions.getByText('This player can’t switch between this video’s audio tracks.', { exact: true })).toBeVisible();
    expect(await trackOptions.innerText()).not.toMatch(/S_TEXT|PGS|A_OPUS|codec|track 10\d/i);
    await page.screenshot({ path: info.outputPath('m02-embedded-tracks.png') });
    await trackOptions.getByRole('button', { name: /^Use English/ }).click();
    await expect.poll(async () => (await stored(multitrack.window.source.id)).subtitleRevision).not.toBeNull();
    await trackOptions.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(subtitles.getByRole('button', { name: /^Ships: / })).toBeVisible();

    // A held analysis of one source never paints over the next source.
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let holding = true;
    let finish = () => {};
    const handled = new Promise<void>(resolve => { finish = resolve; });
    await page.route(`${nativeCore.url}/invoke`, async route => {
      const body = route.request().postDataJSON();
      const request = typeof body.args?.request === 'string' ? JSON.parse(body.args.request) : null;
      if (holding && request?.type === 'analyze_source' && request.sourceId === harbour.id) {
        holding = false;
        try {
          const response = await route.fetch();
          await held;
          // The page may already have abandoned this request; delivering it late is the point.
          await route.fulfill({ response }).catch(() => {});
        } finally { finish(); }
        return;
      }
      await route.continue();
    });
    // Harbour has not been opened in the app yet, so its first analysis is a real request to hold.
    await page.goto(`/watch?id=${harbour.id}`);
    await expect.poll(() => holding).toBe(false);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    // Walk resumes at the bridge cue the transcript step moved it to.
    await page.getByRole('button', { name: `Continue ${walk.title}`, exact: true }).or(page.getByRole('button', { name: new RegExp(walk.title.replace('.', '\\.')) })).first().click();
    // The held reply occupies the source lane, so Walk's own analysis follows its release.
    release();
    await handled;
    await expect(subtitles.getByRole('button', { name: /^Ships: / })).toHaveCount(0);
    await expect(subtitles.getByRole('button', { name: /^bridge: / })).toBeVisible();
    await page.unroute(`${nativeCore.url}/invoke`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
