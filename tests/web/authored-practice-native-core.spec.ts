/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createRuntimeBrowserClient } from '../../tools/runtime-browser-client';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';
import { builtInThemes } from '../../packages/theme/src/theme';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

test('expert authoring validates saved inputs and executes only its frozen package probes', async ({ page }, info) => {
  test.setTimeout(180_000);
  const backend = await startRuntimeBrowserQa({ profile: info.outputPath('authored-profile') });
  const client = createRuntimeBrowserClient(backend);
  const packageId = 'org.mlearn.english';
  let releasePreview = () => {};
  let previewEntered = () => {};
  const heldPreview = new Promise<void>(resolve => { releasePreview = resolve; });
  const enteredPreview = new Promise<void>(resolve => { previewEntered = resolve; });
  const capture = async (name: string) => {
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (name.startsWith('authoring-preview-')) {
        await page.getByRole('heading', { name: 'Authored recall probes', exact: true }).scrollIntoViewIfNeeded();
        await expect(page.getByRole('button', { name: 'Practice authored probes', exact: true }))
          .toBeInViewport({ ratio: 1 });
      }
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`) });
    }
  };
  try {
    await client.availablePackages();
    await client.installPackage(client.prepareInstall(packageId));
    const catalog = await client.invokePlugin(packageId, 'collection.targets.v1', { after: null, limit: 2 });
    if (!object(catalog) || !Array.isArray(catalog.items)) throw new Error('Expected real package targets');
    const candidate = catalog.items.find(item => object(item) && object(item.summary)
      && typeof item.summary.targetId === 'string' && !item.summary.targetId.includes(':grammar/'));
    if (!object(candidate) || !object(candidate.summary) || typeof candidate.summary.targetId !== 'string')
      throw new Error('Expected a real lexical target');
    const inspected = await client.inspectTarget(packageId, candidate.summary.targetId);
    const saved = await client.createMaterial(client.prepareMaterial({
      packageId, packageRevision: inspected.packageRevision, targetId: inspected.entry.targetId, sense: null,
      phrase: inspected.entry.headword, reading: '', meaning: 'First authored answer', context: '', notes: '',
      examples: [], source: null, attachments: [],
    }, true));
    if (saved.status !== 'saved') throw new Error('Expected saved authoring input');
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto(`/materials?id=${saved.material.id}`);
    const author = page.getByRole('button', { name: 'Author probes', exact: true });
    await expect(author).toBeEnabled();
    await page.getByRole('textbox', { name: 'Meaning', exact: true }).fill('Revised authored answer');
    await expect(author).toBeDisabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(author).toBeEnabled();
    const edited = await client.material(saved.material.id);
    if (!edited) throw new Error('Saved authoring input disappeared');
    expect(edited.content.meaning).toBe('Revised authored answer');
    expect(edited.revision).toBeGreaterThan(saved.material.revision);
    await author.click();
    let holdPreview = true;
    await page.route(`${backend.url}/invoke`, async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      const invocation = route.request().postDataJSON();
      const request = typeof invocation.args?.request === 'string' ? JSON.parse(invocation.args.request) : null;
      if (holdPreview && invocation.command === 'execute_bounded_read' && request?.type === 'preview_authored_practice') {
        holdPreview = false; previewEntered(); await heldPreview;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Preview authored probes', exact: true }).click();
    await enteredPreview;
    const cancelledPreview = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
      && response.request().method() === 'POST'
      && response.request().postDataJSON().command === 'cancel_bounded_read');
    await page.getByRole('button', { name: 'Cancel probe preview', exact: true }).click();
    await cancelledPreview;
    releasePreview();
    await expect(page.getByTestId('authored-preview-cancelled')).toBeVisible();
    expect(await client.reviewSessions()).toEqual([]);
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.goto(`/materials?id=${edited.id}`);
      await expect(author).toBeEnabled();
      await author.scrollIntoViewIfNeeded();
      await capture(`authoring-editor-${theme.id}`);
      await author.click();
      await expect(page.getByRole('heading', { name: 'Author probes', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Preview authored probes', exact: true }).click();
      await expect(page.getByTestId('authored-probe-preview')).toBeVisible();
      await expect(page.getByTestId('authored-probe-preview')
        .getByText('Revised authored answer', { exact: true }).first()).toBeVisible();
      const details = page.getByRole('button', { name: 'Assessment limits', exact: true });
      const packageIdentity = page.getByText(`Language package: ${packageId}`, { exact: true });
      await expect(packageIdentity).toBeHidden();
      await details.focus();
      await details.press('Enter');
      await expect(packageIdentity).toBeVisible();
      await capture(`authoring-details-${theme.id}`);
      await details.click();
      await expect(packageIdentity).toBeHidden();
      await capture(`authoring-preview-${theme.id}`);
    }
    const preview = await client.authoredPracticePreview(edited.id, edited.revision);
    expect(preview.probes.some(probe => probe.answer === 'Revised authored answer')).toBe(true);
    const key = preview.probes.flatMap(probe => probe.targets.flatMap(target => target.key ? [target.key] : []))[0];
    if (!key) throw new Error('Expected accountable package targets');
    await expect(client.review(client.prepareReviewStart({
      kind: 'authored_practice', materialId: preview.materialId, materialRevision: preview.materialRevision,
      packageRevision: preview.packageRevision, fingerprint: '0'.repeat(64),
    }))).rejects.toMatchObject({ code: 'stale_authored_preview' });
    expect(await client.reviewSessions()).toEqual([]);

    // A concurrent saved edit rejects the displayed preview without creating a session.
    const changed = await client.updateMaterial(client.prepareMaterialEdit(edited, {
      ...edited.content, meaning: 'Latest authored answer',
    }, edited.excluded));
    if (changed.status !== 'saved') throw new Error('Concurrent saved edit failed');
    const rejected = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
      && response.request().method() === 'POST'
      && response.request().postDataJSON().command === 'runtime_execute'
      && JSON.parse(response.request().postDataJSON().args.request).command?.start?.mode?.kind === 'authored_practice');
    await page.getByRole('button', { name: 'Practice authored probes', exact: true }).click();
    await rejected;
    await expect(page.getByTestId('authored-probe-preview')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry Review save', exact: true })).toHaveCount(0);
    expect(await client.reviewSessions()).toEqual([]);
    await page.getByRole('button', { name: 'Preview authored probes', exact: true }).click();
    await expect(page.getByTestId('authored-probe-preview')
      .getByText('Latest authored answer', { exact: true }).first()).toBeVisible();
    const latest = await client.authoredPracticePreview(changed.material.id, changed.material.revision);
    expect(latest.fingerprint).not.toBe(preview.fingerprint);
    await page.getByRole('button', { name: 'Practice authored probes', exact: true }).click();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    const session = (await client.reviewSessions())[0];
    if (!session || session.mode.kind !== 'authored_practice') throw new Error('Expected actual authored session');
    expect(session.mode.materialRevision).toBe(changed.material.revision);
    expect(session.mode.fingerprint).toBe(latest.fingerprint);
    expect(session.mode).not.toHaveProperty('probes');
    expect(session.encounter?.answer).toBeNull();
    expect(session.encounter?.task).toBeUndefined();
    expect(session.encounter?.conditions.assistance).toContain('source');
    await expect(page.getByRole('button', { name: 'Check response', exact: true })).toHaveCount(0);
    await capture('authoring-question');
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByTestId('review-answer')).toContainText('Latest authored answer');
    await page.getByRole('button', { name: 'Fluent', exact: true }).click();
    await expect(page.getByTestId('review-cue')).toBeVisible();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    const paused = await client.reviewSession(session.id);
    await backend.crashRestart();
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('review-cue')).toBeVisible();
    const restored = await client.reviewSession(session.id);
    expect(restored.mode).toEqual(paused.mode);
    expect(restored.encounter?.id).toBe(paused.encounter?.id);
    const evidence = await client.knowledgeEvidence({ key, after: null });
    expect(evidence.projection.assessed).toBeNull();
    expect(evidence.observations).toHaveLength(1);
    expect(evidence.observations[0]?.purpose).toBe('practice');
    expect(evidence.observations[0]?.conditions.assistance).toContain('source');
    const grammar = await client.inspectTarget(packageId, `${packageId}:grammar/past-simple-negative`);
    const unsupported = await client.createMaterial(client.prepareMaterial({
      packageId, packageRevision: grammar.packageRevision, targetId: grammar.entry.targetId, sense: null,
      phrase: grammar.entry.headword, reading: '', meaning: 'Authored answer must not become a fixed grammar task',
      context: '', notes: '', examples: [], source: null, attachments: [],
    }, true));
    if (unsupported.status !== 'saved') throw new Error('Expected saved unsupported authoring input');
    await expect(client.authoredPracticePreview(unsupported.material.id, unsupported.material.revision)).rejects.toThrow();
    expect(await client.reviewSessions()).toHaveLength(1);
    expect(backend.metadata().providerRequests).toBe(0);
  } finally { releasePreview(); await backend.close(); }
});
