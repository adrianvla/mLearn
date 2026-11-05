/// <reference types="node" />
import { expect } from '@playwright/test';
import { test, openNativeConversation } from './messenger-native-fixture';

test('People edits archive restoration and direct reuse preserve the existing history', async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep our conversation');
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit person', exact: true });
  await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('Tutor');
  await editor.getByRole('textbox', { name: 'Description', exact: true }).fill('Practice short English replies.');
  await editor.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(editor).toBeHidden();
  const history = page.getByTestId('conversation-history');
  await expect(history.getByText('Tutor', { exact: true })).toBeVisible();
  await expect(history.getByText('Coach', { exact: true })).toHaveCount(0);
  await expect(history.getByText(/· invalidated$/)).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Another turn before archive');
  await composer.press('Enter');
  await expect(history.getByText('Children walked home.', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Show analysis', exact: true }).last()).toBeEnabled();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(history.getByText(/· invalidated$/)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Tutor', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: /^People filter/ }).click();
  await page.getByRole('option', { name: 'Archived People', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tutor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('combobox', { name: /^People filter/ }).click();
  await page.getByRole('option', { name: 'Active People', exact: true }).click();
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Coach', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Tutor', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('conversation-history').getByText('Keep our conversation', { exact: true })).toBeVisible();
  await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true })).toHaveCount(2);
  expect(nativeCore.metadata().providerRequests).toBe(2);
});

test('temporary Thread participant changes draft restart and discard retain independent People', async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'New person', exact: true }).click();
  const person = page.getByRole('dialog', { name: 'New person', exact: true });
  await person.getByRole('textbox', { name: 'Name', exact: true }).fill('Partner');
  await person.getByRole('textbox', { name: 'Description', exact: true }).fill('Discuss an everyday task.');
  await person.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(person).toBeHidden();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.getByRole('button', { name: 'New Thread', exact: true }).click();
  const thread = page.getByRole('dialog', { name: 'New temporary Thread', exact: true });
  await thread.getByRole('textbox', { name: 'Title', exact: true }).fill('Planning practice');
  await thread.getByRole('textbox', { name: 'Purpose', exact: true }).fill('Arrange a trip.');
  await thread.getByRole('button', { name: 'Coach', exact: true }).click();
  await thread.getByRole('button', { name: 'Partner', exact: true }).click();
  await thread.getByRole('button', { name: 'Create Thread', exact: true }).click();
  await expect(thread).toBeHidden();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Unsaved trip question');
  const savedDraft = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).command?.action === 'save_draft';
  });
  await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
  expect(JSON.parse((await (await savedDraft).json()).value)).toMatchObject({
    type: 'conversation', result: { kind: 'draft', draft: { text: 'Unsaved trip question' } },
  });
  const details = page.getByRole('dialog', { name: 'Conversation details', exact: true });
  await details.getByRole('textbox', { name: 'Title', exact: true }).fill('Trip practice');
  await details.getByRole('button', { name: 'Remove Coach', exact: true }).click();
  await details.getByRole('button', { name: 'Save conversation', exact: true }).click();
  await expect(details).toBeHidden();
  await nativeCore.crashRestart();
  await page.reload();
  await page.getByRole('button', { name: 'Trip practice', exact: true }).click();
  await expect(composer).toHaveValue('Unsaved trip question');
  await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
  await expect(details.getByRole('button', { name: 'Remove Partner', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Remove Coach', exact: true })).toHaveCount(0);
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('button', { name: 'Discard Thread', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trip practice', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Coach', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Partner', exact: true })).toBeVisible();
  expect(nativeCore.metadata().providerRequests).toBe(0);
});
