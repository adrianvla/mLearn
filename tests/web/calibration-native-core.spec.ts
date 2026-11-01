/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createRuntimeBrowserClient } from '../../tools/runtime-browser-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';
import { builtInThemes } from '../../packages/theme/src/theme';

test('Word Sync preserves actual calibrated responses through restart and Undo', async ({ page }, info) => {
  test.setTimeout(300_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('calibration-profile') });
  const client = createRuntimeBrowserClient(backend);
  const packageId = 'org.mlearn.english';
  const targetId = `${packageId}:grammar/past-simple-negative`;
  const capability = `${packageId}:grammar-form`;
  const key = { packageId, targetId, capability };
  const query = {
    packageId, capability,
    filter: { kind: 'text' as const, text: 'Past simple negative' },
    limit: 4,
  };
  try {
    // Given a real package catalog and a claim without an assessment.
    await client.availablePackages();
    await client.installPackage(client.prepareInstall(packageId));
    expect((await client.prepareCollectionCatalog(client.prepareCollection(packageId))).phase).toBe('succeeded');
    await client.changeClaim(client.prepareClaim(key, true));
    const items = await client.calibrationCandidates(query);
    expect(items.map(item => item.targetId)).toEqual([targetId]);
    expect(items[0]?.capabilities).toEqual([capability]);
    expect(items[0]?.source).toBeNull();
    const started = (await client.review(client.prepareReviewStart({
      kind: 'calibration', query, items,
    }))).session;
    expect(started.encounter?.task?.responseSpec.kind).toBe('typed_text');
    expect(started.encounter?.conditions.assistance).toEqual([]);
    expect((await client.materials({ query: '', after: null, sourceId: null, includeExcluded: true })).items).toEqual([]);
    await attachRuntimeBrowserQa(page, backend.url);
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.goto(`/review?sessionId=${started.id}`);
      await expect(page.getByTestId('review-cue')).toBeVisible();
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: info.outputPath(`calibration-question-${theme.id}-${width}.png`) });
      }
      await expect(page.getByRole('heading', { name: 'Word Sync', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      const reopen = page.getByRole('button', { name: `Open Word Sync ${started.id}`, exact: true });
      await expect(reopen).toBeVisible();
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: info.outputPath(`calibration-sessions-${theme.id}-${width}.png`) });
      }
      await reopen.click();
      await expect(page.getByTestId('review-cue')).toBeVisible();
    }

    // When an actual response is captured, then the native owner restarts before reveal.
    const input = page.getByRole('textbox', { name: 'Your response', exact: true });
    await input.fill(' DID NOT FOLD ');
    const captureCommitted = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
      && response.request().method() === 'POST'
      && response.request().postDataJSON().command === 'execute_review_validation');
    await page.getByRole('button', { name: 'Check response', exact: true }).click();
    await captureCommitted;
    await expect(page.getByRole('button', { name: 'Check response', exact: true })).toHaveCount(0);
    await expect(input).not.toBeEditable();
    const captured = await client.reviewSession(started.id);
    expect(captured.encounter?.capture?.response).toEqual({ kind: 'typed_text', text: ' DID NOT FOLD ' });
    expect(captured.encounter?.capture?.feedback).toBeNull();
    await backend.crashRestart();
    await page.reload();
    await expect(input).toHaveValue(' DID NOT FOLD ');
    await expect(input).not.toBeEditable();
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    const revealed = await client.reviewSession(started.id);
    expect(revealed.encounter?.capture?.feedback?.outcomes.map(outcome => outcome.result)).toEqual(['accepted']);
    expect(revealed.encounter?.capture?.id).toBe(captured.encounter?.capture?.id);
    await page.getByRole('button', { name: 'All Fluent', exact: true }).click();
    await expect(page.getByTestId('review-cue')).toHaveCount(0);

    // Then measured state, purpose and Undo come from the same native evidence owner.
    expect((await client.reviewSession(started.id)).state).toBe('complete');
    const evidence = await client.knowledgeEvidence({ key, after: null });
    expect(evidence.projection.claim).toBe(true);
    expect(evidence.projection.assessed).toBe(true);
    expect(evidence.observations).toHaveLength(1);
    expect(evidence.observations[0]?.purpose).toBe('calibration');
    expect(evidence.observations[0]?.active).toBe(true);
    expect(await client.calibrationCandidates(query)).toEqual([]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toBeVisible();
    expect((await client.reviewSession(started.id)).encounter?.correction).toBe(true);
    expect((await client.calibrationCandidates(query)).map(item => item.targetId)).toEqual([targetId]);
    const undone = await client.knowledgeEvidence({ key, after: null });
    expect(undone.projection.claim).toBe(true);
    expect(undone.projection.assessed).toBeNull();
    expect(undone.observations).toHaveLength(1);
    expect(undone.observations[0]?.active).toBe(false);
    expect(backend.metadata().providerRequests).toBe(0);
  } finally {
    await backend.close();
  }
});
