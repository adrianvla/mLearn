/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { Material } from '@mlearn/contracts';
import { emptyMaterial } from '../../apps/client/src/features/material/content';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

test('bulk controls recover a held receipt and preserve revision checks through edit, exclusion and removal', async ({ page }, info) => {
  test.setTimeout(60_000);
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/bulk-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID,
    execute: request => backend.invoke('runtime_execute', { request }),
  });
  let releaseHeld = () => {};
  try {
    // Given: real authored entries and a frozen native selection.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const saved: Material[] = [];
    for (let index = 0; index < 3; index++) {
      const outcome = await client.createMaterial(client.prepareMaterial({
        ...emptyMaterial('org.mlearn.english'), phrase: `bulk-entry-${index}`,
      }));
      if (outcome.status !== 'saved') throw new Error('Fresh Material was not saved');
      saved.push(outcome.material);
    }
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    const selectAll = page.getByRole('button', { name: 'Select all 3 matching', exact: true });
    await selectAll.click();
    await expect(page.getByText(/^3 selected.*frozen selection$/)).toBeVisible();

    // When: the native edit commits but its start response is held at the wire.
    let forwardedResolve = (_id: string) => {};
    const forwarded = new Promise<string>(resolve => { forwardedResolve = resolve; });
    const held = new Promise<void>(resolve => { releaseHeld = resolve; });
    let intercepted = false;
    await page.route(`${backend.url}/invoke`, async route => {
      const payload = route.request().postDataJSON();
      const request = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request) : null;
      if (intercepted || request?.type !== 'material_bulk' || request.command.kind !== 'start') {
        await route.continue(); return;
      }
      intercepted = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await response.body();
      forwardedResolve(request.command.command.commandId);
      await held;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
    await page.getByRole('textbox', { name: 'Replacement text', exact: true }).fill('shared authored note');
    await page.getByRole('button', { name: 'Apply bulk change', exact: true }).click();
    const editedId = await forwarded;
    const acknowledged = page.waitForResponse(response => {
      const payload = response.request().postDataJSON();
      if (typeof payload?.args?.request !== 'string') return false;
      const request = JSON.parse(payload.args.request);
      return request.type === 'material_bulk' && request.command.kind === 'cancel';
    });
    await page.getByRole('button', { name: 'Cancel bulk operation', exact: true }).click();
    await acknowledged;

    // Then: control bypasses the held start response and reports the actual terminal result.
    await expect(page.getByTestId(`bulk-status-${editedId}`)).toContainText('completed · 3 of 3 processed');
    await expect(page.getByRole('button', { name: 'Cancel bulk operation', exact: true })).toHaveCount(0);
    releaseHeld();
    await page.unrouteAll({ behavior: 'wait' });
    const edited = await client.materialBulkStatus(editedId);
    expect(edited.succeeded).toBe(3);
    for (const material of saved)
      expect((await client.material(material.id)).content.notes).toBe('shared authored note');

    async function change(action: string) {
      await page.getByRole('button', { name: action, exact: true }).click();
      const returned = page.waitForResponse(response => {
        const payload = response.request().postDataJSON();
        if (typeof payload?.args?.request !== 'string') return false;
        const request = JSON.parse(payload.args.request);
        return request.type === 'material_bulk' && request.command.kind === 'start';
      });
      await page.getByRole('button', { name: 'Apply bulk change', exact: true }).click();
      const response = await returned;
      const raw = JSON.parse(response.request().postDataJSON().args.request);
      const id: string = raw.command.command.commandId;
      const status = await client.materialBulkStatus(id);
      await expect(page.getByTestId(`bulk-status-${id}`)).toContainText(`${status.processed} of ${status.total} processed`);
      return status;
    }
    const stale = await change('Exclude selected');
    expect(stale.failed).toBe(3);
    expect(stale.succeeded).toBe(0);
    for (const material of saved) expect((await client.material(material.id)).excluded).toBe(false);
    await selectAll.click();
    await expect(page.getByRole('button', { name: 'Refresh selections', exact: true })).toBeEnabled();
    const excluded = await change('Exclude selected');
    expect(excluded.succeeded).toBe(3);
    await expect(page.getByText('0 of 0 items', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Include excluded', exact: true }).click();
    await selectAll.click();
    await expect(page.getByRole('button', { name: 'Refresh selections', exact: true })).toBeEnabled();
    expect((await change('Include selected')).succeeded).toBe(3);
    await selectAll.click();
    await expect(page.getByRole('button', { name: 'Refresh selections', exact: true })).toBeEnabled();
    const remove = page.getByRole('button', { name: 'Remove selected', exact: true });
    await remove.click();
    await page.screenshot({ path: info.outputPath('bulk-removal-confirmation-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('bulk-removal-confirmation-phone.png') });
    await page.getByRole('button', { name: 'Cancel change', exact: true }).click();
    await expect(remove).toBeFocused();
    await page.setViewportSize({ width: 1080, height: 900 });
    const removed = await change('Remove selected');
    expect(removed.succeeded).toBe(3);
    await expect(page.getByText('0 of 0 items', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('bulk-removal-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Refresh bulk results', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('bulk-removal-phone.png') });
    for (const material of saved) await expect(client.material(material.id)).rejects.toThrow();
    await backend.crashRestart();
    expect((await client.materialBulkStatus(removed.command.commandId)).succeeded).toBe(3);
    expect((await client.materialBulkResults(removed.command.commandId)).items.map(item => item.label).sort())
      .toEqual(saved.map(material => material.content.phrase).sort());
  } finally {
    releaseHeld();
    try { await page.unrouteAll({ behavior: 'wait' }); }
    finally { await backend.close(); }
  }
});

test('a released retained bulk operation resets the replacement job to its first result page', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/bulk-cursor-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID,
    execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: two real retained jobs, each longer than one result page.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const materials: Material[] = [];
    for (let index = 0; index < 25; index++) {
      const outcome = await client.createMaterial(client.prepareMaterial({
        ...emptyMaterial('org.mlearn.english'), phrase: `cursor-entry-${index}`,
      }));
      if (outcome.status !== 'saved') throw new Error('Fresh Material was not saved');
      materials.push(outcome.material);
    }
    const selected = await client.createCollectionSelection(client.prepareCollectionSelection({
      kind: 'matching', query: {
        packageId: null, surface: 'material', filter: { kind: 'all', filters: [] }, sort: 'default', after: null,
      },
    }));
    const first = await client.startMaterialBulk(client.prepareMaterialBulk(selected.id, {
      kind: 'edit', patch: { phrase: null, reading: null, meaning: null, context: null, notes: 'changed', examples: null },
    }));
    const second = await client.startMaterialBulk(client.prepareMaterialBulk(selected.id, { kind: 'exclude', excluded: true }));
    expect(first.succeeded).toBe(25);
    expect(second.failed).toBe(25);
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await page.getByRole('combobox', { name: /^Retained bulk operation:/ }).click();
    await page.getByRole('option', { name: /: Edit Material · completed · 25\/25$/ }).click();
    await expect(page.getByTestId(`bulk-status-${first.command.commandId}`)).toBeVisible();
    const next = page.getByRole('button', { name: 'Next bulk result page', exact: true });
    await expect(next).toBeEnabled();

    // When: another consumer releases that job before its pending next-page action.
    await client.releaseMaterialBulk(first.command.commandId);
    await next.click();

    // Then: the surviving job opens at its own first page, not the removed job's cursor.
    await expect(page.getByTestId(`bulk-status-${second.command.commandId}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'First bulk result page', exact: true })).toBeDisabled();
    await expect(next).toBeEnabled();
    await page.screenshot({ path: info.outputPath('bulk-job-recovery-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('combobox', { name: /^Retained bulk operation:/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('bulk-job-recovery-phone.png') });
    const retried = page.waitForResponse(response => {
      const payload = response.request().postDataJSON();
      if (typeof payload?.args?.request !== 'string') return false;
      const request = JSON.parse(payload.args.request);
      return request.type === 'material_bulk' && request.command.kind === 'retry'
        && request.command.commandId === second.command.commandId;
    });
    await Promise.all([retried, page.getByRole('button', { name: 'Retry unfinished items', exact: true }).click()]);
    const retryStatus = await client.materialBulkStatus(second.command.commandId);
    expect([retryStatus.succeeded, retryStatus.failed, retryStatus.processed]).toEqual([0, 25, 25]);
    await page.getByRole('button', { name: 'Clear bulk results', exact: true }).click();
    await expect(page.getByTestId(`bulk-status-${second.command.commandId}`)).toHaveCount(0);
    expect(await client.materialBulkJobs()).toEqual([]);
    await page.getByRole('combobox', { name: /^Retained selection:/ }).click();
    await page.getByRole('option', { name: '1: 25 items · All languages', exact: true }).click();
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
    expect(await client.collectionSelections()).toEqual([]);
    expect((await client.startMaterialBulk(second.command)).resultsAvailable).toBe(false);
    for (const material of materials) {
      const current = await client.material(material.id);
      expect([current.revision, current.excluded]).toEqual([2, false]);
    }
  } finally {
    await backend.close();
  }
});
