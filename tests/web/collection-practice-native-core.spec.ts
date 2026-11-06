/// <reference types="node" />
import { test, expect } from '@playwright/test';
import type { CollectionQuery } from '@mlearn/contracts';
import { createRuntimeBrowserClient } from '../../tools/runtime-browser-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';
import { builtInThemes } from '../../packages/theme/src/theme';
import { selectionAction } from './collection-actions';

test('frozen collection Practice survives live filter changes, lost receipts, restart and explicit Stop', async ({ page }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const backend = await startRuntimeBrowserQa({
    profile: process.env.MLEARN_COLLECTION_QA_PROFILE ?? info.outputPath('collection-practice-profile'),
  });
  const client = createRuntimeBrowserClient(backend);
  const packageId = 'org.mlearn.english';
  const capability = `${packageId}:meaning`;
  let entered = () => {};
  let release = () => {};
  let releaseEnd = () => {};
  const committed = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const starts: string[] = [];
  const capture = async (name: string, control = page.getByTestId('review-cue')) => {
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`) });
    }
  };
  try {
    // Given the actual authenticated package/catalog, not a renderer corpus fixture.
    await client.availablePackages();
    if (!(await client.snapshot()).installedPlugins.some(value => value.id === packageId))
      await client.installPackage(client.prepareInstall(packageId));
    const query: CollectionQuery = { packageId, surface: 'knowledge', sort: 'default', after: null,
      filter: { kind: 'capability', capability, states: ['untracked'] } };
    if ((await client.collection(query)).state !== 'ready')
      expect((await client.prepareCollectionCatalog(client.prepareCollection(packageId))).phase).toBe('succeeded');
    const previousSessions = await client.reviewSessions();
    const previousIds = new Set(previousSessions.map(value => value.id));
    const selection = await client.createCollectionSelection(client.prepareCollectionSelection({ kind: 'matching', query }));
    expect(selection.targetCount).toBeGreaterThan(128);
    const window = await client.collectionSelectionPage(selection.id);
    expect(window.items.length).toBeLessThanOrEqual(64);
    const [first, second] = window.items;
    if (!first || !second || first.item.kind !== 'target' || second.item.kind !== 'target')
      throw new Error('Actual frozen Knowledge scope must contain canonical targets');
    const firstKey = { packageId, targetId: first.item.targetId, capability };
    const previousAttempts = new Set((await client.knowledgeEvidence({ key: firstKey, after: null }))
      .observations.map(value => value.attemptId));
    await client.changeClaim(client.prepareClaim({ packageId, targetId: second.item.targetId, capability }, true));
    const changed = await client.collection(query);
    if (changed.state !== 'ready') throw new Error('Actual live collection must remain readable');
    expect(changed.page.count).toBe(selection.targetCount - 1);
    // Unsupported task directions remain errors, never due work or observations.
    await expect(client.review(client.prepareReviewStart({ kind: 'collection_practice',
      selectionId: selection.id, capabilities: [`${packageId}:listening`] }))).rejects.toThrow();
    expect((await client.reviewSessions()).map(value => value.id)).toEqual(previousSessions.map(value => value.id));
    await attachRuntimeBrowserQa(page, backend.url);
    const start = page.getByRole('button', { name: 'Practice selected targets', exact: true });
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.goto(`/knowledge?packageId=${packageId}`);
      await page.reload();
      await page.getByRole('button', { name: 'Select items', exact: true }).click();
      await selectionAction(page, 'Saved selections');
      await page.getByRole('combobox', { name: /^Retained selection:/ }).click();
      const retainedIndex = (await client.collectionSelections()).findIndex(value => value.id === selection.id) + 1;
      await page.getByRole('option', { name: new RegExp(`^${retainedIndex}: ${selection.targetCount} items`) }).click();
      await page.getByRole('combobox', { name: /^Practice capability:/ }).click();
      await page.getByRole('option', { name: 'Meaning', exact: true }).click();
      await expect(start).toBeEnabled();
      await capture(`collection-scope-${theme.id}`, start);
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
    // When the first native receipt is lost and the live UI query changes.
    await start.click();
    await committed;
    await capture('collection-pending', page.getByText('Starting selected Practice…', { exact: true }));
    release();
    const retry = page.getByRole('button', { name: 'Retry selected Practice', exact: true });
    await expect(retry).toBeVisible();
    await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).fill('bridge');
    await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).press('Enter');
    await capture('collection-retry', retry);
    await retry.click();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    // Then the exact original command/scope survives, without a Material save.
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBe(starts[1]);
    const sessions = (await client.reviewSessions()).filter(value => !previousIds.has(value.id));
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.mode).toEqual({ kind: 'collection_practice', selectionId: selection.id, capabilities: [capability] });
    expect(session.encounter).toMatchObject({ targetId: first.item.targetId });
    expect(session.encounter?.conditions.assistance).toContain('source');
    expect(session.total).toBeNull();
    expect((await client.collectionSelections()).find(value => value.id === selection.id)?.inUse).toBe(true);
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.reload();
      await capture(`collection-active-${theme.id}`);
    }
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByText('Word Practice paused', { exact: true })).toBeVisible();
    await backend.crashRestart();
    await page.reload();
    await expect(page.getByText('Word Practice paused', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    expect((await client.reviewSession(session.id)).encounter).toEqual(session.encounter);
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    const advanced = page.waitForResponse(response => {
      if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
      const invocation = response.request().postDataJSON();
      return invocation.command === 'runtime_execute'
        && JSON.parse(invocation.args.request).command?.kind === 'next';
    });
    await page.getByRole('button', { name: 'Fluent', exact: true }).click();
    await advanced;
    const next = await client.reviewSession(session.id);
    expect(next.completed).toBe(1);
    expect(next.encounter).toMatchObject({ targetId: second.item.targetId });
    expect(next.mode).toEqual(session.mode);
    const evidence = await client.knowledgeEvidence({ key: firstKey, after: null });
    const observations = evidence.observations.filter(value => !previousAttempts.has(value.attemptId));
    expect(observations).toHaveLength(1);
    expect(evidence.projection.assessed).toBeNull();
    expect(observations[0].conditions.assistance).toContain('source');
    let lostNext = false;
    await page.route(`${backend.url}/invoke`, async route => {
      const invocation = route.request().postDataJSON();
      const request = invocation.command === 'runtime_execute' ? JSON.parse(invocation.args.request) : null;
      if (lostNext || request?.type !== 'review' || request.command.kind !== 'next') {
        await route.continue(); return;
      }
      lostNext = true;
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await page.getByRole('button', { name: 'Fluent', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry Review save', exact: true })).toBeVisible();
    const afterLoss = await client.reviewSession(session.id);
    expect(afterLoss.completed).toBe(2);
    expect(afterLoss.encounter).not.toBeNull();
    const end = page.getByRole('button', { name: 'End Practice', exact: true });
    await capture('collection-next-receipt-error', end);
    await expect(end).toBeEnabled();
    let endEntered = () => {};
    const ending = new Promise<void>(resolve => { endEntered = resolve; });
    const endHeld = new Promise<void>(resolve => { releaseEnd = resolve; });
    let stopRevision: number | null = null;
    await page.route(`${backend.url}/invoke`, async route => {
      const invocation = route.request().postDataJSON();
      const request = invocation.command === 'runtime_execute' ? JSON.parse(invocation.args.request) : null;
      if (request?.type !== 'review' || request.command.kind !== 'stop') {
        await route.continue(); return;
      }
      stopRevision = request.command.mutation.expectedRevision;
      const response = await route.fetch();
      endEntered();
      await endHeld;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'End Practice', exact: true }).click();
    await ending;
    expect(stopRevision).toBe(afterLoss.revision);
    await expect(page.getByTestId('review-cue')).toHaveCount(0);
    await capture('collection-ending-pending', page.getByText('Saving Word Practice…', { exact: true }));
    releaseEnd();
    await expect(page.getByText('Word Practice ended', { exact: true })).toBeVisible();
    const stopped = await client.reviewSession(session.id);
    expect(stopped).toMatchObject({ state: 'stopped', completed: 2, total: null, encounter: null });
    expect((await client.collectionSelections()).find(value => value.id === selection.id)?.inUse).toBe(false);
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.reload();
      await capture(`collection-stopped-${theme.id}`, page.getByText('Word Practice ended', { exact: true }));
    }
    await client.releaseCollectionSelection(selection.id);
    if (previousSessions[0])
      expect(await client.reviewSession(previousSessions[0].id)).toEqual(previousSessions[0]);
    expect((await client.materials({ query: '', after: null, sourceId: null, includeExcluded: true })).items).toHaveLength(0);
    expect(backend.metadata().providerRequests).toBe(0);
  } finally {
    release();
    releaseEnd();
    await backend.close();
  }
});
