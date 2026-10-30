/// <reference types="node" />
import { expect, type Response, type Route } from '@playwright/test';
import { EventEmitter, once } from 'node:events';
import { test, openNativeConversation } from './messenger-native-fixture';

test('Home releases Messenger status polling without cancelling the native generation', async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await page.clock.install({ time: new Date('2026-10-30T00:00:00Z') });
  await openNativeConversation(page, nativeCore);
  nativeCore.providerMode('hold');
  const events = new EventEmitter();
  let generationId = '';
  let statusReads = 0;
  let holdNext = false;
  await page.route(`${nativeCore.url}/invoke`, async route => {
    const payload = route.request().postDataJSON();
    const command = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request).command : null;
    if (command?.action !== 'read_generation') { await route.continue(); return; }
    statusReads++;
    if (!holdNext || generationId) { await route.continue(); return; }
    const response = await route.fetch();
    const value = JSON.parse((await response.json()).value);
    expect(value).toMatchObject({ type: 'conversation', result: { kind: 'generation' } });
    generationId = value.result.generation.id;
    const released = once(events, 'released', { signal: AbortSignal.timeout(15000) });
    events.emit('held');
    await released;
    await route.fulfill({ response });
  });
  const isStatusReceipt = (response: Response) => {
    if (response.url() !== `${nativeCore.url}/invoke`) return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).command?.action === 'read_generation';
  };
  const firstStatus = page.waitForResponse(isStatusReceipt);
  const started = nativeCore.nextProviderStart();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Keep generating while I visit Home.');
  await composer.press('Enter');
  await started;
  await (await firstStatus).finished();
  await expect(composer).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
  const held = once(events, 'held', { signal: AbortSignal.timeout(15000) });
  holdNext = true;
  await held;
  await page.clock.pauseAt(new Date('2026-10-30T01:00:00Z'));
  const readsBeforeHome = statusReads;
  const receipt = page.waitForResponse(isStatusReceipt);
  try {
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  } finally {
    events.emit('released');
  }
  await (await receipt).finished();
  // Timer cleanup is the behavior under test. Advance four polling periods,
  // rather than waiting in wall time for an absence of network activity.
  await page.clock.runFor(2400);
  expect(statusReads).toBe(readsBeforeHome);
  expect(nativeCore.metadata()).toMatchObject({ providerRequests: 1, activeProvider: true });
  const saved = JSON.parse(await nativeCore.invoke('runtime_execute', {
    request: JSON.stringify({ type: 'conversation', command: { action: 'read_generation', id: generationId } }),
  }));
  expect(saved).toMatchObject({ type: 'conversation', result: { kind: 'generation',
    generation: { id: generationId, status: 'streaming' } } });

  await page.clock.resume();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  const closed = nativeCore.nextProviderClose();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await closed;
  await expect(page.getByText(/· cancelled$/)).toBeVisible();
  expect(nativeCore.metadata()).toMatchObject({ providerRequests: 1, activeProvider: false });
});

