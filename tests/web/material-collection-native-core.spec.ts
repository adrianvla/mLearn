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
    await page.getByRole('combobox', { name: /^Material order:/ }).click();
    await page.getByRole('option', { name: 'Text A–Z', exact: true }).click();
    for (const material of saved.slice(0, 24))
      await expect(page.getByRole('button', { name: `Edit ${material.content.phrase}`, exact: true })).toBeAttached();
    await page.getByRole('button', { name: 'Next Material page', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit entry-00', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit entry-24', exact: true }).click();
    await page.getByRole('button', { name: 'Exclude Material', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('24 of 51 items', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();

    // Then: the revised native membership resets the cursor and remains durable.
    await expect(page.getByRole('heading', { name: 'Material', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'First Material page', exact: true })).toBeDisabled();
    expect((await client.material(saved[24].id)).excluded).toBe(true);
    await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill('entry-24');
    await page.getByRole('button', { name: 'Search Material', exact: true }).click();
    await expect(page.getByText('0 of 0 items', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Include excluded', exact: true }).click();
    await expect(page.getByText('1 of 1 items', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit entry-24', exact: true })).toBeVisible();
    await backend.crashRestart();
    await page.goto('/materials');
    await expect(page.getByText('24 of 51 items', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /^Edit entry-/ }).first()).toBeInViewport();
    await page.screenshot({ path: info.outputPath('material-collection-phone.png') });
  } finally {
    await backend.close();
  }
});
