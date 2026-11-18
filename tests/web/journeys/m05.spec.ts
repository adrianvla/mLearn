import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { test, expect, installPackage, execute } from './fixture';

// PLAN M05 Review: inspect and capture from a book; change typography/orientation; revisit the
// exact passage; review the capture and Return. Demonstrate the same target's claim change in
// Reader and Watch without reinitializing either language pipeline.
test('M05 Reader capture, typography and orientation, exact revisit, Review return and cross-surface claim', async ({ page, nativeCore }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-m05-'));
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  try {
    await installPackage(page);
    const book = await client.openDocument(path.resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
    await page.goto(`/reader?id=${book.source.id}`);
    const inspector = page.getByTestId('inspector-panel');
    // A text source's toolbar carries its whole title, not page-image layout controls.
    await page.setViewportSize({ width: 1210, height: 896 });
    await expect(page.getByRole('combobox', { name: /^Image fit:/ })).toHaveCount(0);
    expect(await page.getByTestId('reader-title').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    // Vocabulary cards carry each word's nearby meaning, as in Watch.
    await expect(page.getByTestId('reader-side-panel')).toContainText('a young person of either sex');

    // Inspect and capture from the book.
    await page.getByRole('button', { name: /^Children: / }).first().click();
    await inspector.getByRole('button', { name: 'Capture Children', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Open saved Children: revision 1', exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: /^Close Inspect/ }).click();

    // Typography and orientation are reader settings that persist with the passage.
    await page.getByRole('button', { name: 'Themes & Settings', exact: true }).click();
    const appearancePanel = page.getByTestId('reader-appearance-panel');
    const size = appearancePanel.getByLabel(/^Text size \d+$/);
    const before = await size.getAttribute('aria-label');
    await appearancePanel.getByRole('button', { name: 'Larger text', exact: true }).click();
    await expect(size).not.toHaveAttribute('aria-label', before ?? '');
    const appearance = await size.getAttribute('aria-label');
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: /^Writing direction:/ }).click();
    await page.getByRole('option', { name: 'Vertical', exact: true }).click();
    await expect(page.getByRole('combobox', { name: /^Writing direction:/ })).toHaveAccessibleName('Writing direction: Vertical');
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByTestId('reader-options-panel').getByRole('button', { name: 'Save position', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath('m05-vertical.png') });

    // Revisit: leave and reopen the book at the same passage with the same presentation.
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.goto(`/reader?id=${book.source.id}`);
    await expect(page.getByRole('button', { name: /^Children: / }).first()).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Writing direction:/ })).toHaveAccessibleName('Writing direction: Vertical');
    await page.getByRole('button', { name: 'Themes & Settings', exact: true }).click();
    await expect(page.getByTestId('reader-appearance-panel').getByLabel(/^Text size \d+$/)).toHaveAttribute('aria-label', appearance ?? '');
    await page.keyboard.press('Escape');

    // Review the capture, then Return to the exact passage in the book.
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByTestId('home-open-review').click();
    await page.getByRole('button', { name: 'Session size', exact: true }).click();
    await page.getByRole('textbox', { name: 'Finite Review limit', exact: true }).fill('1');
    await page.getByRole('button', { name: 'Start finite Review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible();
    const [session] = await client.reviewSessions();
    if (!session?.encounter) await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await page.getByRole('button', { name: 'Return to source', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/reader\\?.*${book.source.id}`));
    await expect(page.getByRole('button', { name: /^Children: / }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('m05-review-return.png') });

    // The same target in a video agrees after a claim made in the Reader.
    const video = path.join(directory, 'Walk.mp4');
    await writeFile(video, 'cross-surface claim source identity');
    await writeFile(path.join(directory, 'Walk.srt'), '1\n00:00:00,000 --> 00:00:30,000\nChildren walked home.\n');
    const opened = await execute(nativeCore, { type: 'open_source', path: video, packageId: 'org.mlearn.english' });
    await execute(nativeCore, { type: 'attach_subtitles', sourceId: opened.window.source.id, path: path.join(directory, 'Walk.srt') });
    const language = await client.describeLanguage('org.mlearn.english');
    const annotated = language.capabilities.find(item => item.id === language.annotationCapability);
    if (!annotated) throw new Error('The package names no annotation capability');
    await page.goto(`/reader?id=${book.source.id}`);
    await page.getByRole('button', { name: /^Children: / }).first().click();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: annotated.label, exact: true }).click();
    await inspector.getByRole('button', { name: `Claim ${annotated.label} known`, exact: true }).click();
    await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
    const readerLabel = await page.getByRole('button', { name: /^Children: / }).first().getAttribute('aria-label');
    expect(readerLabel).not.toMatch(/untracked/);
    await page.goto('/');
    await page.getByRole('button', { name: `Continue ${opened.window.source.title}`, exact: true }).click();
    await expect(page.getByTestId('subtitle-window').getByRole('button', { name: /^Children: / }))
      .toHaveAttribute('aria-label', readerLabel ?? '');
    await page.screenshot({ path: info.outputPath('m05-watch-agrees.png') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
