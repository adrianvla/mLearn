/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { emptyMaterial } from '../../apps/client/src/features/material/content';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

async function installEnglish(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
  await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
  await page.getByRole('button', { name: /^Install .*English/ }).click();
  await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
}

test('proposal review restores its actual editor opener and preserves the unsaved Material draft', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/proposal-focus-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: a saved Material and a separate, unsubmitted editor change.
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const outcome = await client.createMaterial(client.prepareMaterial({
      ...emptyMaterial('org.mlearn.english'), phrase: 'cat', notes: 'Saved original note.',
    }));
    if (outcome.status !== 'saved') throw new Error('Expected a fresh authored Material');
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Edit cat', exact: true }).click();
    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Unsubmitted editor change.');
    const opener = page.getByRole('button', { name: 'Propose changes to saved Material', exact: true });

    // When: proposal authoring is opened from that editor and dismissed.
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Material proposals', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Saved original note.');
    await page.screenshot({ path: info.outputPath('proposal-editor-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('proposal-editor-phone.png') });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    // Then: focus and the unsaved editor survive without a native write.
    await expect(opener).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Unsubmitted editor change.');
    expect((await client.material(outcome.material.id)).content.notes).toBe('Saved original note.');
    expect((await client.materialProposals({ after: null, packageId: null, pendingOnly: false })).items).toEqual([]);
    await page.screenshot({ path: info.outputPath('proposal-return-phone.png') });
    await page.setViewportSize({ width: 1080, height: 900 });
    await opener.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('proposal-return-desktop.png') });
  } finally { await backend.close(); }
});

