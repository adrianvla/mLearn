/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { builtInThemes } from '../../packages/theme/src/theme';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

test('Inspector graph refreshes native claims without transferring Knowledge or losing its source', async ({ page }, info) => {
  test.setTimeout(180_000);
  const backend = await startRuntimeBrowserQa({
    profile: info.outputPath('native-profile'),
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  const packageId = 'org.mlearn.english';
  try {
    // Given an actual package analysis, source-selected Inspector and saved
    // Material, not a fabricated graph or a renderer-owned Knowledge fixture.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const document = await client.openDocument(resolve('tests/fixtures/reader/graph-navigation.txt'), packageId);
    await page.goto(`/reader?id=${document.source.id}`);
    const trigger = page.getByRole('button', { name: 'run: untracked', exact: true });
    await trigger.click();
    const inspector = page.getByTestId('inspector-panel');
    await inspector.getByRole('button', { name: 'Capture run', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Open saved run: revision 1', exact: true })).toBeVisible();
    const materials = await client.materials({
      after: null, query: '', sourceId: document.source.id, includeExcluded: true,
    });
    expect(materials.items).toHaveLength(1);
    const targetId = materials.items[0].content.targetId;
    if (!targetId) throw new Error('Native capture did not retain its inspected target');
    const description = await client.describeLanguage(packageId);
    const capability = description.capabilities.find(value => value.id === description.annotationCapability);
    if (!capability) throw new Error('Native package has no annotation capability label');
    const root = await client.inspectTarget(packageId, targetId, null);
    const first = await client.graphNeighborhood({
      packageId, targetId, expectedRevision: root.packageRevision, after: null,
    });
    expect(first.connections).toHaveLength(16);
    expect(first.next).not.toBeNull();
    const related = first.connections.find(value => value.entity.targetId !== null
      && value.entity.targetId !== targetId);
    if (!related?.entity.targetId) throw new Error('Native graph has no distinct inspectable target');
    await inspector.getByRole('button', { name: 'Linguistic relationships', exact: true }).click();
    const graph = inspector.getByTestId('graph-details');
    await expect(graph.getByTestId('graph-relation')).toHaveCount(first.connections.length);

    // When the same Inspector commits a real claim, its already-open graph
    // must refresh automatically, rather than keeping its earlier native page.
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: capability.label, exact: true }).click();
    await inspector.getByRole('button', { name: `Claim ${capability.label} known`, exact: true }).click();
    await expect(inspector.getByText(`${capability.label} · claimed known`, { exact: true })).toBeVisible();
    await expect(graph.getByText(`${capability.label}: claimed known`, { exact: true })).toHaveCount(1);
    const changed = await client.graphNeighborhood({
      packageId, targetId, expectedRevision: root.packageRevision, after: null,
    });
    expect(changed.knowledge.find(value => value.key.targetId === targetId
      && value.key.capability === capability.id)?.claim).toBe(true);
    expect(changed.knowledge.filter(value => value.key.targetId !== targetId)
      .every(value => value.claim === null)).toBe(true);
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();

    // Then deeper inspection and Return preserve the source/active target
    // distinction, and restarting the native host retains only the root claim.
    await graph.getByRole('button', {
      name: `Inspect ${related.entity.label} target ${related.entity.targetId}`, exact: true,
    }).first().click();
    await expect(inspector.getByRole('button', { name: 'Return to source entry', exact: true })).toBeFocused();
    await expect(inspector.getByRole('button', { name: 'Knowledge: Untracked', exact: true })).toBeVisible();
    await expect(inspector.getByText('Source selection: run', { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Return to source entry', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Linguistic relationships', exact: true })).toBeFocused();
    await expect(graph.getByText(`${capability.label}: claimed known`, { exact: true })).toHaveCount(1);
    await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    await expect(page.getByRole('button', { name: /^run:/ })).toBeFocused();
    await backend.crashRestart();
    const reopened = await client.inspectTarget(packageId, targetId, root.packageRevision);
    expect(reopened.knowledge.projections.find(value => value.key.capability === capability.id)?.claim).toBe(true);
    const sibling = await client.inspectTarget(packageId, related.entity.targetId, root.packageRevision);
    expect(sibling.knowledge.projections.every(value => value.claim === null)).toBe(true);
    expect((await client.materials({
      after: null, query: '', sourceId: document.source.id, includeExcluded: true,
    })).items[0].content).toMatchObject({
      targetId, phrase: 'run', source: { sourceId: document.source.id },
    });
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.goto(`/reader?id=${document.source.id}`);
      await page.getByRole('button', { name: `run: ${reopened.knowledge.claim}`, exact: true }).click();
      await inspector.getByRole('button', { name: 'Linguistic relationships', exact: true }).click();
      await expect(graph.getByText(`${capability.label}: claimed known`, { exact: true })).toHaveCount(1);
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await graph.evaluate(element => element.scrollIntoView({ block: 'start' }));
        await expect(graph.getByRole('button', { name: 'Graph sources', exact: true })).toBeInViewport();
        await expect(graph.getByText(`Entity: ${first.entity.id}`, { exact: false })).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`graph-${theme.id}-${width}-top.png`) });
        await graph.getByRole('button', { name: 'Graph sources', exact: true }).click();
        const identity = graph.getByText(`Entity: ${first.entity.id}`, { exact: false });
        await identity.scrollIntoViewIfNeeded();
        await expect(identity).toBeVisible();
        await page.screenshot({ path: info.outputPath(`graph-${theme.id}-${width}-sources.png`) });
        await graph.getByRole('button', { name: 'Graph sources', exact: true }).click();
        await graph.getByRole('button', { name: 'Next relations', exact: true }).scrollIntoViewIfNeeded();
        await expect(graph.getByRole('button', { name: 'Next relations', exact: true })).toBeInViewport();
        const bounds = await inspector.boundingBox();
        if (!bounds) throw new Error('Inspector has no rendered bounds');
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath(`graph-${theme.id}-${width}.png`) });
      }
      await page.keyboard.press('Escape');
      await expect(inspector).toHaveCount(0);
    }
  } finally {
    await backend.close();
  }
});

