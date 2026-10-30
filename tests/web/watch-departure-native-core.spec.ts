/// <reference types="node" />
import { expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from './messenger-native-fixture';

for (const action of ['Home', 'Reselect from Home'] as const) {
test(`Watch ${action} returns to retained Home without resetting its Material source entry`, async ({ page, nativeCore }, info) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-watch-departure-'));
  try {
    // Real source/analysis/storage, not media decoding or native playback.
    const video = path.join(directory, 'words.mp4');
    const subtitles = path.join(directory, 'words.srt');
    await writeFile(video, 'authored source identity for the departure fixture');
    await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:10,000\ncat dog book house\n');
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const opened = JSON.parse(await nativeCore.invoke('runtime_execute', {
      request: JSON.stringify({ type: 'open_source', path: video, packageId: 'org.mlearn.english' }),
    }));
    expect(opened).toMatchObject({ type: 'source' });
    const sourceId = opened.window.source.id;
    const attached = JSON.parse(await nativeCore.invoke('runtime_execute', {
      request: JSON.stringify({ type: 'attach_subtitles', sourceId, path: subtitles }),
    }));
    expect(attached).toMatchObject({ type: 'source' });
    await page.goto(`/watch?id=${encodeURIComponent(sourceId)}`);
    await page.getByTestId('subtitle-window').getByText('cat', { exact: true }).click();
    const inspector = page.getByTestId('inspector-panel');
    await inspector.getByRole('button', { name: 'Capture cat', exact: true }).click();
    await inspector.getByRole('button', { name: 'Open saved cat: revision 1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const draft = `Unsubmitted Watch return at ${width}`;
      await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill(draft);
      await page.getByRole('button', { name: 'Return to source', exact: true }).click();
      await expect(page.getByTestId('returned-source-selection')).toContainText('cat');
      await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
      await page.screenshot({ path: info.outputPath(`watch-before-home-${width}.png`) });
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Material', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Search Material', exact: true })).toHaveValue(draft);
      await page.screenshot({ path: info.outputPath(`material-after-watch-home-${width}.png`) });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
}