test('source proposals retain edits and atomically recover acceptance after a lost receipt and restart', async ({ page }, info) => {
  test.setTimeout(60_000);
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/proposal-source-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: the actual parsed Reader source and its package-produced selection.
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const document = await client.openDocument(resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
    await page.goto(`/reader?id=${document.source.id}`);
    await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
    await page.getByRole('button', { name: 'Propose Material', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Material proposals', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Phrase', exact: true })).toHaveValue('Children');
    await dialog.getByRole('textbox', { name: 'Meaning', exact: true }).fill('Young people.');
    await dialog.getByRole('textbox', { name: 'Notes', exact: true }).fill('An authored source note.');
    await dialog.getByRole('button', { name: 'Add example', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Example 1', exact: true }).fill('Children walked home.');
    await dialog.getByRole('button', { name: 'Save proposal', exact: true }).click();
    await expect(dialog.getByTestId('material-proposal-result')).toHaveText('Proposal saved for review.');
    const pending = (await client.materialProposals({ after: null, packageId: null, pendingOnly: true })).items;
    expect(pending).toHaveLength(1);
    expect(pending[0].content.source?.sourceId).toBe(document.source.id);
    expect(pending[0].content.targetId).toBeNull();
    expect((await client.materials({ after: null, sourceId: null, includeExcluded: true, query: '' })).items).toEqual([]);
    await dialog.getByRole('textbox', { name: 'Meaning', exact: true }).fill('Reviewed meaning before acceptance.');
    await dialog.getByRole('button', { name: 'Save proposal edits', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Accept proposal', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('source-proposal-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('source-proposal-phone.png') });
    const submissions: string[] = [];
    let lost = false;
    await page.route(`${backend.url}/invoke`, async route => {
      const payload = route.request().postDataJSON();
      const raw: string | undefined = payload.args?.request;
      const request = raw ? JSON.parse(raw) : null;
      if (request?.type !== 'review_material_proposal' || request.command.decision.kind !== 'accept') {
        await route.continue(); return;
      }
      submissions.push(raw ?? '');
      if (lost) { await route.continue(); return; }
      lost = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await response.body();
      await route.abort('failed');
    });

    // When: acceptance commits, its receipt is lost, and the native owner restarts.
    await dialog.getByRole('button', { name: 'Accept proposal', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Retry proposal action', exact: true })).toBeVisible();
    await backend.crashRestart();
    await dialog.getByRole('button', { name: 'Retry proposal action', exact: true }).click();

    // Then: replay returns the original commit, without duplicate Material or lost edits.
    await expect(dialog.getByTestId('material-proposal-result')).toContainText('Saved Material · committed revision 1');
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toBe(submissions[0]);
    const accepted = await client.materialProposal(pending[0].id);
    expect(accepted.state.state).toBe('accepted');
    const materials = await client.materials({ after: null, sourceId: document.source.id, includeExcluded: true, query: '' });
    expect(materials.items).toHaveLength(1);
    expect(materials.items[0].content).toMatchObject({
      phrase: 'Children', meaning: 'Reviewed meaning before acceptance.',
      notes: 'An authored source note.', examples: ['Children walked home.'], source: pending[0].content.source,
    });
    const returned = page.waitForResponse(response => {
      const payload = response.request().postDataJSON();
      return typeof payload.args?.request === 'string'
        && JSON.parse(payload.args.request).type === 'return_material_proposal_source';
    });
    await dialog.getByRole('button', { name: 'Return to proposal source', exact: true }).click();
    const result = JSON.parse((await (await returned).json()).value);
    expect(result).toMatchObject({ type: 'document_material_source', anchor: pending[0].content.source });
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('proposal-source-return-phone.png') });
    await page.setViewportSize({ width: 1080, height: 900 });
    await page.screenshot({ path: info.outputPath('proposal-source-return-desktop.png') });
    await page.unrouteAll({ behavior: 'wait' });
  } finally { await backend.close(); }
});

test('generation cancellation bypasses a held admission and retained retry exposes partial candidates for review', async ({ page }, info) => {
  test.setTimeout(60_000);
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/proposal-generation-${randomUUID()}`,
    responseText: [
      JSON.stringify({ quote: 'cat', reading: '', meaning: 'a small feline', notes: 'Reviewed generated note.', examples: ['A cat rested.'] }),
      JSON.stringify({ quote: 'not the original', reading: '', meaning: 'Ungrounded', notes: '', examples: [] }),
    ].join('\n'),
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  let releaseHeld = () => {};
  try {
    // Given: the shared provider holds real native work after admission.
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const material = await client.createMaterial(client.prepareMaterial({
      ...emptyMaterial('org.mlearn.english'), phrase: 'cat',
    }));
    if (material.status !== 'saved') throw new Error('Expected a fresh authored Material');
    const provider = await client.conversationProvider();
    await client.saveConversationProvider(client.prepareConversationProvider(provider.revision, `${backend.url}/v1`, 'fixture-local'));
    await client.setConversationSessionCredential('fixture-only');
    backend.providerMode('hold');
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Edit cat', exact: true }).click();
    await page.getByRole('button', { name: 'Propose changes to saved Material', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Material proposals', exact: true });
    await dialog.getByRole('button', { name: 'Proposal generation and saved jobs', exact: true }).click();
    let resolveForwarded = (_id: string) => {};
    const forwarded = new Promise<string>(resolve => { resolveForwarded = resolve; });
    const held = new Promise<void>(resolve => { releaseHeld = resolve; });
    let intercepted = false;
    await page.route(`${backend.url}/invoke`, async route => {
      const payload = route.request().postDataJSON();
      const request = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request) : null;
      if (intercepted || request?.type !== 'conversation' || request.command.action !== 'generate_material') {
        await route.continue(); return;
      }
      intercepted = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await response.body();
      resolveForwarded(request.command.command.commandId);
      await held;
      await route.abort('failed');
    });
    const started = backend.nextProviderStart();
    await dialog.getByRole('button', { name: 'Generate text proposals', exact: true }).click();
    const commandId = await forwarded;
    await started;

    // When: Cancel resolves the same admission through the independent control lane.
    const closed = backend.nextProviderClose();
    await dialog.getByRole('button', { name: 'Cancel proposal generation', exact: true }).click();
    await closed;
    await expect(dialog.getByTestId('material-generation-report')).toContainText('cancelled');
    releaseHeld();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(dialog.getByRole('button', { name: 'Generate text proposals', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Recover generation action', exact: true })).toHaveCount(0);

    // Then: a late receipt cannot revive work; the same native job survives restart.
    const cancelled = (await client.materialGenerations()).items.find(item => item.commandId === commandId);
    if (!cancelled) throw new Error('Cancelled generation is not retained');
    expect(cancelled.generation.status).toBe('cancelled');
    expect(backend.metadata().providerRequests).toBe(1);
    expect((await client.material(material.material.id)).content.notes).toBe('');
    await backend.crashRestart();
    await client.setConversationSessionCredential('fixture-only');
    backend.providerMode('complete');
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Review proposals', exact: true }).click();
    await dialog.getByRole('button', { name: 'Proposal generation and saved jobs', exact: true }).click();
    await dialog.getByRole('button', { name: 'cat', exact: true }).click();
    await expect(dialog.getByTestId('material-generation-report')).toContainText('cancelled');
    await dialog.getByRole('button', { name: 'Retry proposal generation', exact: true }).click();
    await expect(dialog.getByTestId('material-generation-report').getByText('complete', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Collect generated proposals', exact: true }).click();
    await expect(dialog.getByTestId('material-generation-report')).toContainText('1 of up to 4 proposals retained');
    await expect(dialog.getByTestId('material-generation-report').getByRole('alert')).toContainText('Candidate 2');
    const generated = (await client.materialGenerations()).items.find(item => item.generation.retryOf === cancelled.generation.id);
    if (!generated) throw new Error('Native generation retry is not retained');
    expect(generated.proposalIds).toHaveLength(1);
    await expect(dialog.getByText('No proposals in this view.', { exact: true })).toHaveCount(0);
    expect((await client.material(material.material.id)).content.notes).toBe('');
    await page.screenshot({ path: info.outputPath('generation-partial-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('generation-partial-phone.png') });
    await dialog.getByRole('button', { name: 'Review generated proposal 1', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Proposal generation and saved jobs', exact: true })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Meaning', exact: true })).toHaveValue('a small feline');
    await page.screenshot({ path: info.outputPath('generated-proposal-phone.png') });
    await page.setViewportSize({ width: 1080, height: 900 });
    await page.screenshot({ path: info.outputPath('generated-proposal-desktop.png') });
    await dialog.getByRole('button', { name: 'Accept proposal', exact: true }).click();
    await expect(dialog.getByTestId('material-proposal-result')).toContainText('Saved Material · committed revision 2');
    expect((await client.material(material.material.id)).content.notes).toBe('Reviewed generated note.');
    expect((await client.materials({ after: null, sourceId: null, includeExcluded: true, query: '' })).items).toHaveLength(1);
  } finally {
    releaseHeld();
    try { await page.unrouteAll({ behavior: 'wait' }); }
    finally { await backend.close(); }
  }
});

test('rejected proposals remain inspectable after restart without a provider or a Material write', async ({ page }) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/proposal-reject-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: an existing authored item with a separate replacement proposal, without provider settings.
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const saved = await client.createMaterial(client.prepareMaterial({ ...emptyMaterial('org.mlearn.english'), phrase: 'dog' }));
    if (saved.status !== 'saved') throw new Error('Expected authored Material');
    const suggestion = await client.suggestMaterial(client.prepareMaterialSuggestion({
      ...saved.material.content, meaning: 'A proposed definition.',
    }, { id: saved.material.id, revision: saved.material.revision }));
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Review proposals', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Material proposals', exact: true });
    await dialog.getByRole('button', { name: 'dog', exact: true }).click();

    // When: that proposal is explicitly rejected and the owner restarts.
    await dialog.getByRole('button', { name: 'Reject proposal', exact: true }).click();
    await expect(dialog.getByTestId('material-proposal-result')).toHaveText('Proposal rejected.');
    await backend.crashRestart();
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Review proposals', exact: true }).click();
    await dialog.getByRole('button', { name: 'Pending only', exact: true }).click();
    await dialog.getByRole('button', { name: 'dog', exact: true }).click();

    // Then: history is read-only and the original authored revision is untouched.
    await expect(dialog.getByRole('textbox', { name: 'Meaning', exact: true })).toHaveValue('A proposed definition.');
    await expect(dialog.getByRole('textbox', { name: 'Meaning', exact: true })).not.toBeEditable();
    await expect(dialog.getByRole('button', { name: 'Accept proposal', exact: true })).toHaveCount(0);
    expect((await client.materialProposal(suggestion.proposal.id)).state.state).toBe('rejected');
    expect(await client.material(saved.material.id)).toEqual(saved.material);
  } finally { await backend.close(); }
});

test('opening an accepted replacement explicitly reloads the saved revision instead of the old editor draft', async ({ page }) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/proposal-open-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: the original editor still owns an unsubmitted change.
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const saved = await client.createMaterial(client.prepareMaterial({
      ...emptyMaterial('org.mlearn.english'), phrase: 'bird', notes: 'Saved note.',
    }));
    if (saved.status !== 'saved') throw new Error('Expected authored Material');
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Edit bird', exact: true }).click();
    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Unsubmitted old draft.');
    await page.getByRole('button', { name: 'Propose changes to saved Material', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Material proposals', exact: true });
    await dialog.getByRole('textbox', { name: 'Meaning', exact: true }).fill('Accepted replacement meaning.');
    await dialog.getByRole('button', { name: 'Save proposal', exact: true }).click();
    await dialog.getByRole('button', { name: 'Accept proposal', exact: true }).click();
    await expect(dialog.getByTestId('material-proposal-result')).toContainText('Saved Material · committed revision 2');

    // When: the user explicitly chooses the now-saved Material.
    await dialog.getByRole('button', { name: 'Open saved Material', exact: true }).click();

    // Then: that explicit navigation reloads the committed revision, not the obsolete draft.
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Meaning', exact: true })).toHaveValue('Accepted replacement meaning.');
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Saved note.');
    expect((await client.material(saved.material.id)).revision).toBe(2);
  } finally { await backend.close(); }
});

test('a retried generation remains cancellable while its own admission receipt is held', async ({ page }, info) => {
  test.setTimeout(60_000);
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/proposal-retry-control-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  let releaseHeld = () => {};
  try {
    // Given: a failed native generation can be retried through the shared worker.
    await attachRuntimeBrowserQa(page, backend.url);
    await installEnglish(page);
    const saved = await client.createMaterial(client.prepareMaterial({ ...emptyMaterial('org.mlearn.english'), phrase: 'retry-control' }));
    if (saved.status !== 'saved') throw new Error('Expected authored Material');
    const provider = await client.conversationProvider();
    await client.saveConversationProvider(client.prepareConversationProvider(provider.revision, `${backend.url}/v1`, 'fixture-local'));
    await client.setConversationSessionCredential('fixture-only');
    backend.providerMode('fail');
    const first = await client.generateMaterial(client.prepareMaterialGeneration({
      kind: 'material', material: { id: saved.material.id, revision: saved.material.revision },
    }, '', 1));
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Review proposals', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Material proposals', exact: true });
    await dialog.getByRole('button', { name: 'Proposal generation and saved jobs', exact: true }).click();
    await dialog.getByRole('button', { name: 'retry-control', exact: true }).click();
    await expect(dialog.getByTestId('material-generation-report').getByText('failed', { exact: true })).toBeVisible();
    backend.providerMode('hold');
    const started = backend.nextProviderStart();
    const held = new Promise<void>(resolve => { releaseHeld = resolve; });
    let resolveForwarded = (_id: string) => {};
    const forwarded = new Promise<string>(resolve => { resolveForwarded = resolve; });
    let intercepted = false;
    await page.route(`${backend.url}/invoke`, async route => {
      const payload = route.request().postDataJSON();
      const request = typeof payload.args?.request === 'string' ? JSON.parse(payload.args.request) : null;
      if (intercepted || request?.type !== 'conversation' || request.command.action !== 'retry_generation') {
        await route.continue(); return;
      }
      intercepted = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await response.body();
      resolveForwarded(request.command.retry.generationId);
      await held;
      await route.abort('failed');
    });

    // When: the retry's receipt is held after its native provider call starts.
    await dialog.getByRole('button', { name: 'Retry proposal generation', exact: true }).click();
    const retryId = await forwarded;
    await started;
    const cancel = dialog.getByRole('button', { name: 'Cancel proposal generation', exact: true });
    await expect(cancel).toBeVisible();
    const closed = backend.nextProviderClose();
    await cancel.click();
    await closed;

    // Then: control reaches that retry, not its already-failed predecessor.
    await expect(dialog.getByTestId('material-generation-report')).toContainText('cancelled');
    releaseHeld();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(dialog.getByRole('button', { name: 'Recover generation action', exact: true })).toHaveCount(0);
    const stopped = await client.materialGeneration(retryId);
    expect(stopped.generation.status).toBe('cancelled');
    expect(stopped.generation.retryOf).toBe(first.generation.id);
    expect(backend.metadata().providerRequests).toBe(2);
    await page.screenshot({ path: info.outputPath('generation-retry-cancelled-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('generation-retry-cancelled-phone.png') });
  } finally {
    releaseHeld();
    try { await page.unrouteAll({ behavior: 'wait' }); }
    finally { await backend.close(); }
  }
});
