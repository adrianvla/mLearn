import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('one shared surface is honest about missing native capabilities', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Browser preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run hello', exact: true })).toBeDisabled();
  await expect(page.getByText('The browser preview has no native runtime.', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/foundation-light.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('runtime theme updates, dialog labeling and keyboard focus work', async ({ page }) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { name: 'One app. Native at the core.' });
  const before = await heading.evaluate((element) => getComputedStyle(element).color);
  await page.getByRole('button', { name: 'Slate', exact: true }).click();
  await expect(heading).not.toHaveCSS('color', before);
  await expect(page.getByText('Unsaved visual preview. No native data was written.')).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Edit theme JSON', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Custom theme' });
  await expect(dialog).toBeVisible();
  // A late-mounted dialog must pair the active surface and text palette.
  await expect(page.getByTestId('dialog-surface')).toHaveCSS('background-color', 'rgb(32, 38, 46)');
  await expect(dialog.getByText('Custom theme', { exact: true })).toHaveCSS('color', 'rgb(237, 240, 245)');
  await expect(dialog.getByRole('textbox', { name: 'Theme JSON' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save custom theme' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/foundation-dialog.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('shared controls pass automated WCAG checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Edit theme JSON' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Edit theme JSON' }).click();
  await expect(page.getByRole('dialog', { name: 'Custom theme' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});
