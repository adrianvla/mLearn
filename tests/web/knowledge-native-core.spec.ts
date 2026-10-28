/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { CollectionQuery } from '@mlearn/contracts';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

// Real Rust, signed package, catalog, Knowledge and Material storage. Only the
// host transport is adapted; native window/media/clipboard are not claimed.
test('bounded Knowledge browsing captures source-free Material and preserves claims across restart', async ({ page }, info) => {
  test.setTimeout(300_000);
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/knowledge-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID,
    execute: request => backend.invoke('runtime_execute', { request }),
  });
  const packageId = 'org.mlearn.english';
  const query: CollectionQuery = { packageId, surface: 'knowledge', filter: { kind: 'all', filters: [] }, sort: 'default', after: null };
  try {
    // Given: an installed real package with no derived collection or learner data.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    const prepare = page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true });
    await expect(prepare).toBeVisible();
    await page.screenshot({ path: info.outputPath('knowledge-prepare-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(prepare).toBeInViewport();
    await page.screenshot({ path: info.outputPath('knowledge-prepare-phone.png') });
    await page.setViewportSize({ width: 1080, height: 900 });
    const prepared = page.waitForResponse(response => {
      if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
      const payload = response.request().postDataJSON();
      return typeof payload.args?.request === 'string' && JSON.parse(payload.args.request).type === 'prepare_collection';
    }, { timeout: 240_000 });
    const [preparationReceipt] = await Promise.all([prepared, prepare.click()]);
    expect(preparationReceipt.ok()).toBe(true);
    const first = await client.collection(query);
    if (first.state !== 'ready') throw new Error('Actual package collection was not prepared');
    const entries = first.page.items.flatMap(item => item.kind === 'target' ? [item.target] : []);
    expect(entries).toHaveLength(24);
    expect(first.page.next).not.toBeNull();
    await expect(page.getByText(`${first.page.count} entries`, { exact: true })).toBeVisible();
    for (const entry of entries)
      await expect(page.getByTestId(`knowledge-target-${entry.summary.targetId}`)
        .getByRole('button', { name: `${entry.summary.headword}: untracked`, exact: true })).toBeAttached();
    const language = await client.describeLanguage(packageId);
    const capability = language.capabilities.find(item => item.id === language.annotationCapability);
    if (!capability) throw new Error('Package annotation capability has no label');

    // When: the user pages, inspects an entry, claims its package-selected
    // capability and captures it through the existing Inspector.
    await page.getByRole('button', { name: 'Next Knowledge page', exact: true }).click();
    const second = await client.collection({ ...query, after: first.page.next });
    if (second.state !== 'ready') throw new Error('Next native collection page was not ready');
    const next = second.page.items.flatMap(item => item.kind === 'target' ? [item.target] : []);
    expect(new Set([...entries, ...next].map(entry => entry.summary.targetId)).size).toBe(48);
    for (const entry of next)
      await expect(page.getByTestId(`knowledge-target-${entry.summary.targetId}`)
        .getByRole('button', { name: `${entry.summary.headword}: untracked`, exact: true })).toBeAttached();
    const inspector = page.getByTestId('inspector-panel');
    await page.getByTestId(`knowledge-target-${next[0].summary.targetId}`).getByRole('button').click();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: capability.label, exact: true }).click();
    await inspector.getByRole('button', { name: `Claim ${capability.label} known`, exact: true }).click();
    await expect(inspector.getByText(`${capability.label} · claimed known`, { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'First Knowledge page', exact: true })).toBeDisabled();
    const target = entries[0];
    const word = page.getByTestId(`knowledge-target-${target.summary.targetId}`)
      .getByRole('button', { name: `${target.summary.headword}: untracked`, exact: true });
    await word.click();
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Explain', exact: true })).toHaveCount(0);
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: capability.label, exact: true }).click();
    await inspector.getByRole('button', { name: `Claim ${capability.label} known`, exact: true }).click();
    await expect(inspector.getByText(`${capability.label} · claimed known`, { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: `Capture ${target.summary.headword}`, exact: true }).click();
    await inspector.getByRole('button', { name: `Open saved ${target.summary.headword}: revision 1`, exact: true }).click();

    // Then: the original Material editor owns the saved entry; its actual
    // receipt has no invented source, and the native claim survives restart.
    await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Phrase', exact: true })).toHaveValue(target.summary.headword);
    await expect(page.getByRole('button', { name: 'Return to source', exact: true })).toHaveCount(0);
    const materials = await client.materials({ after: null, query: '', sourceId: null, includeExcluded: true });
    expect(materials.items).toHaveLength(1);
    expect(materials.items[0].content).toMatchObject({
      targetId: target.summary.targetId, source: null, packageRevision: first.page.packageRevision,
    });
    await backend.crashRestart();
    await page.goto('/knowledge');
    const known = page.getByTestId(`knowledge-target-${target.summary.targetId}`)
      .getByRole('button', { name: `${target.summary.headword}: claimed known`, exact: true });
    await expect(known).toBeVisible();
    await page.screenshot({ path: info.outputPath('knowledge-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(known).toBeInViewport();
    const bounds = await known.boundingBox();
    if (!bounds) throw new Error('Knowledge entry has no visible bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await known.click();
    await expect(inspector).toBeVisible();
    await page.screenshot({ path: info.outputPath('knowledge-phone-inspector.png') });
    await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    await expect(known).toBeFocused();
  } finally {
    await backend.close();
  }
});

test('an unavailable explicit package requires a replacement choice instead of changing scope', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/knowledge-scope-${randomUUID()}`,
  });
  try {
    // Given: English is available, but the requested package is not installed.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();

    // When: the user opens an explicit unavailable scope.
    await page.goto('/knowledge?packageId=org.mlearn.uninstalled');

    // Then: the native failure remains visible until a real replacement choice.
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Knowledge language: English', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('knowledge-package-unavailable-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('alert')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('knowledge-package-unavailable-phone.png') });
    await page.getByRole('combobox', { name: /^Knowledge language:/ }).click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add selected to Material', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Edit selected', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove selected', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('knowledge-empty-selection-phone.png') });
    await page.setViewportSize({ width: 1080, height: 900 });
    await page.screenshot({ path: info.outputPath('knowledge-empty-selection-desktop.png') });
  } finally {
    await backend.close();
  }
});
