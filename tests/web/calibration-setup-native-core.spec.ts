/// <reference types="node" />
import { test, expect, type Locator } from '@playwright/test';
import { createRuntimeBrowserClient } from '../../tools/runtime-browser-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';
import { builtInThemes } from '../../packages/theme/src/theme';

test('Word Sync keeps its primary setup action visible and retains optional scope edits', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('compact-setup-profile') });
  const client = createRuntimeBrowserClient(backend);
  try {
    await client.availablePackages();
    await client.installPackage(client.prepareInstall('org.mlearn.english'));
    await attachRuntimeBrowserQa(page, backend.url);
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.goto('/review?activity=calibration&packageId=org.mlearn.english');
      const start = page.getByRole('button', { name: 'Start Word Sync', exact: true });
      const options = page.getByRole('button', { name: 'Scope options', exact: true });
      await expect(start).toBeEnabled();
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(start).toBeInViewport({ ratio: 1 });
        const back = await page.getByRole('button', { name: 'Back to Review', exact: true }).boundingBox();
        const heading = await page.getByRole('heading', { name: 'Word Sync', exact: true }).boundingBox();
        if (!back || !heading) throw new Error('Word Sync navigation has no visible bounds');
        expect(heading.y + heading.height / 2).toBeGreaterThanOrEqual(back.y);
        expect(heading.y + heading.height / 2).toBeLessThanOrEqual(back.y + back.height);
        await expect(options).toHaveAttribute('aria-expanded', 'false');
        await page.screenshot({ path: info.outputPath(`compact-setup-${theme.id}-${width}.png`) });
        await options.click();
        const scope = page.getByRole('textbox', { name: 'Scope text', exact: true });
        const limit = page.getByRole('textbox', { name: 'Maximum targets', exact: true });
        await scope.fill('Past simple negative');
        await limit.fill('3');
        await options.click();
        await expect(scope).toBeHidden();
        await expect(page.getByText('Past simple negative · up to 3 unmeasured targets', { exact: true })).toBeVisible();
        await expect(start).toBeInViewport({ ratio: 1 });
        await options.click();
        await expect(scope).toHaveValue('Past simple negative');
        await expect(limit).toHaveValue('3');
        await page.screenshot({ path: info.outputPath(`expanded-setup-${theme.id}-${width}.png`) });
        await options.click();
      }
    }
    await page.getByRole('button', { name: 'More destinations', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Home', exact: true }).click();
    await expect(page.getByTestId('home-open-review')).toBeVisible();
    expect(await client.reviewSessions()).toEqual([]);
    expect(backend.metadata().providerRequests).toBe(0);
  } finally {
    await backend.close();
  }
});

