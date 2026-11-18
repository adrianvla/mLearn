import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { test, expect, enableDeveloperMode } from './fixture';
import { openMessenger, tools } from './messenger';

// PLAN M07 Review: start a conversation from a contact, inspect/capture a message, stop/retry
// generation, read older history while new content arrives and reopen with the provider
// unavailable. Inspect the actual prompt/tool response without exposing secrets. Source-based
// explanation returns to the same reading/video context.
test('M07 People, conversation, capture, stop/retry, history, offline reopen, runtime inspection and explanation', async ({ page, nativeCore }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  await enableDeveloperMode(page);
  await openMessenger(page, nativeCore, ['Coach']);

  // Start a conversation from the contact, independent of any existing chat.
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const history = page.getByTestId('conversation-history');
  const composer = page.getByTestId('conversation-composer');
  await composer.fill('Tell me about children.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(history.getByText('Children walked home.', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Inspect and capture language in a message.
  await page.getByRole('button', { name: 'Show analysis', exact: true }).last().click();
  await history.getByRole('button', { name: /^Children: / }).last().click();
  const inspector = page.getByTestId('inspector-panel');
  await inspector.getByRole('button', { name: 'Capture Children', exact: true }).click();
  await expect(inspector.getByRole('button', { name: 'Open saved Children: revision 1', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: /^Close Inspect/ }).click();

  // Stop a held generation, then retry it explicitly.
  nativeCore.providerMode('hold');
  const started = nativeCore.nextProviderStart();
  await composer.fill('And one more sentence, please.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(history.getByText(/cancelled/).last()).toBeVisible();
  nativeCore.providerMode('complete');
  await page.getByRole('button', { name: 'Message actions', exact: true }).last().click();
  await page.getByRole('button', { name: 'Retry response', exact: true }).click();
  await expect(history.getByText('Children walked home.', { exact: true })).toHaveCount(2, { timeout: 30_000 });

  // Older history pages in while a new reply arrives, without jumping to the latest message.
  const [conversation] = (await client.conversations()).items;
  for (let turn = 0; turn < 20; turn++) {
    let generation!: Awaited<ReturnType<typeof client.sendConversationTurn>>;
    // The runtime answers `busy` while the open conversation's analysis runs; that is retryable backpressure.
    await expect(async () => {
      const current = await client.conversation(conversation.id);
      generation = await client.sendConversationTurn(client.prepareConversationTurn(current, current.participants[0], `Earlier turn ${turn}`));
    }).toPass({ timeout: 30_000 });
    await expect.poll(async () => (await client.conversationGeneration(generation.id)).status).toBe('complete');
  }
  await page.reload();
  await page.getByRole('button', { name: /^Coach/ }).first().click();
  await expect(page.getByRole('button', { name: 'Older messages', exact: true })).toBeVisible();
  const anchor = history.getByText('Earlier turn 0', { exact: true });
  const preview = async () => (await client.conversations()).previews.find(item => item.conversationId === conversation.id);
  const beforeSend = (await preview())?.messageId;
  await composer.fill('A new message arrives.');
  nativeCore.providerMode('hold');
  const arriving = nativeCore.nextProviderStart();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await arriving;
  await page.getByRole('button', { name: 'Older messages', exact: true }).click();
  await anchor.scrollIntoViewIfNeeded();
  await expect(anchor).toBeInViewport();
  nativeCore.releaseProvider();
  // Once the reply has landed, the reader is still on the older page they opened.
  await expect.poll(async () => {
    const latest = await preview();
    return latest?.messageId !== beforeSend && latest?.status === 'complete' && latest.text === 'Children walked home.';
  }, { timeout: 30_000 }).toBe(true);
  await expect(page.getByRole('button', { name: 'Latest', exact: true })).toBeVisible();
  await expect(anchor).toBeInViewport();
  await page.getByRole('button', { name: 'Latest', exact: true }).click();
  await expect.poll(async () => {
    const text = await history.innerText();
    return text.lastIndexOf('Children walked home.') > text.lastIndexOf('A new message arrives.');
  }, { timeout: 30_000 }).toBe(true);
  nativeCore.providerMode('complete');

  // The runtime inspection shows the real prompt and request, and no session secret.
  await tools(page);
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  const provider = page.getByRole('dialog', { name: 'Conversation provider', exact: true });
  await provider.getByRole('textbox', { name: 'Session-only API key', exact: true }).fill('sk-journey-secret-7781');
  await provider.getByRole('button', { name: 'Set session key', exact: true }).click();
  await expect(provider.getByText('Session credential set', { exact: true })).toBeVisible();
  await provider.getByRole('button', { name: 'Close', exact: true }).click();
  await composer.fill('Inspect this request.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(history.getByText('Children walked home.', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Message actions', exact: true }).last().click();
  await page.getByRole('button', { name: 'Inspect execution', exact: true }).click();
  const trace = page.getByRole('dialog', { name: 'Runtime Inspector', exact: true });
  await expect(trace.getByText(/prompt/).first()).toBeVisible();
  await expect(trace.getByText(/chat\/completions/).first()).toBeVisible();
  expect(await trace.innerText()).not.toContain('sk-journey-secret-7781');
  await page.screenshot({ path: info.outputPath('m07-trace.png') });
  await trace.getByRole('button', { name: 'Close', exact: true }).click();

  // Reopen with the provider unavailable: history stays readable and sending fails in place.
  nativeCore.providerMode('fail');
  await page.reload();
  await page.getByRole('button', { name: /^Coach/ }).first().click();
  await expect(history.getByText('Inspect this request.', { exact: true })).toBeVisible();
  await composer.fill('Are you there?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 30_000 });
  expect(await page.getByRole('alert').first().innerText()).not.toMatch(/HTTP|503|fixture/);
  await page.screenshot({ path: info.outputPath('m07-offline.png') });
  nativeCore.providerMode('complete');

  // A source-based explanation returns to the same reading context.
  const book = await client.openDocument(path.resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
  await page.goto(`/reader?id=${book.source.id}`);
  await page.getByRole('button', { name: /^Children: / }).first().click();
  await inspector.getByRole('button', { name: 'Explain', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'Explain selected text', exact: true });
  await expect(explanation.getByText('Children walked home.', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await explanation.getByRole('button', { name: 'Close', exact: true }).click();
  await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
  await expect(page).toHaveURL(new RegExp(`/reader\\?.*${book.source.id}`));
  await expect(page.getByRole('button', { name: /^Children: / }).first()).toBeVisible();
});
