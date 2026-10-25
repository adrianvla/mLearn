/// <reference types="node" />
import { expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from './messenger-native-fixture';

for (const width of [1200, 500, 320] as const) {
test(`focused live word card fits the ${width}px overlay when its close control appears`, async ({ page, nativeCore }, info) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-watch-layout-'));
  try {
    // This fixture exercises real source analysis and layout, not media decoding.
    // The browser transport explicitly reports native media as unsupported.
    const video = path.join(directory, 'words.mp4');
    const subtitles = path.join(directory, 'words.srt');
    await writeFile(video, 'authored source identity for the layout fixture');
    await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:10,000\ncat dog book house\n');
    await page.setViewportSize({ width, height: 850 });
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
    const translator = page.getByRole('button', { name: 'Live word translator', exact: true });
    await expect(translator).toBeEnabled();
    await translator.click();
    const overlay = page.getByTestId('live-word-cards');
    const cards = overlay.getByRole('button', { name: / · / });
    await expect(cards).toHaveCount(4);
    const last = cards.last();
    await last.focus();
    await expect(overlay.getByRole('button', { name: 'Hide live word translator', exact: true })).toBeEnabled();
    const container = await overlay.boundingBox();
    const focused = await last.boundingBox();
    if (!container || !focused) throw new Error('Focused live word card is not laid out');
    await page.screenshot({ path: info.outputPath('focused-live-card.png') });
    expect(focused.x).toBeGreaterThanOrEqual(container.x);
    expect(focused.x + focused.width).toBeLessThanOrEqual(container.x + container.width);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
}
