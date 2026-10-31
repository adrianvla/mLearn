/// <reference types="node" />
import { expect } from '@playwright/test';
import { EventEmitter, once } from 'node:events';
import { test, openNativeConversation } from './messenger-native-fixture';

for (const { width, departure } of [
  { width: 390, departure: 'Back' },
  { width: 1080, departure: 'Back' },
  { width: 390, departure: 'Home' },
] as const) test(`${departure} retains an uncertain Messenger draft save and its exact retry before departure at ${width}`, async ({ page, nativeCore }, info) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.setViewportSize({ width, height: 900 });
  await page.getByRole('button', { name: 'Material', exact: true }).click();
  const materialDraft = 'Unsubmitted Material query before Messenger Back';
  await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill(materialDraft);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const draft = 'Keep this unsent message through browser Back.';
  await composer.fill(draft);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  const events = new EventEmitter();
  const attempts: unknown[] = [];
  await page.route(`${nativeCore.url}/invoke`, async route => {
    const payload = route.request().postDataJSON();
    const command = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request).command : null;
    if (command?.action !== 'save_draft' || command.draft.text !== draft) {
      await route.continue(); return;
    }
    attempts.push(command);
    if (attempts.length !== 1) { await route.continue(); return; }
    const response = await route.fetch();
    expect(JSON.parse((await response.json()).value)).toMatchObject({
      type: 'conversation', result: { kind: 'draft' },
    });
    const released = once(events, 'released', { signal: AbortSignal.timeout(15000) });
    events.emit('held');
    await released;
    await route.abort('failed');
  });
  try {
    const held = once(events, 'held', { signal: AbortSignal.timeout(5000) });
    if (departure === 'Home') await Promise.all([
      held, page.getByRole('button', { name: 'Chats and People', exact: true }).click(),
    ]);
    await Promise.all([held, departure === 'Back' ? page.goBack() : page.getByRole('button', { name: 'Home', exact: true }).click()]);
    await expect(page).toHaveURL(/\/messenger/);
    if (departure === 'Back') {
      await expect(composer).toHaveValue(draft);
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    } else await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`messenger-${departure.toLowerCase()}-save-pending-${width}.png`) });
    events.emit('released');
    const retry = page.getByRole('button', { name: 'Retry action', exact: true });
    await expect(retry).toBeVisible();
    await expect(page).toHaveURL(/\/messenger/);
    if (departure === 'Back') await expect(composer).toHaveValue(draft);
    await page.screenshot({ path: info.outputPath(`messenger-${departure.toLowerCase()}-save-failed-${width}.png`) });
    await retry.click();
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await page.getByRole('button', { name: 'Material', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search Material', exact: true })).toHaveValue(materialDraft);
    await nativeCore.crashRestart();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Coach', exact: true }).click();
    await expect(composer).toHaveValue(draft);
    expect(nativeCore.metadata().providerRequests).toBe(0);
    await page.screenshot({ path: info.outputPath(`messenger-${departure.toLowerCase()}-draft-restored-${width}.png`) });
  } finally {
    events.emit('released');
    await page.unroute(`${nativeCore.url}/invoke`);
  }
});

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
  test(`${recovery} retains the authored turn and permits an explicit fresh response`, async ({ page, nativeCore }, testInfo) => {
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
    const refreshEvents = new EventEmitter();
    const heldRefresh = recovery === 'provider failure'
      ? once(refreshEvents, 'held', { signal: AbortSignal.timeout(15000) }) : null;
    if (heldRefresh) {
      let admitted = false;
      await page.route(`${nativeCore.url}/invoke`, async route => {
        const payload = route.request().postDataJSON();
        const command = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request).command : null;
        if (command?.action === 'retry_generation') {
          const response = await route.fetch();
          admitted = true;
          await route.fulfill({ response });
        } else if (admitted && command?.action === 'get_conversation') {
          admitted = false;
          const response = await route.fetch();
          const released = once(refreshEvents, 'released', { signal: AbortSignal.timeout(15000) });
          refreshEvents.emit('held');
          await released;
          await route.fulfill({ response });
        } else await route.continue();
      });
    }
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
    try {
      if (heldRefresh) await heldRefresh;
      await message.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(message).toBeHidden();
    } finally {
      refreshEvents.emit('released');
    }
    await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show analysis', exact: true }).last()).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('conversation-history').getByText('Preserve my authored message', { exact: true })).toHaveCount(1);
    expect(nativeCore.metadata().providerRequests).toBe(2);
    if (heldRefresh) await page.screenshot({ path: testInfo.outputPath('message-dismissed-after-admitted-retry.png') });
  });
}
