/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createRuntimeBrowserClient } from '../../tools/runtime-browser-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';
import { builtInThemes, initialTheme } from '../../packages/theme/src/theme';

test('Inspector Practice retries its exact canonical admission with honest assistance and source return', async ({ page }, info) => {
  test.setTimeout(180_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('inspector-practice-profile') });
  const client = createRuntimeBrowserClient(backend);
  let entered = () => {};
  let release = () => {};
  const committed = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const starts: string[] = [];
  try {
    // Given a real unsaved source word and package-owned canonical support.
    await client.availablePackages();
    await client.installPackage(client.prepareInstall('org.mlearn.english'));
    const document = await client.openDocument(resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto(`/reader?id=${document.source.id}`);
    const inspector = page.getByTestId('inspector-panel');
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.reload();
      await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
      await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
      await page.getByRole('button', { name: 'Meaning', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Practice Meaning', exact: true })).toBeVisible();
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByRole('button', { name: 'Practice Meaning', exact: true })).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: info.outputPath(`inspector-practice-${theme.id}-${width}.png`) });
      }
    }
    await page.route(`${backend.url}/invoke`, async route => {
      const invocation = route.request().postDataJSON();
      const request = invocation.command === 'runtime_execute' ? JSON.parse(invocation.args.request) : null;
      if (request?.type !== 'review' || request.command.kind !== 'start') {
        await route.continue(); return;
      }
      starts.push(invocation.args.request);
      if (starts.length !== 1) { await route.continue(); return; }
      await route.fetch();
      entered();
      await held;
      await route.abort('failed');
    });
    // When native admission commits but the first receipt is lost.
    await page.getByRole('button', { name: 'Practice Meaning', exact: true }).click();
    await committed;
    await expect(page.getByText('Starting Word Practice…', { exact: true })).toBeVisible();
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByText('Starting Word Practice…', { exact: true })).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: info.outputPath(`inspector-practice-pending-${width}.png`) });
    }
    release();
    await expect(page.getByRole('button', { name: 'Retry practice', exact: true })).toBeVisible();
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('button', { name: 'Retry practice', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Dismiss practice retry', exact: true })).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: info.outputPath(`inspector-practice-retry-${width}.png`) });
    }
    await page.getByRole('button', { name: 'Retry practice', exact: true }).click();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    // Then retry recovers one exact session, never a save or an unassisted attempt.
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBe(starts[1]);
    const sessions = await client.reviewSessions();
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.mode.kind).toBe('target_practice');
    expect(session.encounter?.conditions.assistance).toEqual(['inspector']);
    expect(session.encounter?.source?.sourceId).toBe(document.source.id);
    expect(session.encounter).not.toHaveProperty('materialId');
    const key = session.encounter?.targets[0]?.key;
    if (!key) throw new Error('Canonical Practice must retain its tested Knowledge key');
    expect(session.encounter?.targets).toHaveLength(1);
    expect(key.capability).toBe('org.mlearn.english:meaning');
    expect((await client.materials({ query: '', after: null, sourceId: null, includeExcluded: true })).items).toHaveLength(0);
    await backend.crashRestart();
    await page.reload();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    expect((await client.reviewSession(session.id)).encounter).toEqual(session.encounter);
    await page.getByRole('button', { name: 'Return to source', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/reader\\?.*reviewSessionId=${session.id}`));
    await expect(page.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
    await page.goto(`/review?sessionId=${session.id}`);
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await page.getByRole('button', { name: 'Fluent', exact: true }).click();
    await expect(page.getByTestId('review-rating')).toHaveCount(0);
    const evidence = await client.knowledgeEvidence({ key, after: null });
    expect(evidence.projection.assessed).toBeNull();
    expect(evidence.observations).toHaveLength(1);
    expect(evidence.observations[0].conditions.assistance).toContain('inspector');
    expect(evidence.observations[0].conditions.assistance).toContain('source');
    expect(backend.metadata().providerRequests).toBe(0);
  } finally {
    release();
    await backend.close();
  }
});

test('enlarged source Inspector keeps focused Practice readable in short viewports', async ({ page }, info) => {
  test.setTimeout(90_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('readability-profile') });
  const client = createRuntimeBrowserClient(backend);
  try {
    await client.availablePackages();
    await client.installPackage(client.prepareInstall('org.mlearn.english'));
    const path = info.outputPath('long-word.txt');
    await writeFile(path, 'These flowers are zygomorphous.');
    const document = await client.openDocument(path, 'org.mlearn.english');
    await attachRuntimeBrowserQa(page, backend.url);
    // Fractional theme spacing must not leave a focused action clipped by a pixel.
    for (const theme of [...builtInThemes, {
      ...initialTheme, id: 'qa.fractional-spacing', name: 'Fractional spacing', spacingScale: 1.01,
    }]) {
      await client.saveTheme({ ...theme, textScale: 2 }, (await client.snapshot()).revision);
      for (const width of [390, 1080]) {
        await page.setViewportSize({ width, height: 560 });
        await page.goto(`/reader?id=${document.source.id}`);
        const word = page.getByRole('button', { name: 'zygomorphous: untracked', exact: true });
        await word.click();
        const inspector = page.getByTestId('inspector-panel');
        const knowledge = inspector.getByRole('button', { name: /^Knowledge:/ });
        await knowledge.click();
        const practice = inspector.getByRole('button', { name: /^Practice / });
        await practice.focus();
        await expect(practice).toBeInViewport({ ratio: 1 });
        await practice.click({ trial: true });
        await page.screenshot({ path: info.outputPath(`readable-practice-${theme.id}-${width}.png`) });
        await page.keyboard.press('Escape');
        await expect(knowledge).toBeFocused();
        for (const action of await page.getByTestId('inspector-footer').getByRole('button').all()) {
          await expect(action).toBeEnabled();
          await action.focus();
          await expect(action).toBeInViewport({ ratio: 1 });
        }
        await page.screenshot({ path: info.outputPath(`readable-footer-${theme.id}-${width}.png`) });
        await page.keyboard.press('Escape');
        await expect(inspector).toHaveCount(0);
        await expect(word).toBeFocused();
      }
    }
    expect(backend.metadata().providerRequests).toBe(0);
  } finally {
    await backend.close();
  }
});
