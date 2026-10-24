/// <reference types="node" />
import { expect } from '@playwright/test';
import { test, openNativeConversation } from './messenger-native-fixture';

test('reply edit delete and literal history search use the original authored messages', async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('First question');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Show analysis', exact: true }).last()).toBeEnabled();
  await page.getByRole('button', { name: 'Message actions', exact: true }).first().click();
  const authored = page.getByRole('dialog', { name: 'Your message', exact: true });
  await authored.getByRole('button', { name: 'Reply', exact: true }).click();
  await composer.fill('Following question');
  const sent = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).command?.action === 'send_turn';
  });
  await composer.press('Enter');
  const reply = JSON.parse((await sent).request().postDataJSON().args.request).command.turn.replyTo;
  expect(reply).toMatchObject({ revision: 1 });
  expect(typeof reply.id).toBe('string');
  await expect(page.getByRole('button', { name: 'Show analysis', exact: true }).last()).toBeEnabled();
  await page.getByRole('button', { name: 'Message actions', exact: true }).first().click();
  await authored.getByRole('button', { name: 'Edit message', exact: true }).click();
  await authored.getByRole('textbox', { name: 'Message text', exact: true }).fill('Revised first question');
  await authored.getByRole('button', { name: 'Save message', exact: true }).click();
  await expect(authored).toBeHidden();
  await expect(page.getByText('Revised first question', { exact: true })).toBeVisible();
  await expect(page.getByText(/· invalidated$/)).toHaveCount(2);
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search this history', exact: true }).fill('Following question');
  await expect(page.getByText('Following question', { exact: true })).toBeVisible();
  await expect(page.getByText('Revised first question', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search this history', exact: true }).fill('');
  await expect(page.getByText('Revised first question', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Message actions', exact: true }).first().click();
  await authored.getByRole('button', { name: 'Delete message', exact: true }).click();
  await expect(authored).toBeHidden();
  await expect(page.getByText('Message deleted', { exact: true })).toBeVisible();
  await expect(page.getByText('Following question', { exact: true })).toBeVisible();
  expect(nativeCore.metadata().providerRequests).toBe(2);
});

test('older history prepends a bounded native page without jumping back to the latest response', async ({ page, nativeCore }) => {
  test.setTimeout(180_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  for (let index = 0; index < 21; index++) {
    await composer.fill(`History question ${index}`);
    await composer.press('Enter');
    await expect(page.getByText(`History question ${index}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show analysis', exact: true }).last()).toBeEnabled();
    await expect(composer).toHaveValue('');
  }
  await page.reload();
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const firstRetained = page.getByText('History question 1', { exact: true });
  await firstRetained.scrollIntoViewIfNeeded();
  await expect(firstRetained).toBeInViewport();
  const older = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    if (typeof payload.args?.request !== 'string') return false;
    const command = JSON.parse(payload.args.request).command;
    return command?.action === 'read_messages' && command.before !== null;
  });
  await page.getByRole('button', { name: 'Older messages', exact: true }).click();
  const result = JSON.parse((await (await older).json()).value);
  expect(result).toMatchObject({ type: 'conversation', result: { kind: 'messages', page: { next: null } } });
  expect(result.result.page.items).toHaveLength(2);
  await expect(page.getByText('History question 0', { exact: true })).toBeAttached();
  await expect(firstRetained).toBeInViewport();
  await expect(page.getByText('History question 20', { exact: true })).not.toBeInViewport();
  expect(nativeCore.metadata().providerRequests).toBe(21);
});
