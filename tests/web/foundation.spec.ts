import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { createRuntimeBrowserClient } from '../../tools/runtime-browser-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

test('Home continuation gives real source metadata priority over placeholder geometry', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('native-profile') });
  const client = createRuntimeBrowserClient(backend);
  try {
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/settings?section=languages');
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const document = await client.openDocument(resolve('tests/fixtures/reader/graph-navigation.txt'), 'org.mlearn.english');
    await page.goto('/');
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const source = page.getByRole('button', { name: `Continue ${document.source.title}`, exact: true });
      await expect(source).toBeVisible();
      await page.screenshot({ path: info.outputPath(`home-source-${width}.png`) });
      const row = await source.boundingBox();
      const title = await source.getByText(document.source.title, { exact: true }).boundingBox();
      if (!row || !title) throw new Error('Source continuation has no metadata bounds');
      expect(row.height).toBeGreaterThanOrEqual(44);
      expect(title.width).toBeGreaterThan(row.width * 0.65);
      expect(row.x + row.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole('button', { name: `Continue ${document.source.title}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/reader\\?id=${document.source.id}`));
    await expect(page.getByTestId('reader-title')).toHaveText(document.source.title);
  } finally {
    await backend.close();
  }
});

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
  await expect(page.getByText('Preview only. Changes have not been saved.')).toBeVisible();
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
 const settings = page.getByRole('button',{name:'Settings',exact:true});
 const restingBackground = await settings.evaluate(element => getComputedStyle(element).backgroundColor);
 await settings.hover();
 await expect(settings).not.toHaveCSS('background-color', restingBackground);
 await page.mouse.move(0, 0);
 await expect(page.getByText('The browser preview has no native runtime.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Run hello',exact:true})).toHaveCount(0);
 const review = page.waitForURL(url => url.pathname === '/review', { timeout: 5000 });
 await page.getByRole('button', { name: 'Review', exact: true }).click();
 await review;
 await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
 await expect(page.getByRole('alert').filter({ hasText: 'The browser preview has no native runtime.' })).toBeVisible();
 await page.getByRole('button', { name: 'Home', exact: true }).click();
 await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Runtime',exact:true}).click();
 await expect(page.getByRole('button',{name:'Run hello',exact:true})).toBeDisabled();
 const home = page.getByRole('button',{name:'Home',exact:true});
 await expect(home).toBeVisible();
 expect((await home.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.getByRole('button',{name:'Home',exact:true}).click();await expect(page.getByRole('heading',{name:'Home',exact:true})).toBeVisible();
});

for (const destination of ['Home', 'Knowledge', 'Material']) {
test(`unavailable Review ${destination} preserves the retained Knowledge search`, async ({ page }, info) => {
  await page.goto('/');
  for (const width of [1080, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const draft = `Unsubmitted Knowledge search at ${width}`;
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    const search = page.getByRole('textbox', { name: 'Search Knowledge', exact: true });
    await expect(search).toBeInViewport();
    const bounds = await search.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width, 'Keep room to read and edit a collection query').toBeGreaterThanOrEqual(160);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await search.fill(draft);
    await page.getByRole('button', { name: 'Home', exact: true }).click();

    // Establish that ordinary management navigation retains this same draft
    // before exercising the unavailable activity's departure.
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    await expect(search).toHaveValue(draft);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    const review = page.waitForURL(url => url.pathname === '/review', { timeout: 5000 });
    await page.getByTestId('home-open-review').click();
    await review;
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Review', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`unavailable-review-before-home-${width}.png`) });
    const targetPath = destination === 'Home' ? '/' : destination === 'Knowledge' ? '/knowledge' : '/materials';
    const returned = page.waitForURL(url => url.pathname === targetPath, { timeout: 5000 });
    await page.getByRole('button', { name: destination, exact: true }).click();
    await returned;
    await expect(page.getByRole('heading', { name: destination, exact: true })).toBeVisible();
    if (destination !== 'Knowledge') await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    await page.screenshot({ path: info.outputPath(`unavailable-review-retained-${width}.png`) });
    await expect(search).toHaveValue(draft);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
  }
});
}

test('Home recovers directly opened activities without navigation history', async ({ page }, info) => {
  for (const width of [1080, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['messenger', 'reader', 'review', 'watch']) {
      await page.goto(`/${route}?id=unavailable`);
      if (route !== 'watch') {
        await expect(page.getByRole('alert').filter({
          hasText: 'The browser preview has no native runtime.',
        })).toBeVisible();
      }
      await page.screenshot({ path: info.outputPath(`unavailable-${route}-${width}.png`) });
      if (route === 'reader') {
        await expect(page.getByRole('heading', { name: 'Reader', exact: true })).toBeVisible();
      }
      await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
      const home = page.waitForURL(url => url.pathname === '/', { timeout: 5000 });
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await home;
      await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    }
  }
});

for (const width of [1080, 390]) test(`unavailable Watch exposes its runtime failure and Home recovery at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/watch?id=unavailable');
  const home = page.getByRole('button', { name: 'Home', exact: true });
  await expect(home).toBeVisible();
  await page.screenshot({ path: info.outputPath(`unavailable-watch-${width}.png`) });
  await expect(page.getByRole('alert').filter({
    hasText: 'The browser preview has no native runtime.',
  })).toBeVisible();
  await expect(page.getByText('Opening source…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry source', exact: true })).toHaveCount(0);
  const returned = page.waitForURL(url => url.pathname === '/', { timeout: 5000 });
  await home.click();
  await returned;
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
});