for (const loss of ['admission', 'owner validation', 'history validation'] as const) {
for (const action of ['Stop', 'Close', 'Close pending', 'source replacement', 'reopen'] as const) {
test(`${action} after a lost explanation ${loss} receipt cancels the same native request`, async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Give an example with children.');
  await composer.press('Enter');
  const analysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
  await expect(analysis).toBeEnabled();
  await analysis.click();
  await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
  nativeCore.providerMode('hold');
  let admission = '';
  let explanationOwner = '';
  let lost = false;
  const attempts: unknown[] = [];
  const lossEvents = new EventEmitter();
  async function loseReceipt(route: Route) {
    if (action === 'Close pending') {
      const released = once(lossEvents, 'released', { signal: AbortSignal.timeout(5000) });
      lossEvents.emit('ready');
      await released;
    }
    lost = true;
    await route.abort('failed');
  }
  await page.route(`${nativeCore.url}/invoke`, async route => {
    const payload = route.request().postDataJSON();
    const command = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request).command : null;
    if (command?.action === 'explain') {
      attempts.push(command);
      if (admission) { await route.continue(); return; }
      const response = await route.fetch();
      const value = JSON.parse((await response.json()).value);
      expect(value).toMatchObject({ type: 'conversation', result: { kind: 'generation' } });
      admission = value.result.generation.id;
      explanationOwner = value.result.generation.conversationId;
      if (loss === 'admission') await loseReceipt(route);
      else await route.fulfill({ response });
    } else if (!lost && admission && (loss === 'owner validation'
      ? command?.action === 'get_conversation' && command.id === explanationOwner
      : loss === 'history validation' && command?.action === 'read_messages'
        && command.conversationId === explanationOwner)) {
      await route.fetch();
      await loseReceipt(route);
    } else await route.continue();
  });
  const started = nativeCore.nextProviderStart();
  const lossReady = action === 'Close pending'
    ? once(lossEvents, 'ready', { signal: AbortSignal.timeout(5000) }) : null;
  await page.getByTestId('inspector-panel').getByRole('button', { name: 'Explain', exact: true }).click();
  await started;
  const explanation = page.getByRole('dialog', { name: 'Explain selected text', exact: true });
  if (lossReady) await lossReady;
  else await expect(explanation.getByRole('alert')).toBeVisible();
  const closed = nativeCore.nextProviderClose();
  if (action === 'Close pending') {
    try { await explanation.getByRole('button', { name: 'Close', exact: true }).click(); }
    finally { lossEvents.emit('released'); }
  } else if (action === 'Stop') {
    await explanation.getByRole('button', { name: 'Stop explanation', exact: true }).click();
  } else if (action === 'source replacement') {
    // Use real SPA navigation. A hard page.goto destroys JavaScript without
    // running React cleanup and is not a source transition in the native app.
    await explanation.getByRole('button', { name: 'Provider settings in Chats', exact: true }).click();
  } else {
    await explanation.getByRole('button', { name: 'Close', exact: true }).click();
    if (action === 'reopen')
      await page.getByTestId('inspector-panel').getByRole('button', { name: 'Explain', exact: true }).click();
  }
  await closed;
  const saved = JSON.parse(await nativeCore.invoke('runtime_execute', {
    request: JSON.stringify({ type: 'conversation', command: { action: 'read_generation', id: admission } }),
  }));
  expect(saved).toMatchObject({ type: 'conversation', result: { kind: 'generation', generation: { status: 'cancelled' } } });
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  if (action === 'Stop' || action === 'reopen')
    await expect(explanation.getByText('cancelled', { exact: true })).toBeVisible();
  expect(nativeCore.metadata().providerRequests).toBe(2);
});
}
}

