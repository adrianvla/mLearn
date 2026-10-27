/// <reference types="node" />
import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

type NativeCore = Awaited<ReturnType<typeof startRuntimeBrowserQa>>;
export const test = base.extend<{ nativeCore: NativeCore }>({
  nativeCore: async ({ page }, use, info) => {
    const native = await startRuntimeBrowserQa({
      profile: `.mlearn/m03-m07/m07-messenger/browser-${randomUUID()}`,
    });
    try {
      await attachRuntimeBrowserQa(page, native.url);
      await use(native);
    } finally {
      await info.attach('native-transport-final.json', {
        body: JSON.stringify({ profile: native.profile, nativePid: native.pid, activity: native.metadata() }, null, 2),
        contentType: 'application/json',
      });
      await native.close();
    }
  },
});

/** Normal user actions; no native content/SQLite state is mocked or injected. */
export async function openNativeConversation(page: Page, native: NativeCore, name = 'Coach') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
  await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
  await page.getByRole('button', { name: /^Install .*English/ }).click();
  await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'New person', exact: true }).click();
  const person = page.getByRole('dialog', { name: 'New person', exact: true });
  await person.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await person.getByRole('textbox', { name: 'Description', exact: true }).fill('Give a short reply in English.');
  await person.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(person).toBeHidden();
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  const provider = page.getByRole('dialog', { name: 'Conversation provider', exact: true });
  await provider.getByRole('textbox', { name: 'Chat completions endpoint', exact: true }).fill(`${native.url}/v1`);
  await provider.getByRole('textbox', { name: 'Model', exact: true }).fill('fixture-local');
  const savedProvider = page.waitForResponse(response => {
    if (response.url() !== `${native.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).command?.action === 'save_provider_settings';
  });
  await provider.getByRole('button', { name: 'Save endpoint and model', exact: true }).click();
  const saved = await (await savedProvider).json();
  expect(JSON.parse(saved.value)).toMatchObject({
    type: 'conversation', result: { kind: 'provider_settings', settings: {
      endpoint: `${native.url}/v1`, model: 'fixture-local',
    } },
  });
  await expect(provider.getByRole('button', { name: 'Save endpoint and model', exact: true })).toBeEnabled();
  await provider.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
}
