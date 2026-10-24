/// <reference types="node" />
import { expect } from '@playwright/test';
import { test, openNativeConversation } from './messenger-native-fixture';

test('a rejected oversized draft can be corrected without replaying the rejected intent', async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('日'.repeat(3000));
  const rejected = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).command?.action === 'save_draft';
  });
  await composer.press('Enter');
  const native = JSON.parse((await (await rejected).json()).value);
  expect(native).toMatchObject({ type: 'error', code: 'invalid_conversation' });
  await expect(page.getByRole('alert').first()).toBeVisible();
  await composer.fill('Recovered draft');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('conversation-history').getByText('Recovered draft', { exact: true })).toBeVisible();
  await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true })).toBeVisible();
  expect(nativeCore.metadata().providerRequests).toBe(1);
});

for (const loss of ['draft', 'send', 'clear'] as const) {
  for (const laterDraft of ['', 'Next authored question']) {
    test(`a lost ${loss} acknowledgement preserves ${laterDraft ? 'later edits' : 'the original intent'} without duplicating the turn`, async ({ page, nativeCore }) => {
      test.setTimeout(60_000);
      await openNativeConversation(page, nativeCore);
      const attempts: unknown[] = [];
      await page.route(`${nativeCore.url}/invoke`, async route => {
        const payload = route.request().postDataJSON();
        const command = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request).command : null;
        const selected = loss === 'send' ? command?.action === 'send_turn'
          : command?.action === 'save_draft' && command.draft.text === (loss === 'clear' ? '' : 'Keep this turn');
        if (!selected) { await route.continue(); return; }
        attempts.push(command);
        if (attempts.length !== 1) { await route.continue(); return; }
        // The real native transaction commits, but the renderer never gets its receipt.
        const response = await route.fetch();
        expect(JSON.parse((await response.json()).value)).toMatchObject({
          type: 'conversation', result: { kind: loss === 'send' ? 'generation' : 'draft' },
        });
        await route.abort('failed');
      });
      const composer = page.getByRole('textbox', { name: 'Message', exact: true });
      await composer.fill('Keep this turn');
      await composer.press('Enter');
      await expect(page.getByRole('alert').first()).toBeVisible();
      if (laterDraft) await composer.fill(laterDraft);
      const acknowledged = page.waitForResponse(response => {
        if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
        const payload = response.request().postDataJSON();
        return typeof payload.args?.request === 'string'
          && JSON.stringify(JSON.parse(payload.args.request).command) === JSON.stringify(attempts[0]);
      });
      await page.getByRole('button', { name: 'Retry action', exact: true }).click();
      expect(JSON.parse((await (await acknowledged).json()).value)).toMatchObject({
        type: 'conversation', result: { kind: loss === 'send' ? 'generation' : 'draft' },
      });
      await expect(page.getByTestId('conversation-history').getByText('Keep this turn', { exact: true })).toBeVisible();
      await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true })).toBeVisible();
      expect(attempts.length).toBeGreaterThanOrEqual(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(nativeCore.metadata().providerRequests).toBe(1);
      await expect(composer).toHaveValue(laterDraft);
      if (laterDraft) await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    });
  }
}

for (const recovery of ['stop', 'restart', 'provider failure'] as const) {
  test(`${recovery} retains the authored turn and permits an explicit fresh response`, async ({ page, nativeCore }) => {
    test.setTimeout(60_000);
    await openNativeConversation(page, nativeCore);
    nativeCore.providerMode(recovery === 'provider failure' ? 'fail' : 'hold');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Preserve my authored message');
    await composer.press('Enter');
    await expect(page.getByTestId('conversation-history').getByText('Preserve my authored message', { exact: true })).toBeVisible();
    if (recovery !== 'provider failure') {
      await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true })).toBeVisible();
      if (recovery === 'stop') {
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
      } else {
        await nativeCore.crashRestart();
        await page.reload();
        await page.getByRole('button', { name: 'Coach', exact: true }).click();
      }
    }
    const status = recovery === 'stop' ? 'cancelled' : recovery === 'restart' ? 'interrupted' : 'failed';
    await expect(page.getByText(new RegExp(`· ${status}$`))).toBeVisible();
    nativeCore.providerMode('complete');
    await page.getByRole('button', { name: 'Message actions', exact: true }).last().click();
    const message = page.getByRole('dialog', { name: 'Message', exact: true });
    const retried = page.waitForResponse(response => {
      if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
      const payload = response.request().postDataJSON();
      return typeof payload.args?.request === 'string'
        && JSON.parse(payload.args.request).command?.action === 'retry_generation';
    });
    await message.getByRole('button', { name: 'Retry response', exact: true }).click();
    expect(JSON.parse((await (await retried).json()).value)).toMatchObject({
      type: 'conversation', result: { kind: 'generation', generation: { status: 'pending' } },
    });
    await message.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(message).toBeHidden();
    await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show analysis', exact: true }).last()).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('conversation-history').getByText('Preserve my authored message', { exact: true })).toHaveCount(1);
    expect(nativeCore.metadata().providerRequests).toBe(2);
  });
}
