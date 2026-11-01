/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createRuntimeBrowserClient } from '../../tools/runtime-browser-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

async function startGrammarPractice(client: ReturnType<typeof createRuntimeBrowserClient>) {
  await client.availablePackages();
  await client.installPackage(client.prepareInstall('org.mlearn.english'));
  const inspected = await client.inspectTarget('org.mlearn.english', 'org.mlearn.english:grammar/past-simple-negative');
  const saved = await client.createMaterial(client.prepareMaterial({
    packageId: 'org.mlearn.english', targetId: inspected.entry.targetId,
    packageRevision: inspected.packageRevision, sense: null,
    phrase: 'Past simple negative', reading: '', meaning: '', context: '', notes: '',
    examples: [], source: null, attachments: [],
  }, true));
  if (saved.status !== 'saved') throw new Error('The isolated grammar Material was not saved');
  return (await client.review(client.prepareReviewStart({
    kind: 'practice', items: [{ materialId: saved.material.id, source: null }],
  }))).session;
}

test('typed Practice preserves the actual package-validated response through restart and submission', async ({ page }, info) => {
  test.setTimeout(180_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('typed-practice-profile') });
  const client = createRuntimeBrowserClient(backend);
  try {
    // Given an authenticated package and its actual grammar task, not a renderer fixture.
    await attachRuntimeBrowserQa(page, backend.url);
    const started = await startGrammarPractice(client);
    expect(started.encounter?.task?.responseSpec.kind).toBe('typed_text');
    await page.goto(`/review?sessionId=${started.id}`);
    await expect(page.getByTestId('review-cue')).toBeVisible();
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`typed-question-${width}.png`) });
    }

    // When the learner captures raw input, then restarts before revealing it.
    const input = page.getByRole('textbox', { name: 'Your response', exact: true });
    await expect(input).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reveal', exact: true })).toBeDisabled();
    await input.fill(' DID NOT FOLD ');
    await page.getByRole('button', { name: 'Check response', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check response', exact: true })).toHaveCount(0);
    await expect(input).not.toBeEditable();
    const captured = await client.reviewSession(started.id);
    expect(captured.encounter?.capture?.response).toEqual({ kind: 'typed_text', text: ' DID NOT FOLD ' });
    expect(captured.encounter?.capture?.feedback).toBeNull();
    await expect(page.getByTestId('review-answer')).toHaveCount(0);
    await backend.crashRestart();
    await page.reload();
    await expect(input).toHaveValue(' DID NOT FOLD ');
    await expect(input).not.toBeEditable();
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();

    // Then real validator feedback and the original capture survive the physical attempt.
    await expect(page.getByTestId('review-answer')).toBeVisible();
    const revealed = await client.reviewSession(started.id);
    expect(revealed.encounter?.capture?.id).toBe(captured.encounter?.capture?.id);
    expect(revealed.encounter?.capture?.feedback?.outcomes.map(value => value.result)).toEqual(['accepted']);
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`typed-revealed-${width}.png`) });
    }
    await page.getByRole('button', { name: 'All Fluent', exact: true }).click();
    await expect(page.getByTestId('review-rating')).toHaveCount(0);
    expect((await client.reviewSession(started.id)).completed).toBe(1);
    expect(backend.metadata().providerRequests).toBe(0);
  } finally {
    await backend.close();
  }
});

