/// <reference types="node" />
import { expect } from '@playwright/test';
import { test } from './messenger-native-fixture';
import { initialTheme } from '../../packages/theme/src/theme';

for (const id of ['qa.saved-palette', initialTheme.id]) {
  test(`a custom theme remains selected after restart and can reset to its preset (${id})`, async ({ page, nativeCore }, info) => {
    const custom = {
      ...initialTheme, id, name: id === initialTheme.id ? initialTheme.name : 'Saved palette',
      colors: { ...initialTheme.colors, background: '#223344' },
    };
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Edit theme JSON', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Custom theme', exact: true });
    await dialog.getByRole('textbox', { name: 'Theme JSON', exact: true }).fill(JSON.stringify(custom));
    await dialog.getByRole('button', { name: 'Save custom theme', exact: true }).click();
    await expect(dialog).toBeHidden();
    await nativeCore.crashRestart();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();

    const selector = page.getByRole('combobox', { name: /^Select theme:/ });
    await expect(selector).toBeInViewport();
    await expect(selector).toContainText(custom.name);
    await selector.click();
    await expect(page.getByRole('option', { name: `${custom.name} (custom)`, exact: true }))
      .toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: info.outputPath('saved-custom-theme.png') });
    await page.getByRole('option', { name: initialTheme.name, exact: true }).click();
    await expect(page.getByText('Theme saved.', { exact: true })).toBeVisible();
    const snapshot = JSON.parse(await nativeCore.invoke('runtime_execute', {
      request: JSON.stringify({ type: 'snapshot' }),
    }));
    expect(snapshot.snapshot.theme).toEqual(initialTheme);
  });
}

test('package errors recover, cancelled downloads retry and installed data survives restart', async ({ page, nativeCore }, info) => {
  test.setTimeout(60_000);
  await page.goto('/settings?section=languages');
  nativeCore.catalogMode('fail');
  const rejected = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).type === 'available_packages';
  });
  await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
  const failure = JSON.parse((await (await rejected).json()).value);
  expect(failure.type).toBe('error');
  expect(typeof failure.message).toBe('string');
  await expect(page.getByRole('alert').filter({ hasText: failure.message })).toBeVisible();
  await page.screenshot({ path: info.outputPath('package-catalog-error.png') });

  nativeCore.catalogMode('complete');
  await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
  const install = page.getByRole('button', { name: /^Install .*English/ });
  await expect(install).toBeEnabled();
  nativeCore.catalogMode('hold');
  const started = nativeCore.nextCatalogStart();
  await install.click();
  await started;
  const cancel = page.getByRole('button', { name: 'Cancel installation', exact: true });
  await expect(cancel).toBeVisible();
  await page.screenshot({ path: info.outputPath('package-download-pending.png') });
  const closed = nativeCore.nextCatalogClose();
  await cancel.click();
  await closed;
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  expect(nativeCore.metadata().activeCatalog).toBe(false);

  await page.screenshot({ path: info.outputPath('package-download-cancelled.png') });
  nativeCore.catalogMode('complete');
  await page.getByRole('button', { name: 'Retry installation', exact: true }).click();
  await expect(page.getByText('Installed', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for packages', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('package-retry-installed.png') });
  await nativeCore.crashRestart();
  await page.goto('/settings?section=languages');
  await expect(page.getByText('English', { exact: true })).toBeVisible();
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();
  expect(nativeCore.metadata().activeCatalog).toBe(false);
});