test('Word Sync setup preserves exact scope through empty cancellation and uncertain admission', async ({ page }, info) => {
  test.setTimeout(300_000);
  const backend = await startRuntimeBrowserQa({
    profile: process.env.MLEARN_CALIBRATION_QA_PROFILE ?? info.outputPath('setup-profile'),
  });
  const client = createRuntimeBrowserClient(backend);
  const packageId = 'org.mlearn.english';
  const targetId = `${packageId}:grammar/past-simple-negative`;
  const capability = `${packageId}:grammar-form`;
  let readBehavior: 'normal' | 'hold' | 'fail' = 'normal';
  let readEntered = () => {};
  let releaseRead = () => {};
  const entered = new Promise<void>(resolve => { readEntered = resolve; });
  const held = new Promise<void>(resolve => { releaseRead = resolve; });
  const starts: string[] = [];
  const capture = async (name: string, control?: Locator) => {
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (control) await control.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`) });
    }
  };
  try {
    // Given the actual Home entry and package-owned setup, not a renderer task fixture.
    await client.availablePackages();
    if (!(await client.snapshot()).installedPlugins.some(item => item.id === packageId))
      await client.installPackage(client.prepareInstall(packageId));
    const previousIds = new Set((await client.reviewSessions()).map(session => session.id));
    await attachRuntimeBrowserQa(page, backend.url);
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.goto('/');
      await expect(page.getByTestId('home-open-read')).toBeEnabled();
      await capture(`calibration-home-${theme.id}`, page.getByTestId('home-open-review'));
      await page.getByTestId('home-open-review').click();
      await expect(page.getByRole('button', { name: 'Word Sync', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Word Sync', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Word Sync', exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: /^Word Sync capability:/ })).toBeEnabled();
      await capture(`calibration-setup-${theme.id}`);
    }
    const catalog = await client.collection({ packageId, surface: 'knowledge',
      filter: { kind: 'all', filters: [] }, sort: 'default', after: null });
    if (catalog.state !== 'ready')
      expect((await client.prepareCollectionCatalog(client.prepareCollection(packageId))).phase).toBe('succeeded');
    await page.getByRole('combobox', { name: /^Word Sync capability:/ }).click();
    await page.getByRole('option', { name: 'Grammar formation', exact: true }).click();
    await page.getByRole('button', { name: 'Scope options', exact: true }).click();
    const scope = page.getByRole('textbox', { name: 'Scope text', exact: true });
    const bound = page.getByRole('textbox', { name: 'Maximum targets', exact: true });
    const start = page.getByRole('button', { name: 'Start Word Sync', exact: true });
    await bound.fill('0');
    await expect(start).toBeDisabled();
    await bound.fill('2');
    await scope.fill('no-match-for-this-original-calibration-fixture');
    await start.click();
    await expect(page.getByTestId('calibration-empty')).toBeVisible();
    await capture('calibration-empty');
    expect((await client.reviewSessions()).map(session => session.id)).toEqual([...previousIds]);
    await scope.fill('Past simple negative');

    await page.route(`${backend.url}/invoke`, async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      const invocation = route.request().postDataJSON();
      const request = typeof invocation.args?.request === 'string' ? JSON.parse(invocation.args.request) : null;
      if (invocation.command === 'execute_bounded_read' && request?.type === 'prepare_calibration') {
        const behavior = readBehavior;
        readBehavior = 'normal';
        if (behavior === 'hold') { readEntered(); await held; }
        if (behavior === 'fail') { await route.abort('failed'); return; }
      }
      if (invocation.command === 'runtime_execute' && request?.type === 'review'
        && request.command.kind === 'start' && request.command.start.mode.kind === 'calibration') {
        starts.push(invocation.args.request);
        if (starts.length === 1) {
          await route.fetch();
          await route.abort('failed');
          return;
        }
      }
      await route.continue();
    });
    // When selection is cancelled, its registered native slot must drain before reuse.
    readBehavior = 'hold';
    await start.click();
    await entered;
    await capture('calibration-selection-pending');
    const cancelled = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
      && response.request().method() === 'POST'
      && response.request().postDataJSON().command === 'cancel_bounded_read');
    await page.getByRole('button', { name: 'Cancel selection', exact: true }).click();
    await cancelled;
    releaseRead();
    await expect(page.getByTestId('calibration-cancelled')).toBeVisible();
    await expect(start).toBeEnabled();
    expect((await client.reviewSessions()).map(session => session.id)).toEqual([...previousIds]);

    // A transport failure is explicit and retry does not invent a session.
    readBehavior = 'fail';
    await start.click();
    const retrySelection = page.getByRole('button', { name: 'Retry selection', exact: true });
    await expect(retrySelection).toBeVisible();
    await capture('calibration-selection-error');
    expect((await client.reviewSessions()).map(session => session.id)).toEqual([...previousIds]);
    await retrySelection.click();
    const retryStart = page.getByRole('button', { name: 'Retry Review save', exact: true });
    await expect(retryStart).toBeVisible();
    await expect(page.getByText('Starting Word Sync...', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Saving Word Sync...', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Past simple negative · up to 2 unmeasured targets', { exact: true })).toBeVisible();
    await capture('calibration-start-retry');
    const admitted = (await client.reviewSessions()).filter(session => !previousIds.has(session.id));
    expect(admitted).toHaveLength(1);
    const original = admitted[0];
    if (!original || original.mode.kind !== 'calibration') throw new Error('Expected the exact native calibration admission');
    expect(original.mode.items.map(item => item.targetId)).toEqual([targetId]);
    expect(original.mode.query.capability).toBe(capability);
    expect(original.mode.query.limit).toBe(2);
    await retryStart.click();
    await expect(page.getByTestId('review-cue')).toBeVisible();

    // Then one exact durable intent and its saved route survive native restart.
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBe(starts[0]);
    await expect(page).toHaveURL(new RegExp(`sessionId=${original.id}`));
    await backend.crashRestart();
    await page.reload();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    const restored = await client.reviewSession(original.id);
    expect(restored.mode).toEqual(original.mode);
    expect(restored.encounter).toEqual(original.encounter);
    expect((await client.materials({ query: '', after: null, sourceId: null, includeExcluded: true })).items).toEqual([]);
    expect(backend.metadata().providerRequests).toBe(0);
    await page.getByRole('textbox', { name: 'Your response', exact: true }).fill('did not fold');
    const captured = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
      && response.request().method() === 'POST'
      && response.request().postDataJSON().command === 'execute_review_validation');
    await page.getByRole('button', { name: 'Check response', exact: true }).click();
    await captured;
    await expect(page.getByRole('button', { name: 'Check response', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    await page.getByRole('button', { name: 'All Fluent', exact: true }).click();
    await expect(page.getByTestId('review-cue')).toHaveCount(0);
    const recorded = await client.knowledgeEvidence({ key: { packageId, targetId, capability }, after: null });
    expect(recorded.observations.find(item => item.sessionId === original.id)?.purpose).toBe('calibration');
    await page.goto(`/knowledge?packageId=${packageId}`);
    const search = page.getByRole('textbox', { name: 'Search Knowledge', exact: true });
    await search.fill('Past simple negative');
    await search.press('Enter');
    await page.getByTestId(`knowledge-target-${targetId}`).getByText('Past simple negative', { exact: true }).click();
    await page.getByRole('button', { name: /^Knowledge:/ }).click();
    await page.getByRole('button', { name: 'Inspect evidence', exact: true }).click();
    const evidence = page.getByTestId('knowledge-evidence');
    await expect(evidence).toBeVisible();
    const purpose = evidence.getByText(/ · Word Sync/).first();
    await expect(purpose).toBeVisible();
    await capture('calibration-evidence', purpose);
  } finally {
    releaseRead();
    await backend.close();
  }
});
