import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { test, expect, installPackage, execute } from '../../tests/web/journeys/fixture';

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)], max: sorted[sorted.length - 1] };
};

test('perf: cue annotation and Knowledge filter', async ({ page, nativeCore }) => {
  test.setTimeout(900_000);
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  const results: Record<string, unknown> = {};
  await installPackage(page);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-perf-'));
  const video = path.join(directory, 'Perf.webm');
  await copyFile(path.join(homedir(), 'mlearn-test-corpus', 'HERO_-_Blender_Open_Movie-full_movie.webm'), video);
  const words = ['river', 'bridge', 'garden', 'window', 'teacher', 'mountain', 'kitchen', 'letter', 'market', 'forest', 'island', 'castle'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = (seconds: number) => `00:${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)},000`;
  const srt = words.map((word, i) => `${i + 1}\n${at(i * 10)} --> ${at(i * 10 + 9)}\nThe ${word} was quiet that evening.\n`).join('\n');
  await writeFile(path.join(directory, 'Perf.srt'), srt);
  const opened = await execute(nativeCore, { type: 'open_source', path: video, packageId: 'org.mlearn.english' });
  await execute(nativeCore, { type: 'attach_subtitles', sourceId: opened.window.source.id, path: path.join(directory, 'Perf.srt') });
  const subtitles = page.getByTestId('subtitle-window');
  const opening = Date.now();
  await page.goto(`/watch?id=${opened.window.source.id}`);
  await expect(subtitles.getByRole('button', { name: /^river: / })).toBeVisible({ timeout: 60_000 });
  results.watchOpenToFirstAnnotatedCueMs = Date.now() - opening;
  const seeks: number[] = [];
  for (const [i, word] of words.entries()) {
    if (i === 0) continue;
    seeks.push(await page.evaluate(([seconds, word]) => new Promise<number>((resolve, reject) => {
      const found = () => document.querySelector(`[data-testid="subtitle-window"] [aria-label^="${word}: "]`);
      const started = performance.now();
      const observer = new MutationObserver(() => { if (found()) { observer.disconnect(); resolve(performance.now() - started); } });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      setTimeout(() => { observer.disconnect(); reject(new Error(`no annotated cue for ${word}`)); }, 30_000);
      const media = document.querySelector('video');
      if (media) media.currentTime = Number(seconds);
    }), [i * 10 + 1, word] as const));
  }
  results.seekToAnnotatedCueMs = stats(seeks);
  await writeFile('.mlearn/m01-m11/perf.json', JSON.stringify(results, null, 2));

  await page.goto('/knowledge');
  const prepare = page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true });
  await expect(prepare).toBeVisible();
  const preparing = Date.now();
  await prepare.click();
  await expect(prepare).toHaveCount(0, { timeout: 600_000 });
  await expect(page.getByText(/ entries$/).first()).toBeVisible({ timeout: 60_000 });
  results.knowledgePreparationMs = Date.now() - preparing;
  const filters: number[] = [];
  for (const query of ['river', 'bridge', 'quiet', 'evening', 'garden', 'run', 'house', 'water']) {
    const search = page.getByRole('textbox', { name: 'Search Knowledge', exact: true });
    await search.fill(query);
    const started = Date.now();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(/^knowledge-target-/).first()).toContainText(new RegExp(query, 'i'), { timeout: 30_000 });
    filters.push(Date.now() - started);
  }
  results.knowledgeFilterMs = stats(filters);
  await writeFile('.mlearn/m01-m11/perf.json', JSON.stringify(results, null, 2));

  // Reader page switch and the source-pixel magnifier on a real image collection.
  await installPackage(page, /Japanese/);
  const images = path.join(directory, 'Pages');
  await mkdir(images);
  const files = [];
  for (let index = 0; index < 10; index++) {
    const target = path.join(images, `${index}.png`);
    await copyFile(path.join(homedir(), 'mlearn-test-corpus', 'loadable', `${index}.png`), target);
    files.push(target);
  }
  const { createRuntimeBrowserClient } = await import('../runtime-browser-client');
  const collection = await createRuntimeBrowserClient(nativeCore).importImages(files, 'Pages', 'org.mlearn.japanese');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/reader?id=${collection.source.id}`);
  await expect(page.getByTestId('reader-position')).toHaveText(/^1/);
  const switches: number[] = [];
  for (let turn = 0; turn < 4; turn++) {
    await page.evaluate(() => { (window as unknown as { __turn: Promise<number> }).__turn = new Promise<number>((resolve, reject) => {
      const position = () => document.querySelector('[data-testid="reader-position"]')?.textContent;
      const before = position();
      const started = performance.now();
      const done = () => {
        const images = [...document.querySelectorAll('[data-testid^="reader-image-"] img')] as HTMLImageElement[];
        return position() !== before && images.every(image => image.complete);
      };
      const observer = new MutationObserver(() => { if (done()) { observer.disconnect(); resolve(performance.now() - started); } });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('page did not change')); }, 30_000);
    }); });
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    switches.push(await page.evaluate(() => (window as unknown as { __turn: Promise<number> }).__turn));
  }
  results.readerPageSwitchMs = stats(switches);
  await writeFile('.mlearn/m01-m11/perf.json', JSON.stringify(results, null, 2));
  const image = page.getByTestId(/^reader-image-/).first();
  const box = await image.boundingBox();
  if (!box) throw new Error('No page image');
  const lenses: number[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.mouse.move(box.x + box.width * (0.2 + attempt * 0.08), box.y + box.height * 0.4);
    const ready = page.evaluate(() => new Promise<number>((resolve, reject) => {
      const started = performance.now();
      const found = () => document.querySelector('[aria-label="Source image magnifier"][aria-busy="false"]');
      const observer = new MutationObserver(() => { if (found()) { observer.disconnect(); resolve(performance.now() - started); } });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('lens not ready')); }, 10_000);
    }));
    await page.keyboard.down('z');
    lenses.push(await ready);
    await page.keyboard.up('z');
    await expect(page.getByRole('img', { name: 'Source image magnifier', exact: true })).toHaveCount(0);
  }
  results.magnifierOpenMs = stats(lenses);
  await writeFile('.mlearn/m01-m11/perf.json', JSON.stringify(results, null, 2));
});