test('packaged characters retain their identity from Knowledge through Material and scheduled Review', async ({ page }, info) => {
  test.setTimeout(900_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('character-profile') });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  const packageId = 'org.mlearn.japanese';
  const targetId = 'kanjidic:6a4b';
  const failures: unknown[] = [];
  try {
    // Given the authenticated, pinned package and a freshly prepared real
    // catalog, all character data and capabilities come from that package.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*Japanese/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*Japanese/ })).toBeVisible();
    const description = await client.describeLanguage(packageId);
    const kind = description.catalog?.kinds.find(value => value.id === `${packageId}:character`);
    if (!kind) throw new Error('The pinned Japanese package does not declare its character catalog');
    await page.goto(`/knowledge?packageId=${packageId}`);
    const preparationStarted = performance.now();
    // Full-package ingestion is a cold setup operation, not a UI publication
    // deadline: the retained native baseline already takes 278s for JMdict.
    // Subscribe before admission and retain the unchanged visible-count check
    // after the real native receipt, without sleeping or polling for progress.
    const [preparationResponse] = await Promise.all([
      page.waitForResponse(response => {
        if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST')
          return false;
        const envelope: unknown = response.request().postDataJSON();
        if (envelope === null || typeof envelope !== 'object' || !('args' in envelope))
          return false;
        const args = envelope.args;
        if (args === null || typeof args !== 'object' || !('request' in args) || typeof args.request !== 'string')
          return false;
        const request: unknown = JSON.parse(args.request);
        return request !== null && typeof request === 'object'
          && 'type' in request && request.type === 'prepare_collection';
      }, { timeout: 720_000 }),
      page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true }).click(),
    ]);
    expect(preparationResponse.ok()).toBe(true);
    await expect(page.getByText('232031 entries', { exact: true })).toBeVisible({ timeout: 120_000 });
    await info.attach('character-catalog.json', {
      body: JSON.stringify({ packageId, preparationMs: performance.now() - preparationStarted }),
      contentType: 'application/json',
    });
    const bridge = await client.inspectTarget(packageId, targetId, null);
    const nativeGraph = await client.graphNeighborhood({
      packageId, targetId: bridge.entry.targetId, expectedRevision: bridge.packageRevision, after: null,
    });
    expect(nativeGraph.connections.length).toBeGreaterThan(0);

    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/knowledge?packageId=${packageId}`);
        await page.getByRole('combobox', { name: /^Knowledge entity kind:/ }).click();
        await page.getByRole('option', { name: kind.label, exact: true }).click();
        await expect(page.getByText('13108 entries', { exact: true })).toBeVisible();
        await page.getByRole('combobox', { name: /^Knowledge layout:/ }).click();
        await page.getByRole('option', { name: 'Grid', exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath(`characters-${theme.id}-${width}-grid.png`) });
        await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).fill('橋');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        const trigger = page.getByRole('button', { name: /^橋:/ });
        await trigger.click();
        const inspector = page.getByTestId('inspector-panel');
        await inspector.getByRole('button', { name: 'Linguistic relationships', exact: true }).click();
        const graph = inspector.getByTestId('graph-details');
        await expect(graph.getByTestId('graph-relation')).toHaveCount(nativeGraph.connections.length);
        await expect(graph.getByRole('button', { name: /^Inspect / })).toHaveCount(
          nativeGraph.connections.filter(value => value.entity.targetId !== null).length,
        );
        await graph.getByTestId('graph-relation').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`characters-${theme.id}-${width}-graph.png`) });
        await graph.evaluate(element => element.scrollIntoView({ block: 'start' }));
        await graph.getByRole('button', { name: 'Graph sources', exact: true }).click();
        await expect(graph.getByText(`Entity: ${nativeGraph.entity.id}`, { exact: false })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`characters-${theme.id}-${width}-sources.png`) });
        await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();
        await expect(trigger).toBeFocused();
      }
    }

    // When a learner captures one character, the ordinary Material and Review
    // UI must consume that exact target, not a same-spelled dictionary entry.
    await page.getByRole('combobox', { name: /^Knowledge layout:/ }).click();
    await page.getByRole('option', { name: 'List', exact: true }).click();
    await page.getByRole('button', { name: /^橋:/ }).click();
    const inspector = page.getByTestId('inspector-panel');
    await inspector.getByRole('button', { name: 'Capture 橋', exact: true }).click();
    const saved = inspector.getByRole('button', { name: /^Open saved 橋/ });
    await expect(saved).toBeVisible();
    const materials = await client.materials({ after: null, query: '', sourceId: null, includeExcluded: true });
    expect(materials.items).toHaveLength(1);
    const material = materials.items[0];
    if (!material) throw new Error('Character capture did not retain its Material');
    expect(material.content).toMatchObject({ packageId, targetId, phrase: '橋', source: null });
    await saved.click();
    await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByTestId('home-open-review').click();
    await page.getByRole('textbox', { name: 'Finite Review limit', exact: true }).fill('1');
    await page.getByRole('button', { name: 'Start finite Review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible();
    const started = (await client.reviewSessions())[0];
    if (!started) throw new Error('Scheduled character Review did not retain its session');
    expect(started.state).toBe('active');
    if (started.encounter === null) {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(page.getByTestId('review-cue')).toBeVisible();

    // Then the genuine package probe is bound to the captured Material, and
    // interruption/restart resumes its original encounter without a new claim.
    const session = await client.reviewSession(started.id);
    if (!session.encounter) throw new Error('Scheduled character Review did not admit an encounter');
    expect(session.mode.kind).toBe('finite');
    expect(session.encounter.materialId).toBe(material.id);
    expect(session.encounter.packageId).toBe(packageId);
    expect(session.encounter.source).toBeNull();
    expect(session.encounter.targets.some(value => value.key?.targetId === targetId)).toBe(true);
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    await expect(page.getByTestId('review-cue')).toContainText('橋');
    await page.screenshot({ path: info.outputPath('character-scheduled-review.png') });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByText('Review paused', { exact: true })).toBeVisible();
    await backend.crashRestart();
    await page.reload();
    await expect(page.getByText('Review paused', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    const resumed = await client.reviewSession(session.id);
    expect(resumed.encounter?.id).toBe(session.encounter.id);
    expect(resumed.encounter?.materialId).toBe(material.id);
    expect((await client.inspectTarget(packageId, targetId, null)).knowledge.projections
      .every(value => value.claim === null)).toBe(true);
    expect(backend.metadata().providerRequests).toBe(0);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByText('Review paused', { exact: true })).toBeVisible();
  } catch (error) {
    failures.push(error);
  } finally {
    // A failed UI assertion must not leave its real preparation running or
    // have its original error replaced by the native shutdown deadline.
    try {
      const preparation = await client.currentCollectionPreparation();
      if (preparation?.phase === 'preparing' || preparation?.phase === 'cancelling')
        await client.cancelCollectionPreparation(preparation.command.commandId);
    } catch (error) {
      failures.push(error);
    }
    try {
      await backend.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Character workflow and native cleanup failed', { cause: failures[0] });
});
