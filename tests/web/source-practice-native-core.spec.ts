/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createRuntimeBrowserClient } from '../../tools/runtime-browser-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';
import { builtInThemes } from '../../packages/theme/src/theme';

test('visible unsaved source words use canonical Practice and retain their exact return context', async ({ page }, info) => {
  test.setTimeout(120_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('source-practice-profile') });
  const client = createRuntimeBrowserClient(backend);
  try {
    // Given real source identity, SQLite and package analysis, without authored Materials.
    // This source-only fixture does not claim video decoding or playback verification.
    const video = info.outputPath('words.mp4');
    const subtitles = info.outputPath('words.srt');
    await mkdir(dirname(video), { recursive: true });
    await writeFile(video, 'Source Practice identity fixture; not encoded video');
    await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:10,000\ncat dog book house\n');
    await client.availablePackages();
    await client.installPackage(client.prepareInstall('org.mlearn.english'));
    const opened = await client.openSource(video, 'org.mlearn.english');
    await client.attachSubtitles(opened.source.id, subtitles);
    // Supply the fixture's declared media duration through the normal host boundary;
    // this harness has no decoder that could discover it from the identity-only file.
    await client.savePosition(opened.source.id, 0, 10_000);
    await attachRuntimeBrowserQa(page, backend.url);
    const start = page.getByRole('button', { name: 'Practice words in this view', exact: true });
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.goto(`/watch?id=${opened.source.id}`);
      await page.reload();
      await page.getByRole('button', { name: 'Transcript', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Vocabulary', exact: true }).click();
      await expect(start).toBeEnabled();
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await start.scrollIntoViewIfNeeded();
        await expect(start).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: info.outputPath(`source-practice-${theme.id}-${width}.png`) });
      }
    }
    // When the actual Vocabulary action starts without saving any of its words.
    await start.click();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    const sessions = await client.reviewSessions();
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    if (session.mode.kind !== 'target_practice' || !session.encounter)
      throw new Error('Visible words must admit a canonical session with an encounter');
    expect(session.mode.items).toHaveLength(4);
    expect(session.mode.assistance).toEqual(['source']);
    expect(session.mode.items.every(item => item.capabilities.length > 0 && item.source?.sourceId === opened.source.id)).toBe(true);
    expect(session.encounter.conditions.assistance).toContain('source');
    expect(session.encounter).not.toHaveProperty('materialId');
    const key = session.encounter.targets[0]?.key;
    if (!key) throw new Error('Canonical source Practice must retain a Knowledge key');
    // Then restart keeps that encounter and return restores its exact selected source word.
    await backend.crashRestart();
    await page.reload();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    expect((await client.reviewSession(session.id)).encounter).toEqual(session.encounter);
    await page.getByRole('button', { name: 'Return to source', exact: true }).click();
    await expect(page.getByTestId('returned-source-selection')).toBeVisible();
    await page.goto(`/review?sessionId=${session.id}`);
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await page.getByRole('button', { name: 'Fluent', exact: true }).click();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    const evidence = await client.knowledgeEvidence({ key, after: null });
    expect(evidence.observations).toHaveLength(1);
    expect(evidence.observations[0].conditions.assistance).toContain('source');
    expect(evidence.projection.assessed).toBeNull();
    expect((await client.materials({ query: '', after: null, sourceId: null, includeExcluded: true })).items).toHaveLength(0);
    expect(backend.metadata().providerRequests).toBe(0);
  } finally {
    await backend.close();
  }
});
