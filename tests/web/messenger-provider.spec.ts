/// <reference types="node" />
import { expect } from '@playwright/test';
import { test, openNativeConversation } from './messenger-native-fixture';

test('an explicitly rejected provider endpoint can be corrected in the same dialog', async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Conversation provider', exact: true });
  const endpoint = dialog.getByRole('textbox', { name: 'Chat completions endpoint', exact: true });
  await endpoint.fill('file:///not-a-provider');
  const rejected = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).command?.action === 'save_provider_settings';
  });
  await dialog.getByRole('button', { name: 'Save endpoint and model', exact: true }).click();
  expect(JSON.parse((await (await rejected).json()).value)).toMatchObject({
    type: 'error', code: 'provider_unavailable',
  });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(endpoint).toBeEditable();
  await endpoint.fill(`${nativeCore.url}/v1`);
  await dialog.getByRole('button', { name: 'Save endpoint and model', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save endpoint and model', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Use the corrected provider.');
  await composer.press('Enter');
  await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true })).toBeVisible();
  expect(nativeCore.metadata().providerRequests).toBe(1);
});

test('a lost provider receipt keeps its exact configuration until acknowledged retry', async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Conversation provider', exact: true });
  const model = dialog.getByRole('textbox', { name: 'Model', exact: true });
  await model.fill('fixture-next');
  const commands: unknown[] = [];
  await page.route(`${nativeCore.url}/invoke`, async route => {
    const payload = route.request().postDataJSON();
    const command = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request).command : null;
    if (command?.action !== 'save_provider_settings') { await route.continue(); return; }
    commands.push(command);
    if (commands.length !== 1) { await route.continue(); return; }
    const committed = await route.fetch();
    expect(JSON.parse((await committed.json()).value)).toMatchObject({
      type: 'conversation', result: { kind: 'provider_settings', settings: { model: 'fixture-next' } },
    });
    await route.abort('failed');
  });
  await dialog.getByRole('button', { name: 'Save endpoint and model', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(model).not.toBeEditable();
  const acknowledged = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.stringify(JSON.parse(payload.args.request).command) === JSON.stringify(commands[0]);
  });
  await dialog.getByRole('button', { name: 'Retry saving settings', exact: true }).click();
  expect(JSON.parse((await (await acknowledged).json()).value)).toMatchObject({
    type: 'conversation', result: { kind: 'provider_settings', settings: { model: 'fixture-next' } },
  });
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  await expect(model).toBeEditable();
  await expect(model).toHaveValue('fixture-next');
  expect(nativeCore.metadata().providerRequests).toBe(0);
});