for (const action of ['Stop', 'Close'] as const) {
test(`${action} cancels an edited question waiting for uncertain-original recovery`, async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Give an example with children.');
  await composer.press('Enter');
  const analysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
  await expect(analysis).toBeEnabled();
  await analysis.click();
  await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
  nativeCore.providerMode('hold');
  const recoveryEvents = new EventEmitter();
  let originalId = '';
  let heldRecovery = false;
  await page.route(`${nativeCore.url}/invoke`, async route => {
    const payload = route.request().postDataJSON();
    const command = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request).command : null;
    if (command?.action !== 'explain') { await route.continue(); return; }
    if (!originalId) {
      originalId = command.commandId;
      await route.fetch();
      await route.abort('failed');
    } else if (command.commandId === originalId && !heldRecovery) {
      heldRecovery = true;
      const response = await route.fetch();
      const released = once(recoveryEvents, 'released', { signal: AbortSignal.timeout(5000) });
      recoveryEvents.emit('ready');
      await released;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const started = nativeCore.nextProviderStart();
  const inspector = page.getByTestId('inspector-panel');
  await inspector.getByRole('button', { name: 'Explain', exact: true }).click();
  await started;
  const explanation = page.getByRole('dialog', { name: 'Explain selected text', exact: true });
  await expect(explanation.getByRole('alert')).toBeVisible();
  await explanation.getByRole('textbox', { name: 'Question or correction request', exact: true }).fill('Use another example.');
  nativeCore.providerMode('complete');
  const recovering = once(recoveryEvents, 'ready', { signal: AbortSignal.timeout(5000) });
  await explanation.getByRole('button', { name: 'Ask another question', exact: true }).click();
  await recovering;
  const closed = nativeCore.nextProviderClose();
  try {
    await explanation.getByRole('button', { name: action === 'Stop' ? 'Stop explanation' : 'Close', exact: true }).click();
  } finally { recoveryEvents.emit('released'); }
  await closed;
  if (action === 'Close') await inspector.getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(explanation.getByText('cancelled', { exact: true })).toBeVisible();
  expect(nativeCore.metadata().providerRequests).toBe(2);
  // Only this subsequent explicit action may admit the edited question.
  await explanation.getByRole('button', { name: 'Ask another question', exact: true }).click();
  await expect(explanation.getByText('complete', { exact: true })).toBeVisible();
  expect(nativeCore.metadata().providerRequests).toBe(3);
});
}

for (const terminal of ['cancelled', 'failed'] as const) {
test(`an edited question after ${terminal} is admitted with the new instruction`, async ({ page, nativeCore }) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Give an example with children.');
  await composer.press('Enter');
  const analysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
  await expect(analysis).toBeEnabled();
  await analysis.click();
  await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
  nativeCore.providerMode(terminal === 'cancelled' ? 'hold' : 'fail');
  const started = terminal === 'cancelled' ? nativeCore.nextProviderStart() : null;
  await page.getByTestId('inspector-panel').getByRole('button', { name: 'Explain', exact: true }).click();
  if (started) await started;
  const explanation = page.getByRole('dialog', { name: 'Explain selected text', exact: true });
  if (terminal === 'cancelled') {
    const closed = nativeCore.nextProviderClose();
    await explanation.getByRole('button', { name: 'Stop explanation', exact: true }).click();
    await closed;
  }
  await expect(explanation.getByText(terminal, { exact: true })).toBeVisible();
  nativeCore.providerMode('complete');
  const question = 'Explain why this form is plural.';
  await explanation.getByRole('textbox', { name: 'Question or correction request', exact: true }).fill(question);
  const admitted = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && ['explain', 'retry_generation'].includes(JSON.parse(payload.args.request).command?.action);
  });
  await explanation.getByRole('button', { name: 'Ask another question', exact: true }).click();
  const value = JSON.parse((await (await admitted).json()).value);
  expect(value).toMatchObject({ type: 'conversation', result: { kind: 'generation' } });
  await expect(explanation.getByText('complete', { exact: true })).toBeVisible();
  const history = JSON.parse(await nativeCore.invoke('runtime_execute', {
    request: JSON.stringify({ type: 'conversation', command: { action: 'read_messages',
      conversationId: value.result.generation.conversationId, before: null, query: '' } }),
  }));
  expect(history.result.page.items.find((message: { id: string }) =>
    message.id === value.result.generation.userMessageId)?.text).toBe(question);
  expect(nativeCore.metadata().providerRequests).toBe(3);
});
}

