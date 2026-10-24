import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1080, height: 900 }, { width: 390, height: 740 }]) {
  test(`dialog is centered and remains inside ${viewport.width}px viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/settings');
    if (viewport.width < 700) {
      // The desktop overlay titlebar occupies the first 28px even when the
      // sidebar wraps into top navigation. Its search field must remain usable.
      const search = await page.getByRole('textbox', { name: 'Search settings', exact: true }).boundingBox();
      expect(search!.y).toBeGreaterThanOrEqual(28);
    }
    await page.getByRole('button', { name: 'Edit theme JSON', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Custom theme' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThan(3);
    expect(Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2)).toBeLessThan(3);
    expect(bounds!.x).toBeGreaterThanOrEqual(15);
    expect(bounds!.y).toBeGreaterThanOrEqual(15);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 15);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 15);
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/dialog-${viewport.width}.png`, fullPage: true });
  });
}
