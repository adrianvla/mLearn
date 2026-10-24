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