test('opening accepted source proposals checkpoints the conversation and preserves management drafts', async ({ page, nativeCore }, info) => {
  await openNativeConversation(page, nativeCore);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Material', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search Material', exact: true });
  const managementDraft = 'Unsubmitted search before accepting a source proposal';
  await search.fill(managementDraft);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Give an example with children.');
  await composer.press('Enter');
  const analysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
  await expect(analysis).toBeEnabled();
  const unsent = 'Keep this unsent conversation draft after proposal acceptance.';
  await composer.fill(unsent);
  await analysis.click();
  await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
  await page.getByTestId('inspector-panel').getByRole('button', { name: 'Propose Material', exact: true }).click();
  const proposals = page.getByRole('dialog', { name: 'Material proposals', exact: true });
  await proposals.getByRole('textbox', { name: 'Meaning', exact: true }).fill('Accepted source meaning.');
  await proposals.getByRole('button', { name: 'Save proposal', exact: true }).click();
  await proposals.getByRole('button', { name: 'Accept proposal', exact: true }).click();
  await expect(proposals.getByTestId('material-proposal-result')).toContainText('Saved Material · committed revision 1');
  await proposals.getByRole('button', { name: 'Open saved Material', exact: true }).click();
  await expect(page.getByTestId('inspector-panel')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Meaning', exact: true })).toHaveValue('Accepted source meaning.');
  await expect(search).toHaveValue(managementDraft);
  for (const width of [1080, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: info.outputPath(`accepted-proposal-material-${width}.png`) });
  }
  await page.getByRole('button', { name: 'Return to source', exact: true }).click();
  const original = page.getByRole('dialog', { name: 'Captured message', exact: true });
  await expect(original.getByText('Children walked home.', { exact: true })).toBeVisible();
  await original.getByRole('button', { name: 'Close captured source', exact: true }).click();
  await expect(composer).toHaveValue(unsent);
  expect(nativeCore.metadata().providerRequests).toBe(1);
});

test('message proposal Return restores the captured original instead of only opening its chat', async ({ page, nativeCore }, info) => {
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Give an example with children.');
  await composer.press('Enter');
  const analysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
  await expect(analysis).toBeEnabled();
  const unsent = 'Keep this unsent draft when returning to a pending proposal source.';
  await composer.fill(unsent);
  await analysis.click();
  await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
  await page.getByTestId('inspector-panel').getByRole('button', { name: 'Propose Material', exact: true }).click();
  const proposals = page.getByRole('dialog', { name: 'Material proposals', exact: true });
  await proposals.getByRole('textbox', { name: 'Meaning', exact: true }).fill('Young people.');
  await proposals.getByRole('button', { name: 'Save proposal', exact: true }).click();
  await expect(proposals.getByTestId('material-proposal-result')).toHaveText('Proposal saved for review.');
  await proposals.getByRole('button', { name: 'Return to proposal source', exact: true }).click();
  await expect(proposals).toBeHidden();
  const original = page.getByRole('dialog', { name: 'Captured message', exact: true });
  await expect(original.getByText('Children walked home.', { exact: true })).toBeVisible();
  await expect(original.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
  await expect(original.getByRole('button', { name: 'Explain', exact: true })).toBeDisabled();
  await expect(page.getByTestId('inspector-panel')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('proposalId')).toBeTruthy();
  for (const width of [1080, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: info.outputPath(`message-proposal-return-${width}.png`) });
  }
  await original.getByRole('button', { name: 'Close captured source', exact: true }).click();
  await expect(composer).toHaveValue(unsent);
  expect(nativeCore.metadata().providerRequests).toBe(1);
});

