import { test, expect } from './fixture';
import { createConversation, memory, openMessenger, sendMessage, tools } from './messenger';

// PLAN M09 Review: reuse a person across a Thread and Room, integrate selected continuity,
// test an absent participant and a spoiler/canon boundary, correct/delete a message and inspect
// affected memory; ordinary task-focused use still needs no world setup.
test('M09 Rooms keep shared history, witness-limited memory and the canon boundary', async ({ page, nativeCore }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  await openMessenger(page, nativeCore, ['Ana', 'Ben']);

  // Task-focused practice: a Thread works with no scene or world setup.
  await createConversation(page, 'Cafe practice', 'Separate history', ['Ana']);
  await expect(page.getByText('Separate history', { exact: true }).first()).toBeVisible();
  await sendMessage(page, 'Hello Ana');

  // The same person joins a persistent Room with Ben.
  await createConversation(page, 'Cafe', 'Shared history', ['Ana', 'Ben']);
  await tools(page);
  await page.getByRole('button', { name: 'Scene and canon', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'Scene and canon', exact: true });
  await scene.getByRole('textbox', { name: 'Scene', exact: true }).fill('A rainy afternoon in the cafe');
  await scene.getByRole('textbox', { name: 'Your progress point', exact: true }).fill('2');
  await scene.getByRole('button', { name: 'Add canon', exact: true }).click();
  await scene.getByRole('textbox', { name: 'Canon 1 point', exact: true }).fill('1');
  await scene.getByRole('textbox', { name: 'Canon 1', exact: true }).fill('Ana owns the cafe');
  await scene.getByRole('button', { name: 'Add canon', exact: true }).click();
  await scene.getByRole('textbox', { name: 'Canon 2 point', exact: true }).fill('5');
  await scene.getByRole('textbox', { name: 'Canon 2', exact: true }).fill('Ben secretly sold the cafe');
  await scene.getByRole('button', { name: 'Save scene', exact: true }).click();
  await expect(scene.getByRole('button', { name: 'Save scene', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('m09-scene.png') });
  await scene.getByRole('button', { name: 'Close', exact: true }).click();

  // Ben is away: he cannot answer and does not witness what is said meanwhile.
  await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Conversation details', exact: true });
  await details.getByRole('button', { name: 'Ben is away', exact: true }).click();
  await expect(details.getByRole('button', { name: 'Ben is away', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await details.getByRole('button', { name: 'Save conversation', exact: true }).click();
  await expect(details).toBeHidden();
  await page.getByRole('combobox', { name: /^Responding participant/ }).click();
  await expect(page.getByRole('option', { name: 'Ben', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Whoever the scene calls for', exact: true }).click();
  await sendMessage(page, 'Ana, how is the cafe today?');

  // The spoiler boundary: canon beyond progress never reaches generation.
  await page.getByRole('button', { name: 'Message actions', exact: true }).last().click();
  await page.getByRole('button', { name: 'Inspect execution', exact: true }).click();
  const trace = page.getByRole('dialog', { name: 'Runtime Inspector', exact: true });
  await expect(trace.getByText(/Ana owns the cafe/).first()).toBeVisible();
  await expect(trace.getByText(/Ben secretly sold/)).toHaveCount(0);
  await expect(trace.getByText(/"absent":\["Ben"\]/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('m09-trace.png') });
  await trace.getByRole('button', { name: 'Close', exact: true }).click();

  // Ben returns; his memory excludes what happened while he was away.
  await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
  await details.getByRole('button', { name: 'Ben is away', exact: true }).click();
  await details.getByRole('button', { name: 'Save conversation', exact: true }).click();
  await expect(details).toBeHidden();
  expect(await memory(page, 'Ben')).not.toContain('how is the cafe today');
  expect(await memory(page, 'Ana')).toContain('how is the cafe today');

  // Deliberate integration of the Thread into the Room's shared history.
  await page.getByRole('button', { name: /^Cafe practice/ }).click();
  await tools(page);
  await page.getByRole('button', { name: 'Add to shared history', exact: true }).click();
  const integrate = page.getByRole('dialog', { name: 'Add to shared history', exact: true });
  await integrate.getByRole('button', { name: 'Add messages', exact: true }).click();
  await expect(integrate).toBeHidden();
  const history = page.getByTestId('conversation-history');
  await expect(history.getByText('Hello Ana', { exact: true })).toBeVisible();
  await expect(history.getByText('Added from practice').first()).toBeVisible();
  expect(await memory(page, 'Ana')).toContain('Hello Ana');
  expect(await memory(page, 'Ben')).not.toContain('Hello Ana');
  await page.screenshot({ path: info.outputPath('m09-integrated.png') });

  // Correcting history updates memory: a deleted message is no longer remembered.
  const row = history.getByText('Hello Ana', { exact: true }).locator('xpath=ancestor::*[.//*[@aria-label="Message actions"]][1]');
  await row.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('button', { name: 'Delete message', exact: true }).click();
  await expect(history.getByText('Hello Ana', { exact: true })).toHaveCount(0);
  expect(await memory(page, 'Ana')).not.toContain('Hello Ana');
});
