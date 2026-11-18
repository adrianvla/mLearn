import type { Page } from '@playwright/test';
import { expect, installPackage, type NativeCore } from './fixture';

export async function openMessenger(page: Page, native: NativeCore, people: readonly string[]) {
  await installPackage(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'People', exact: true }).click();
  for (const name of people) {
    await page.getByRole('button', { name: 'New person', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New person', exact: true });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill(`${name} answers briefly in English.`);
    await dialog.getByRole('button', { name: 'Save person', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  const provider = page.getByRole('dialog', { name: 'Conversation provider', exact: true });
  await provider.getByRole('textbox', { name: 'Chat completions endpoint', exact: true }).fill(`${native.url}/v1`);
  await provider.getByRole('textbox', { name: 'Model', exact: true }).fill('fixture-local');
  await provider.getByRole('button', { name: 'Save endpoint and model', exact: true }).click();
  await expect(provider.getByRole('button', { name: 'Save endpoint and model', exact: true })).toBeEnabled();
  await provider.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
}

export async function createConversation(page: Page, title: string, history: 'Separate history' | 'Shared history', people: readonly string[]) {
  await page.getByRole('button', { name: 'New Thread', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New conversation', exact: true });
  await dialog.getByRole('radio', { name: history, exact: true }).or(dialog.getByRole('button', { name: history, exact: true })).click();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  for (const name of people) await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await dialog.getByRole('button', { name: history === 'Shared history' ? 'Create conversation' : 'Create Thread', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: title }).or(page.getByText(title, { exact: true }).first())).toBeVisible();
}

export async function sendMessage(page: Page, text: string) {
  const composer = page.getByTestId('conversation-composer');
  await composer.fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const history = page.getByTestId('conversation-history');
  await expect(history.getByText(text, { exact: true })).toBeVisible();
  await expect(history.getByText('Children walked home.', { exact: true }).last()).toBeVisible({ timeout: 30_000 });
}

export async function tools(page: Page) {
  const toggle = page.getByRole('button', { name: 'Conversation actions', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

export async function memory(page: Page, person: string) {
  await tools(page);
  await page.getByRole('button', { name: 'What people remember', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'What people remember', exact: true });
  await dialog.getByRole('combobox', { name: /^Person/ }).click();
  await page.getByRole('option', { name: person, exact: true }).click();
  await expect(dialog.getByText('Reading…')).toBeHidden();
  const text = await dialog.innerText();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return text;
}
