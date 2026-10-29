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