test('message Capture returns the immutable original after an edit and native restart', async ({ page, nativeCore }, info) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Give an example with children.');
  await composer.press('Enter');
  const analysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
  await expect(analysis).toBeEnabled();
  await analysis.click();
  await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
  const inspector = page.getByTestId('inspector-panel');
  await expect(inspector.getByText('child', { exact: true }).first()).toBeVisible();
  await inspector.getByRole('button', { name: 'Capture Children', exact: true }).click();
  await expect(inspector.getByRole('button', { name: 'Open saved Children: revision 1', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
  await page.getByRole('button', { name: 'Message actions', exact: true }).last().click();
  const message = page.getByRole('dialog', { name: 'Message', exact: true });
  await message.getByRole('button', { name: 'Edit message', exact: true }).click();
  await message.getByRole('textbox', { name: 'Message text', exact: true }).fill('The original reply has changed.');
  await message.getByRole('button', { name: 'Save message', exact: true }).click();
  await expect(message).toBeHidden();
  await expect(page.getByTestId('conversation-history').getByText('The original reply has changed.', { exact: true })).toBeVisible();
  await nativeCore.crashRestart();
  await page.goto('/');
  await page.getByRole('button', { name: 'Material', exact: true }).click();
  await page.getByRole('button', { name: 'Return to source: Children', exact: true }).click();
  const original = page.getByRole('dialog', { name: 'Captured message', exact: true });
  await expect(original.getByText('Children walked home.', { exact: true })).toBeVisible();
  await expect(original.getByText('The original reply has changed.', { exact: true })).toHaveCount(0);
  await expect(original.getByRole('button', { name: 'Explain', exact: true })).toBeDisabled();
  await expect(original.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('captured-message-original.png') });
  await original.getByRole('button', { name: 'Children: untracked', exact: true }).click();
  await expect(page.getByTestId('inspector-panel').getByText('child', { exact: true }).first()).toBeVisible();
  expect(nativeCore.metadata().providerRequests).toBe(1);
});

test('Inspector explanation admits the actual selected message and source context', async ({ page, nativeCore }, info) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Give an example with children.');
  await composer.press('Enter');
  const analysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
  await expect(analysis).toBeEnabled();
  await analysis.click();
  await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
  const inspector = page.getByTestId('inspector-panel');
  const admitted = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).command?.action === 'explain';
  });
  await inspector.getByRole('button', { name: 'Explain', exact: true }).click();
  const response = await admitted;
  const command = JSON.parse(response.request().postDataJSON().args.request).command;
  expect(command.source).toMatchObject({
    text: 'Children walked home.',
    locator: { kind: 'message', messageRevision: 1, contextStart: 0, selectionStart: 0, selectionEnd: 8 },
  });
  expect(JSON.parse((await response.json()).value)).toMatchObject({
    type: 'conversation', result: { kind: 'generation', generation: { status: 'pending' } },
  });
  const explanation = page.getByRole('dialog', { name: 'Explain selected text', exact: true });
  await expect(explanation.getByText('complete', { exact: true })).toBeVisible();
  await expect(explanation.getByText('Children walked home.', { exact: true })).toBeVisible();
  await explanation.getByRole('button', { name: 'Show original context', exact: true }).click();
  await expect(explanation.getByText('Children walked home.', { exact: true })).toHaveCount(2);
  expect(nativeCore.metadata().providerRequests).toBe(2);
  await info.attach('actual-explanation-source.json', {
    body: JSON.stringify(command.source, null, 2), contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('message-context-explanation.png') });
});

test('Runtime Inspector shows the saved native request inputs and response without issuing another generation', async ({ page, nativeCore }, info) => {
  test.setTimeout(60_000);
  await openNativeConversation(page, nativeCore);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Inspect this actual request.');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Show analysis', exact: true }).last()).toBeEnabled();
  await page.getByRole('button', { name: 'Message actions', exact: true }).last().click();
  const traced = page.waitForResponse(response => {
    if (response.url() !== `${nativeCore.url}/invoke` || response.request().method() !== 'POST') return false;
    const payload = response.request().postDataJSON();
    return typeof payload.args?.request === 'string'
      && JSON.parse(payload.args.request).command?.action === 'read_trace';
  });
  await page.getByRole('dialog', { name: 'Message', exact: true })
    .getByRole('button', { name: 'Inspect execution', exact: true }).click();
  const saved = JSON.parse((await (await traced).json()).value);
  expect(saved).toMatchObject({
    type: 'conversation', result: { kind: 'trace', page: { generation: { status: 'complete' } } },
  });
  expect(saved.result.page.inputs).toHaveLength(1);
  expect(saved.result.page.items.map((item: { kind: string }) => item.kind)).toEqual(
    expect.arrayContaining(['prompt', 'request', 'delta', 'response']),
  );
  const request = saved.result.page.items.find((item: { kind: string }) => item.kind === 'request');
  expect(request.content).toContain(`${nativeCore.url}/v1/chat/completions`);
  expect(request.content).not.toMatch(/authorization|bearer/i);
  const trace = page.getByRole('dialog', { name: 'Runtime Inspector', exact: true });
  await expect(trace.getByText(/Source inputs:/)).toBeVisible();
  await expect(trace.getByText('Children walked home.', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('message-native-runtime-inspector.png') });
  expect(nativeCore.metadata().providerRequests).toBe(1);
});
