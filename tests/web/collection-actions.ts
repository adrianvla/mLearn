import { expect, type Page } from '@playwright/test';

export async function selectionAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Selection actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

export async function expectSelectionReady(page: Page) {
  await page.getByRole('button', { name: 'Selection actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Refresh selections', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
}
