/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Material } from '@mlearn/contracts';
import { emptyMaterial } from '../../apps/client/src/features/material/content';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

test('Material collections preserve exact counts and native order through paging and edits', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/material-collection-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID,
    execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: authored Material exists without preparing a language catalog.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const saved: Material[] = [];
    for (let index = 0; index < 52; index++) {
      const content = { ...emptyMaterial('org.mlearn.english'),
        phrase: `entry-${String(index).padStart(2, '0')}`, meaning: `Definition ${index}` };
      const outcome = await client.createMaterial(client.prepareMaterial(content));
      if (outcome.status !== 'saved') throw new Error('Fresh authored Material was not saved');
      saved.push(outcome.material);
    }

    // When: a later-page entry is edited in the existing authoring workflow.
    await page.goto('/materials');
    await expect(page.getByText('24 of 52 items', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('material-collection-desktop.png') });
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByText('Loading filter options…', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Group 1 add condition', exact: true }).click();
    await page.getByRole('textbox', { name: 'Condition 2 text', exact: true }).fill('entry-0');
    await page.getByRole('button', { name: 'Group 1 add group', exact: true }).click();
    await page.getByRole('button', { name: 'Group 3 add condition', exact: true }).click();
    await page.getByRole('textbox', { name: 'Condition 4 text', exact: true }).fill('entry-1');
    await page.getByRole('button', { name: 'Group 3 add condition', exact: true }).click();
    await page.getByRole('textbox', { name: 'Condition 5 text', exact: true }).fill('entry-19');
    await page.getByRole('button', { name: 'Condition 5 negated', exact: true }).click();
    await page.getByRole('combobox', { name: /^Group 1 matching:/ }).click();
    await page.getByRole('option', { name: 'Match any', exact: true }).click();
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByText('19 of 19 items', { exact: true })).toBeVisible();
    for (let index = 0; index < 19; index++)
      await expect(page.getByRole('button', { name: `Edit entry-${String(index).padStart(2, '0')}`, exact: true })).toBeAttached();
    await expect(page.getByRole('button', { name: 'Edit entry-19', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('material-compound-filters-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Apply filters', exact: true }).scrollIntoViewIfNeeded();
    const applyBounds = await page.getByRole('button', { name: 'Apply filters', exact: true }).boundingBox();
    if (!applyBounds) throw new Error('Filter action has no visible bounds');
    expect(applyBounds.x).toBeGreaterThanOrEqual(0);
    expect(applyBounds.x + applyBounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath('material-compound-filters-phone.png') });
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.getByText('24 of 52 items', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.setViewportSize({ width: 1080, height: 900 });
    await page.getByRole('combobox', { name: /^Material order:/ }).click();
    await page.getByRole('option', { name: 'Text A–Z', exact: true }).click();
    for (const material of saved.slice(0, 24))
      await expect(page.getByRole('button', { name: `Edit ${material.content.phrase}`, exact: true })).toBeAttached();
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await page.getByRole('button', { name: 'Select entry-01', exact: true }).click();
    await expect(page.getByText(/^1 selected.*frozen selection$/)).toBeVisible();
    await page.getByRole('button', { name: 'Next Material page', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit entry-00', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add Material', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Previous Material', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();
    await page.getByRole('button', { name: 'Select entry-40', exact: true }).click();
    await expect(page.getByText(/^2 selected.*frozen selection$/)).toBeVisible();
    const selections = await client.collectionSelections();
    expect(selections).toHaveLength(1);
    const frozen = await client.collectionSelectionPage(selections[0].id);
    expect(frozen.items.map(entry => entry.item)).toEqual(
      [saved[1].id, saved[40].id].sort().map(id => ({ kind: 'material', id })),
    );
    const search = page.getByRole('textbox', { name: 'Search Material', exact: true });
    await search.fill('Unsubmitted collection query');
    const origin = page.getByRole('button', { name: 'Edit entry-40', exact: true });
    await origin.scrollIntoViewIfNeeded();
    const scroller = page.getByTestId('app-shell')
      .filter({ has: page.getByTestId('material-search') }).getByTestId('app-shell-content');
    const scroll = await scroller.evaluate(node => node.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    await origin.click();
    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Retain the originating collection page.');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByTestId('material-result')).toContainText('Saved Material');
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    const resumed = page.waitForResponse(response => {
      if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
      const request = JSON.parse(response.request().postDataJSON().args.request);
      return (request.type === 'collection' || request.type === 'refresh_material_collection')
        && request.query.surface === 'material';
    });
    const [resumedResponse] = await Promise.all([
      resumed, page.getByRole('button', { name: 'Material', exact: true }).click(),
    ]);
    expect(JSON.parse((await resumedResponse.json()).value)).toMatchObject({
      type: 'collection', result: { state: 'ready' },
    });
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Retain the originating collection page.');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('material-editor-after-save-refocus-1080.png') });
    const current = page.getByRole('combobox', { name: /^Current Material selection:/ });
    const phrase = page.getByRole('textbox', { name: 'Phrase', exact: true });
    const next = page.getByRole('button', { name: 'Next Material', exact: true });
    const previous = page.getByRole('button', { name: 'Previous Material', exact: true });
    await current.click();
    await page.getByRole('option', { name: 'entry-47', exact: true }).click();
    await expect(phrase).toHaveValue('entry-47');
    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep this page-boundary draft.');
    await expect(next).toBeEnabled();
    await next.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(phrase).toHaveValue('entry-47');
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this page-boundary draft.');
    await next.click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(phrase).toHaveValue('entry-48');
    expect((await client.material(saved[47].id)).content.notes).toBe('Keep this page-boundary draft.');
    await page.screenshot({ path: info.outputPath('material-editor-next-window-1080.png') });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: info.outputPath('material-editor-next-window-390.png') });
    await page.setViewportSize({ width: 1080, height: 900 });
    await previous.click();
    await expect(phrase).toHaveValue('entry-47');
    const failWindow = async (route: import('@playwright/test').Route) => {
      const request = JSON.parse(route.request().postDataJSON().args.request);
      if (request.type !== 'refresh_material_collection') return route.continue();
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: 'Collection window unavailable' }) });
    };
    await page.route(`${backend.url}/invoke`, failWindow);
    await next.click();
    await expect(page.getByRole('alert')).toHaveText('Collection window unavailable');
    await expect(phrase).toHaveValue('entry-47');
    await page.unroute(`${backend.url}/invoke`, failWindow);
    await page.getByRole('button', { name: 'Retry opening Material', exact: true }).click();
    await expect(phrase).toHaveValue('entry-48');
    await previous.click();
    await expect(phrase).toHaveValue('entry-47');
    await current.click();
    await page.getByRole('option', { name: 'entry-24', exact: true }).click();
    await previous.click();
    await expect(phrase).toHaveValue('entry-23');
    await next.click();
    await expect(phrase).toHaveValue('entry-24');
    await current.click();
    await page.getByRole('option', { name: 'entry-40', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Retain the originating collection page.');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();
    await expect(page.getByRole('button', { name: 'First Material page', exact: true })).toBeEnabled();
    await expect(origin).toBeFocused();
    await expect(search).toHaveValue('Unsubmitted collection query');
    await expect(page.getByText(/^2 selected.*frozen selection$/)).toBeVisible();
    expect(await client.collectionSelectionPage(selections[0].id)).toEqual(frozen);
    expect(await scroller.evaluate(node => node.scrollTop)).toBe(scroll);
    await page.screenshot({ path: info.outputPath('material-origin-after-save-refocus-1080.png') });
    const boundaryOrigin = page.getByRole('button', { name: 'Edit entry-47', exact: true });
    await boundaryOrigin.click();
    const windowStarted = Promise.withResolvers<void>();
    const releaseWindow = Promise.withResolvers<void>();
    const windowSettled = Promise.withResolvers<void>();
    const holdWindow = async (route: import('@playwright/test').Route) => {
      const request = JSON.parse(route.request().postDataJSON().args.request);
      if (request.type !== 'refresh_material_collection') return route.continue();
      const response = await route.fetch();
      windowStarted.resolve();
      await releaseWindow.promise;
      await route.fulfill({ response });
      windowSettled.resolve();
    };
    await page.route(`${backend.url}/invoke`, holdWindow);
    try {
      await next.click();
      await windowStarted.promise;
      await expect(page.getByText('Opening Material…', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close editor', exact: true }).click();
      await expect(boundaryOrigin).toBeFocused();
    } finally {
      releaseWindow.resolve();
      await windowSettled.promise;
      await page.unroute(`${backend.url}/invoke`, holdWindow);
    }
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    await page.getByRole('button', { name: 'Material', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit entry-47', exact: true })).toBeAttached();
    await page.getByRole('button', { name: 'Edit entry-24', exact: true }).click();
    await page.getByRole('button', { name: 'Exclude Material', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('24 of 51 items', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();

    // Then: revised native membership retains the origin window and remains durable.
    await expect(page.getByRole('heading', { name: 'Material', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'First Material page', exact: true })).toBeEnabled();
    expect((await client.material(saved[24].id)).excluded).toBe(true);
    await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill('entry-24');
    await page.getByRole('button', { name: 'Search Material', exact: true }).click();
    await expect(page.getByText('0 of 0 items', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Include excluded', exact: true }).click();
    await expect(page.getByText('1 of 1 items', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit entry-24', exact: true })).toBeVisible();
    await backend.crashRestart();
    expect(await client.collectionSelectionPage(selections[0].id)).toEqual(frozen);
    await page.goto('/materials');
    await expect(page.getByText('24 of 51 items', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /^Edit entry-/ }).first()).toBeInViewport();
    await page.screenshot({ path: info.outputPath('material-collection-phone.png') });
    await page.getByRole('button', { name: 'Include excluded', exact: true }).click();
    await expect(page.getByText('24 of 52 items', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('button', { name: 'Group 1 add condition', exact: true }).click();
    await page.getByRole('combobox', { name: /^Condition 2 type:/ }).click();
    await page.getByRole('option', { name: 'Material state', exact: true }).click();
    await page.getByRole('combobox', { name: /^Condition 2 Material state:/ }).click();
    await page.getByRole('option', { name: 'Excluded', exact: true }).click();
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByText('1 of 1 items', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit entry-24', exact: true })).toBeAttached();
    await page.getByRole('button', { name: 'Condition 2 negated', exact: true }).click();
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByText('24 of 51 items', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit entry-24', exact: true })).toHaveCount(0);
    const remove = page.getByRole('button', { name: 'Remove condition 2', exact: true });
    await remove.focus();
    await remove.press('Enter');
    await expect(page.getByRole('button', { name: 'Group 1 add condition', exact: true })).toBeFocused();
    await expect(page.getByText('24 of 51 items', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByText('24 of 52 items', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('material-filter-keyboard-phone.png') });
  } finally {
    await backend.close();
  }
});