test('Stop validation drains its exact native registration before allowing recovery', async ({ page }, info) => {
  test.setTimeout(180_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('stopped-practice-profile') });
  const client = createRuntimeBrowserClient(backend);
  let entered = () => {};
  let release = () => {};
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let ticket: string | null = null;
  try {
    // Given a real task with execution held after its native registration.
    await attachRuntimeBrowserQa(page, backend.url);
    const started = await startGrammarPractice(client);
    await page.route(`${backend.url}/invoke`, async route => {
      const invocation = route.request().postDataJSON();
      if (ticket !== null || invocation.command !== 'execute_review_validation') {
        await route.continue(); return;
      }
      if (typeof invocation.args.id !== 'string') throw new Error('Validation has no native registration');
      ticket = invocation.args.id;
      entered();
      await held;
      await route.continue();
    });
    await page.goto(`/review?sessionId=${started.id}`);
    const input = page.getByRole('textbox', { name: 'Your response', exact: true });
    await input.fill(' DID NOT FOLD ');
    await page.getByRole('button', { name: 'Check response', exact: true }).click();
    await admitted;
    const cancelled = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
      && response.request().postDataJSON().command === 'cancel_review_validation'
      && response.request().postDataJSON().args.id === ticket);

    // When Stop acknowledges the native ticket but execution delivery is still held.
    await page.getByRole('button', { name: 'Stop validation', exact: true }).click();
    expect((await cancelled).ok()).toBe(true);
    await expect(page.getByRole('button', { name: 'Stopping validation', exact: true })).toBeDisabled();
    await expect(input).not.toBeEditable();
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`validation-stopping-${width}.png`) });
    }
    expect((await client.reviewSession(started.id)).encounter?.capture).toBeUndefined();
    release();

    // Then the late execute cannot commit; the same draft/task can recover explicitly.
    await expect(page.getByRole('button', { name: 'Check response', exact: true })).toBeEnabled();
    await expect(input).toHaveValue(' DID NOT FOLD ');
    const stopped = await client.reviewSession(started.id);
    expect(stopped.revision).toBe(started.revision);
    expect(stopped.completed).toBe(0);
    expect(stopped.encounter?.id).toBe(started.encounter?.id);
    expect(stopped.encounter?.capture).toBeUndefined();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByText('Word Practice paused', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(input).toHaveValue(' DID NOT FOLD ');
    await page.getByRole('button', { name: 'Check response', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check response', exact: true })).toHaveCount(0);
    expect((await client.reviewSession(started.id)).encounter?.capture?.response)
      .toEqual({ kind: 'typed_text', text: ' DID NOT FOLD ' });
  } finally {
    release();
    await backend.close();
  }
});

test('declared contrast choices and retrospective recall keep their actual response contracts', async ({ page }, info) => {
  test.setTimeout(180_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('contrast-practice-profile') });
  const client = createRuntimeBrowserClient(backend);
  try {
    // Given the real package's next contrast after its first typed task.
    await attachRuntimeBrowserQa(page, backend.url);
    let session = await startGrammarPractice(client);
    const typed = session.encounter;
    if (!typed) throw new Error('The initial package task is missing');
    session = (await client.review(client.prepareReviewMutation(session, {
      kind: 'capture_response', encounterId: typed.id, response: { kind: 'typed_text', text: 'did not fold' },
    }))).session;
    session = (await client.review(client.prepareReviewMutation(session, { kind: 'reveal', encounterId: typed.id }))).session;
    const captured = session.encounter?.capture;
    if (!captured) throw new Error('The actual typed response was not captured');
    session = (await client.review(client.prepareReviewMutation(session, {
      kind: 'submit', response: { encounterId: typed.id, captureId: captured.id,
        grades: typed.targets.map(target => ({ targetId: target.id, quality: 'fluent', method: 'remembered', easy: false })) },
    }))).session;
    session = (await client.review(client.prepareReviewMutation(session, { kind: 'next' }))).session;
    const contrast = session.encounter;
    if (contrast?.task?.responseSpec.kind !== 'choice_id') throw new Error('The actual contrast task was not admitted');
    const negative = contrast.task.responseSpec.options.find(option => option.id === 'negative');
    if (!negative) throw new Error('The package contrast has no declared negative option');
    await page.goto(`/review?sessionId=${session.id}`);
    const check = page.getByRole('button', { name: 'Check response', exact: true });
    await expect(check).toBeDisabled();

    // When the learner chooses the package's declared stable identity.
    const option = page.getByRole('button', { name: negative.label, exact: true });
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`contrast-selected-${width}.png`) });
    }
    await check.click();
    await expect(check).toHaveCount(0);
    const chosen = await client.reviewSession(session.id);
    expect(chosen.encounter?.capture?.response).toEqual({ kind: 'choice_id', id: 'negative' });
    expect(chosen.encounter?.capture?.feedback).toBeNull();
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    const revealed = await client.reviewSession(session.id);
    expect(revealed.encounter?.capture?.feedback?.outcomes.map(value => value.result)).toEqual(['accepted']);
    await page.getByRole('button', { name: 'All Fluent', exact: true }).click();

    // Then the next self-report task has no invented input or validator outcome.
    await expect(page.getByRole('button', { name: 'Reveal', exact: true })).toBeEnabled();
    const recall = await client.reviewSession(session.id);
    expect(recall.completed).toBe(2);
    expect(recall.encounter?.task?.responseSpec.kind).toBe('self_report');
    expect(recall.encounter?.capture).toBeUndefined();
    await expect(check).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Your response', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    await page.getByRole('button', { name: 'All Fluent', exact: true }).click();
    await expect(page.getByText('Word Practice complete', { exact: true })).toBeVisible();
    expect((await client.reviewSession(session.id)).completed).toBe(3);
  } finally {
    await backend.close();
  }
});
