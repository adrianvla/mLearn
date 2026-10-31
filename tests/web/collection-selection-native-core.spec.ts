/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Material } from '@mlearn/contracts';
import { emptyMaterial } from '../../apps/client/src/features/material/content';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

test('management selection survives paging, edits, a lost receipt and native restart', async ({ page }, info) => {
  test.setTimeout(60_000);
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/selection-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID,
    execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: more authored entries than one visible page, without a prepared catalog.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const saved: Material[] = [];
    for (let index = 0; index < 25; index++) {
      const outcome = await client.createMaterial(client.prepareMaterial({
        ...emptyMaterial('org.mlearn.english'), phrase: `entry-${String(index).padStart(2, '0')}`,
      }));
      if (outcome.status !== 'saved') throw new Error('Fresh Material was not saved');
      saved.push(outcome.material);
    }
    await page.goto('/materials');
    await page.getByRole('combobox', { name: /^Material order:/ }).click();
    await page.getByRole('option', { name: 'Text A–Z', exact: true }).click();
    await expect(page.getByText('24 of 25 items', { exact: true })).toBeVisible();

    // When: a hand-built selection crosses pages and outlives changing filters/data.
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await page.getByRole('button', { name: 'Select entry-00', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Select entry-00', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Next Material page', exact: true }).click();
    await page.getByRole('button', { name: 'Select entry-24', exact: true }).click();
    await expect(page.getByText(/^2 selected.*frozen selection$/)).toBeVisible();
    await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill('entry-07');
    await page.getByRole('button', { name: 'Search Material', exact: true }).click();
    await expect(page.getByText('1 of 1 items', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select entry-07', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await client.updateMaterial(client.prepareMaterialEdit(saved[0], { ...saved[0].content, notes: 'later edit' }, false));
    await page.getByRole('button', { name: 'Refresh selections', exact: true }).click();
    await expect(page.getByText(/^2 selected.*frozen selection$/)).toBeVisible();
    const selections = await client.collectionSelections();
    expect(selections).toHaveLength(1);
    const frozen = await client.collectionSelectionPage(selections[0].id);
    expect(frozen.items.map(entry => entry.item)).toEqual(
      [saved[0].id, saved[24].id].sort().map(id => ({ kind: 'material', id })),
    );
    expect(frozen.items.find(entry => entry.item.kind === 'material' && entry.item.id === saved[0].id)?.materialRevision).toBe(1);

    // Then: restart recovers that native handle; a committed but lost amendment replays once.
    await backend.crashRestart();
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await page.getByRole('combobox', { name: /^Retained selection:/ }).click();
    await page.getByRole('option', { name: '1: 2 items · All languages', exact: true }).click();
    await expect(page.getByText(/^2 selected.*frozen selection$/)).toBeVisible();
    await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill('entry-07');
    await page.getByRole('button', { name: 'Search Material', exact: true }).click();
    let interrupted = false;
    let originalIntent = '';
    const submitted: string[] = [];
    await page.route(`${backend.url}/invoke`, async route => {
      const payload = route.request().postDataJSON();
      if (typeof payload.args?.request !== 'string'
        || JSON.parse(payload.args.request).type !== 'create_collection_selection') {
        await route.continue(); return;
      }
      submitted.push(payload.args.request);
      if (interrupted) { await route.continue(); return; }
      interrupted = true; originalIntent = payload.args.request;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await response.body();
      await route.abort('connectionreset');
    });
    await page.getByRole('button', { name: 'Select entry-07', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry selection', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retry selection', exact: true }).click();
    await expect(page.getByText(/^3 selected.*frozen selection$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh selections', exact: true })).toBeEnabled();
    expect(submitted).toEqual([originalIntent, originalIntent]);
    expect(await client.collectionSelections()).toHaveLength(1);
    await page.unroute(`${backend.url}/invoke`);
    await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill('');
    await page.getByRole('button', { name: 'Search Material', exact: true }).click();
    await page.getByRole('button', { name: 'Select all 25 matching', exact: true }).click();
    await expect(page.getByText(/^25 selected.*frozen selection$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh selections', exact: true })).toBeEnabled();
    const all = await client.collectionSelections();
    expect(all).toHaveLength(1);
    expect(all[0].materialCount).toBe(25);
    await page.screenshot({ path: info.outputPath('selection-all-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Clear selection', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('selection-all-phone.png') });
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
    expect(await client.collectionSelections()).toEqual([]);
    expect((await client.material(saved[0].id)).revision).toBe(2);
  } finally {
    await backend.close();
  }
});
