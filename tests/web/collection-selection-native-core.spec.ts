/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Material } from '@mlearn/contracts';
import { emptyMaterial } from '../../apps/client/src/features/material/content';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';
import { selectionAction, expectSelectionReady } from './collection-actions';

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
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill('entry-07');
    await page.getByRole('button', { name: 'Search Material', exact: true }).click();
    await expect(page.getByText('1 of 1 items', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select entry-07', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await client.updateMaterial(client.prepareMaterialEdit(saved[0], { ...saved[0].content, notes: 'later edit' }, false));
    await selectionAction(page, 'Refresh selections');
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
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
    await selectionAction(page, 'Saved selections');
    await page.getByRole('combobox', { name: /^Retained selection:/ }).click();
    await page.getByRole('option', { name: '1: 2 items · All languages', exact: true }).click();
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
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
    await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
    await expectSelectionReady(page);
    expect(submitted).toEqual([originalIntent, originalIntent]);
    expect(await client.collectionSelections()).toHaveLength(1);
    await page.unroute(`${backend.url}/invoke`);
    await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill('');
    await page.getByRole('button', { name: 'Search Material', exact: true }).click();
    await selectionAction(page, 'Select all 25 matching');
    await expect(page.getByText('25 selected', { exact: true })).toBeVisible();
    await expectSelectionReady(page);
    const all = await client.collectionSelections();
    expect(all).toHaveLength(1);
    expect(all[0].materialCount).toBe(25);
    await page.screenshot({ path: info.outputPath('selection-all-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Selection actions', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('selection-all-phone.png') });
    await selectionAction(page, 'Clear selection');
    await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
    expect(await client.collectionSelections()).toEqual([]);
    expect((await client.material(saved[0].id)).revision).toBe(2);
  } finally {
    await backend.close();
  }
});

test('a full saved-selection list remains manageable after a new selection is rejected', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('selection-capacity-profile') });
  const client = createRuntimeClient({
    commandId: randomUUID,
    execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/settings?section=languages');
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const saved: Material[] = [];
    for (let index = 0; index < 9; index++) {
      const result = await client.createMaterial(client.prepareMaterial({
        ...emptyMaterial('org.mlearn.english'), phrase: `capacity-${index}`,
      }));
      if (result.status !== 'saved') throw new Error('Fresh capacity fixture was not saved');
      saved.push(result.material);
      if (index < 8) await client.createCollectionSelection(client.prepareCollectionSelection({
        kind: 'items',
        query: { surface: 'material', packageId: null, sort: 'default', after: null, filter: { kind: 'all', filters: [] } },
        items: [{ kind: 'material', id: result.material.id }],
      }));
    }
    const originalScopes = await client.collectionSelections();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await page.getByRole('button', { name: 'Select capacity-8', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Release an existing selection');
    await page.screenshot({ path: info.outputPath('selection-capacity-rejected-phone.png') });
    await page.getByRole('button', { name: 'Selection actions', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Saved selections', exact: true })).toBeEnabled();
    await page.getByRole('menuitem', { name: 'Saved selections', exact: true }).click();
    await page.getByRole('combobox', { name: /^Retained selection:/ }).click();
    await page.getByRole('option', { name: '1: 1 items · All languages', exact: true }).click();
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry selection', exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await selectionAction(page, 'Clear selection');
    await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Select capacity-8', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Select capacity-8', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const values = await client.collectionSelections();
    expect(values).toHaveLength(8);
    expect(values.filter(value => originalScopes.some(original => original.id === value.id)).map(value => value.id).sort())
      .toEqual(originalScopes.slice(1).map(value => value.id).sort());
    const ninth = saved[8];
    if (!ninth) throw new Error('The ninth Material fixture is missing');
    const items = (await Promise.all(values.map(value => client.collectionSelectionPage(value.id))))
      .flatMap(value => value.items.map(item => item.item));
    expect(items).toContainEqual({ kind: 'material', id: ninth.id });
    await page.screenshot({ path: info.outputPath('selection-capacity-recovered-phone.png') });
  } finally {
    await backend.close();
  }
});
