import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('one shared surface is honest about missing native capabilities', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Runtime', exact: true }).click();
  await expect(page.getByText('Browser preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run hello', exact: true })).toBeDisabled();
  await expect(page.getByText('The browser preview has no native runtime.', { exact: false })).toBeVisible();
  const opaqueNavigation = await page.getByTestId('app-shell').evaluate(shell => {
    const opaque = [];
    for (let node = shell.parentElement; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      if (background !== 'rgba(0, 0, 0, 0)') opaque.push({ tag: node.tagName, background });
    }
    return opaque;
  });
  expect(opaqueNavigation).toEqual([]);
  await page.screenshot({ path: 'test-results/foundation-light.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('navigation buttons expose their selected state', async ({ page }) => {
  await page.goto('/settings');
  const appearance = page.getByRole('button', { name: 'Appearance', exact: true });
  const runtime = page.getByRole('button', { name: 'Runtime', exact: true });
  await expect(appearance).toHaveAttribute('aria-pressed', 'true');
  await runtime.click();
  await expect(runtime).toHaveAttribute('aria-pressed', 'true');
  await expect(appearance).toHaveAttribute('aria-pressed', 'false');
});

test('runtime theme updates, dialog labeling and keyboard focus work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/settings');
  const heading = page.getByRole('heading', { name: 'Settings', exact: true });
  const before = await heading.evaluate((element) => getComputedStyle(element).color);
  const selector = page.getByRole('combobox', { name: /^Select theme:/ });
  await selector.click();
  await page.getByRole('option', { name: 'Dark Quartz', exact: true }).click();
  await expect(selector).toBeFocused();
  await expect(heading).not.toHaveCSS('color', before);
  await expect(page.getByText('Unsaved visual preview. No native data was written.')).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Edit theme JSON', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Custom theme' });
  await expect(dialog).toBeVisible();
  // A late-mounted dialog must pair the active surface and text palette.
  await expect(page.getByTestId('dialog-surface')).toHaveCSS('background-color', 'rgb(44, 45, 43)');
  await expect(dialog.getByText('Custom theme', { exact: true })).toHaveCSS('color', 'rgb(240, 240, 240)');
  await expect(dialog.getByRole('textbox', { name: 'Theme JSON' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save custom theme' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/foundation-dialog.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('shared controls pass automated WCAG checks', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Edit theme JSON' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Edit theme JSON' }).click();
  await expect(page.getByRole('dialog', { name: 'Custom theme' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('Home exposes the native boundary without fabricated recents',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
 await expect(page.getByText('The browser preview has no native runtime.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Run hello',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Runtime',exact:true}).click();
 await expect(page.getByRole('button',{name:'Run hello',exact:true})).toBeDisabled();
 const home = page.getByRole('button',{name:'Home',exact:true});
 await expect(home).toBeVisible();
 expect((await home.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.getByRole('button',{name:'Home',exact:true}).click();await expect(page.getByRole('heading',{name:'Home',exact:true})).toBeVisible();
});

test('Home recovers a directly opened Watch route without navigation history', async ({ page }) => {
  await page.goto('/watch?id=unavailable');
  const home = page.waitForURL(url => url.pathname === '/', { timeout: 5000 });
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await home;
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
});
