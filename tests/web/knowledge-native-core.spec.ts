/// <reference types="node" />
import { test, expect, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { CollectionQuery } from '@mlearn/contracts';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

// Real Rust, signed package, catalog, Knowledge and Material storage. Only the
// host transport is adapted; native window/media/clipboard are not claimed.
test('bounded Knowledge browsing captures source-free Material and preserves claims across restart', async ({ page }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/knowledge-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID,
    execute: request => backend.invoke('runtime_execute', { request }),
  });
  const packageId = 'org.mlearn.english';
  const query: CollectionQuery = { packageId, surface: 'knowledge', filter: { kind: 'all', filters: [] }, sort: 'default', after: null };
  try {
    // Given: an installed real package with no derived collection or learner data.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    const prepare = page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true });
    await expect(prepare).toBeVisible();
    await page.screenshot({ path: info.outputPath('knowledge-prepare-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(prepare).toBeInViewport();
    await page.screenshot({ path: info.outputPath('knowledge-prepare-phone.png') });
    await page.setViewportSize({ width: 1080, height: 900 });
    const prepared = page.waitForResponse(response => {
      if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
      const payload = response.request().postDataJSON();
      return typeof payload.args?.request === 'string' && JSON.parse(payload.args.request).type === 'prepare_collection';
    }, { timeout: 240_000 });
    const [preparationReceipt] = await Promise.all([prepared, prepare.click()]);
    expect(preparationReceipt.ok()).toBe(true);
    const first = await client.collection(query);
    if (first.state !== 'ready') throw new Error('Actual package collection was not prepared');
    const entries = first.page.items.flatMap(item => item.kind === 'target' ? [item.target] : []);
    expect(entries).toHaveLength(24);
    expect(first.page.next).not.toBeNull();
    await expect(page.getByText(`${first.page.count} entries`, { exact: true })).toBeVisible();
    for (const entry of entries)
      await expect(page.getByTestId(`knowledge-target-${entry.summary.targetId}`)
        .getByRole('button', { name: `${entry.summary.headword}: untracked`, exact: true })).toBeAttached();
    const language = await client.describeLanguage(packageId);
    const capability = language.capabilities.find(item => item.id === language.annotationCapability);
    if (!capability) throw new Error('Package annotation capability has no label');

    // Empty activity entry must return to the retained management workspace too.
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const kind of ['document', 'video']) {
        const draft = `Unsubmitted ${kind} search at ${width}`;
        await expect(page.getByRole('button', { name: 'Next Knowledge page', exact: true })).toBeEnabled();
        await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).fill(draft);
        await page.getByRole('button', { name: 'Home', exact: true }).click();
        await page.getByRole('button', { name: `Open ${kind} entry`, exact: true }).click();
        await expect(page.getByRole('heading', {
          name: kind === 'document' ? 'Open a document' : 'Open a video', exact: true,
        })).toBeVisible();
        await expect(page.getByRole('button', {
          name: kind === 'document' ? 'Open document' : 'Open local video', exact: true,
        })).toBeEnabled();
        await page.screenshot({ path: info.outputPath(`navigation-empty-${kind}-${width}.png`) });
        await page.getByRole('button', { name: 'Home', exact: true }).click();
        await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Search Knowledge', exact: true })).toHaveValue(draft);
        await expect(page.getByRole('button', { name: 'Next Knowledge page', exact: true })).toBeEnabled();
        await page.screenshot({ path: info.outputPath(`navigation-after-empty-${kind}-${width}.png`) });
      }
    }
    await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).fill('');
    await page.setViewportSize({ width: 1080, height: 900 });

    // When: the user pages, inspects an entry, claims its package-selected
    // capability and captures it through the existing Inspector.
    await page.getByRole('button', { name: 'Next Knowledge page', exact: true }).click();
    const second = await client.collection({ ...query, after: first.page.next });
    if (second.state !== 'ready') throw new Error('Next native collection page was not ready');
    const next = second.page.items.flatMap(item => item.kind === 'target' ? [item.target] : []);
    expect(new Set([...entries, ...next].map(entry => entry.summary.targetId)).size).toBe(48);
    for (const entry of next)
      await expect(page.getByTestId(`knowledge-target-${entry.summary.targetId}`)
        .getByRole('button', { name: `${entry.summary.headword}: untracked`, exact: true })).toBeAttached();
    const inspector = page.getByTestId('inspector-panel');
    await page.getByTestId(`knowledge-target-${next[0].summary.targetId}`).getByRole('button').click();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: capability.label, exact: true }).click();
    await inspector.getByRole('button', { name: `Claim ${capability.label} known`, exact: true }).click();
    await expect(inspector.getByText(`${capability.label} · claimed known`, { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Inspect evidence', exact: true }).click();
    const evidence = inspector.getByTestId('knowledge-evidence');
    await expect(evidence.getByText(/^Explicit claim: known/)).toBeVisible();
    await expect(evidence.getByText('No recorded Review observations for this capability.', { exact: true })).toBeVisible();
    await expect(evidence.getByText('Prediction: unavailable', { exact: true })).toBeVisible();
    // Only receipt delivery fails or is held. Successful pages still come from
    // the real SQLite owner; one stopped receipt cannot block its replacement.
    let failEvidence = true;
    let holdEvidence = false;
    let entered = () => {};
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const admitted = new Promise<void>(resolve => { entered = resolve; });
    await page.route(`${backend.url}/invoke`, async route => {
      const request = route.request().postDataJSON();
      if (typeof request.args?.request !== 'string'
        || JSON.parse(request.args.request).type !== 'knowledge_evidence') {
        await route.continue(); return;
      }
      if (failEvidence) {
        failEvidence = false; await route.abort('failed'); return;
      }
      if (holdEvidence) {
        holdEvidence = false;
        const response = await route.fetch();
        entered(); await held; await route.fulfill({ response }); return;
      }
      await route.continue();
    });
    try {
      await evidence.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
      await expect(evidence.getByRole('alert')).toBeVisible();
      await page.screenshot({ path: info.outputPath('knowledge-evidence-read-error.png') });
      await evidence.getByRole('button', { name: 'Retry evidence', exact: true }).click();
      await expect(evidence.getByRole('alert')).toHaveCount(0);
      await expect(evidence.getByRole('button', { name: 'Refresh evidence', exact: true })).toBeEnabled();
      holdEvidence = true;
      await evidence.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
      await admitted;
      await evidence.getByRole('button', { name: 'Stop loading evidence', exact: true }).click();
      await page.screenshot({ path: info.outputPath('knowledge-evidence-stopped.png') });
      await client.changeClaim(client.prepareClaim({
        packageId, targetId: next[0].summary.targetId, capability: capability.id,
      }, false));
      await evidence.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
      await expect(evidence.getByText(/^Explicit claim: unknown/)).toBeVisible();
      const delivered = page.waitForResponse(response => response.url() === `${backend.url}/invoke`
        && typeof response.request().postDataJSON().args?.request === 'string'
        && JSON.parse(response.request().postDataJSON().args.request).type === 'knowledge_evidence');
      release();
      await (await delivered).finished();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(evidence.getByText(/^Explicit claim: unknown/)).toBeVisible();
    } finally {
      release();
      await page.unroute(`${backend.url}/invoke`);
    }
    await evidence.getByRole('button', { name: 'Back to entry', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Inspect evidence', exact: true })).toBeFocused();
    await inspector.getByRole('button', { name: `Claim ${capability.label} known`, exact: true }).click();
    await expect(inspector.getByText(`${capability.label} · claimed known`, { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'First Knowledge page', exact: true })).toBeDisabled();
    const target = entries[0];
    const word = page.getByTestId(`knowledge-target-${target.summary.targetId}`)
      .getByRole('button', { name: `${target.summary.headword}: untracked`, exact: true });
    await word.click();
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Explain', exact: true })).toHaveCount(0);
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: capability.label, exact: true }).click();
    await inspector.getByRole('button', { name: `Claim ${capability.label} known`, exact: true }).click();
    await expect(inspector.getByText(`${capability.label} · claimed known`, { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: `Capture ${target.summary.headword}`, exact: true }).click();
    await inspector.getByRole('button', { name: `Open saved ${target.summary.headword}: revision 1`, exact: true }).click();

    // Then: the original Material editor owns the saved entry; its actual
    // receipt has no invented source, and the native claim survives restart.
    await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Phrase', exact: true })).toHaveValue(target.summary.headword);
    await expect(page.getByRole('button', { name: 'Return to source', exact: true })).toHaveCount(0);
    const materials = await client.materials({ after: null, query: '', sourceId: null, includeExcluded: true });
    expect(materials.items).toHaveLength(1);
    expect(materials.items[0].content).toMatchObject({
      targetId: target.summary.targetId, source: null, packageRevision: first.page.packageRevision,
    });
    // When switching management routes, retain unsaved presentation state and
    // the actual bounded page, without creating another native data authority.
    const reentryReceipts = [];
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Close editor', exact: true }).click();
      await expect(page).toHaveURL(/\/knowledge(?:\?|$)/);
      await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Search Knowledge', exact: true })).toHaveValue('');
      await page.getByTestId(`knowledge-target-${target.summary.targetId}`).getByRole('button').click();
      await inspector.getByRole('button', { name: 'Capture options', exact: true }).click();
      const materialReentry = page.waitForResponse(response => {
        if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
        const payload = response.request().postDataJSON();
        if (typeof payload.args?.request !== 'string') return false;
        const request = JSON.parse(payload.args.request);
        return request.type === 'collection' && request.query.surface === 'material';
      });
      const [materialReentryReceipt] = await Promise.all([
        materialReentry, page.getByText(`Open saved ${target.summary.headword}`, { exact: true }).click(),
      ]);
      await materialReentryReceipt.finished();
      await expect(page.getByRole('heading', { name: 'Material', exact: true, includeHidden: true })).toBeAttached();
      await expect(page.getByRole('button', { name: `Edit ${target.summary.headword}`, exact: true, includeHidden: true })).toBeEnabled();
      await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Phrase', exact: true })).toHaveValue(target.summary.headword);
      reentryReceipts.push({ width, materialId: materials.items[0].id, editorVisible: true, url: page.url() });
      await page.screenshot({ path: info.outputPath(`material-closed-reentry-${width}.png`) });
    }
    await writeFile(info.outputPath('material-closed-reentry.json'), JSON.stringify(reentryReceipts));
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();
    await expect(page).toHaveURL(/\/knowledge(?:\?|$)/);
    await page.getByRole('button', { name: 'Material', exact: true }).click();
    const materialDraft = 'NAV-02 unsubmitted Material search';
    const knowledgeDraft = 'NAV-02 unsubmitted Knowledge search';
    const navigationReceipts: {
      readonly width: number; readonly materialAfterSwitch: string;
      readonly knowledgeAfterSwitch: string; readonly knowledgeAfterHome: string;
    }[] = [];
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('textbox', { name: 'Search Material', exact: true }).fill(materialDraft);
      await page.screenshot({ path: info.outputPath(`navigation-material-${width}-before.png`) });
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
      await page.getByRole('combobox', { name: /^Knowledge order:/ }).click();
      await page.getByRole('option', { name: 'Entry Z–A', exact: true }).click();
      await page.getByRole('combobox', { name: /^Knowledge layout:/ }).click();
      await page.getByRole('option', { name: 'Grid', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Next Knowledge page', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Next Knowledge page', exact: true }).click();
      await expect(page.getByRole('button', { name: 'First Knowledge page', exact: true })).toBeEnabled();
      const rows = page.locator('[data-testid^="knowledge-target-"]');
      const identities = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')));
      expect(identities).toHaveLength(24);
      await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).fill(knowledgeDraft);
      await page.screenshot({ path: info.outputPath(`navigation-knowledge-${width}-before.png`) });
      await page.getByRole('button', { name: 'Material', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Search Material', exact: true })).toHaveValue(materialDraft);
      const materialAfterSwitch = await page.getByRole('textbox', { name: 'Search Material', exact: true }).inputValue();
      await page.screenshot({ path: info.outputPath(`navigation-material-${width}-after-switch.png`) });
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Search Knowledge', exact: true })).toHaveValue(knowledgeDraft);
      const knowledgeAfterSwitch = await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).inputValue();
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Search Knowledge', exact: true })).toHaveValue(knowledgeDraft);
      await expect(page.getByRole('combobox', { name: /^Knowledge order:/ })).toContainText('Entry Z–A');
      await expect(page.getByRole('combobox', { name: /^Knowledge layout:/ })).toContainText('Grid');
      await expect(page.getByRole('button', { name: 'First Knowledge page', exact: true })).toBeEnabled();
      expect(await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))).toEqual(identities);
      const knowledgeAfterHome = await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).inputValue();
      await page.screenshot({ path: info.outputPath(`navigation-knowledge-${width}-after-home.png`) });
      navigationReceipts.push({ width, materialAfterSwitch, knowledgeAfterSwitch, knowledgeAfterHome });
      await page.getByRole('button', { name: 'Material', exact: true }).click();
    }
    const navigationReceipt = JSON.stringify({ materialDraft, knowledgeDraft, navigationReceipts });
    await writeFile(info.outputPath('navigation-restoration.json'), navigationReceipt);
    await info.attach('navigation-restoration.json', { body: navigationReceipt, contentType: 'application/json' });
    // An activity leaves the management subtree, then returns through its real
    // checkpointing action. Its return must not replace the retained subtree.
    const document = await client.openDocument(resolve('tests/fixtures/reader/continuity.txt'), packageId);
    const activityReceipts = [];
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
      const rows = page.locator('[data-testid^="knowledge-target-"]');
      const identities = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')));
      expect(identities).toHaveLength(24);
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('button', { name: `Continue ${document.source.title}`, exact: true }).click();
      await expect(page.getByRole('button', { name: 'Children: untracked', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Save position', exact: true }).click();
      const saved = (await client.resumeDocument(document.source.id)).source.position;
      expect(saved).not.toBeNull();
      await page.screenshot({ path: info.outputPath(`navigation-reader-${width}.png`) });
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
      const after = await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).inputValue();
      activityReceipts.push({ width, sourceId: document.source.id, saved,
        resumed: (await client.resumeDocument(document.source.id)).source.position,
        knowledgeAfterReader: after, url: page.url() });
      await writeFile(info.outputPath('navigation-activity-return.json'), JSON.stringify(activityReceipts));
      await page.screenshot({ path: info.outputPath(`navigation-knowledge-${width}-after-reader.png`) });
      await expect(page.getByRole('textbox', { name: 'Search Knowledge', exact: true })).toHaveValue(knowledgeDraft);
      await expect(page.getByRole('combobox', { name: /^Knowledge order:/ })).toContainText('Entry Z–A');
      await expect(page.getByRole('combobox', { name: /^Knowledge layout:/ })).toContainText('Grid');
      await expect(page.getByRole('button', { name: 'First Knowledge page', exact: true })).toBeEnabled();
      expect(await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))).toEqual(identities);
      expect((await client.resumeDocument(document.source.id)).source.position).toEqual(saved);
      await page.getByRole('button', { name: 'Material', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Search Material', exact: true })).toHaveValue(materialDraft);
    }
    // A deliberate source-bearing entry must use its actual saved Material
    // without replacing the previously retained management presentation.
    const sourceEntryReceipts = [];
    for (const width of [1080, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('button', { name: `Continue ${document.source.title}`, exact: true }).click();
      await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
      await expect(inspector).toBeVisible();
      if (width === 1080) {
        await inspector.getByRole('button', { name: 'Capture Children', exact: true }).click();
        await expect(inspector.getByRole('button', { name: 'Open saved Children: revision 1', exact: true })).toBeVisible();
      } else {
        await inspector.getByRole('button', { name: 'Capture options', exact: true }).click();
      }
      const entered = page.waitForResponse(response => {
        if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
        const payload = response.request().postDataJSON();
        if (typeof payload.args?.request !== 'string') return false;
        const request = JSON.parse(payload.args.request);
        return request.type === 'collection' && request.query.surface === 'material';
      });
      const [sourceReceipt] = await Promise.all([entered, width === 1080
        ? inspector.getByRole('button', { name: 'Open saved Children: revision 1', exact: true }).click()
        : page.getByRole('menuitem', { name: 'Open saved Children', exact: true }).click()]);
      await sourceReceipt.finished();
      await expect(page.getByRole('heading', { name: 'Edit Material', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Phrase', exact: true })).toHaveValue('Children');
      const saved = await client.materials({ after: null, query: '', sourceId: document.source.id, includeExcluded: true });
      expect(saved.items).toHaveLength(1);
      expect(saved.items[0].content.source?.sourceId).toBe(document.source.id);
      await expect(page).toHaveURL(new RegExp(`sourceId=${document.source.id}`));
      const request = JSON.parse(sourceReceipt.request().postDataJSON().args.request);
      expect(request.query.filter.filters).toContainEqual({ kind: 'source', sourceId: document.source.id });
      await page.screenshot({ path: info.outputPath(`navigation-source-material-${width}.png`) });
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
      const after = await page.getByRole('textbox', { name: 'Search Knowledge', exact: true }).inputValue();
      sourceEntryReceipts.push({ width, sourceId: document.source.id, materialId: saved.items[0].id,
        query: request.query, knowledgeAfterSourceEntry: after, url: page.url() });
      await writeFile(info.outputPath('navigation-source-entry.json'), JSON.stringify(sourceEntryReceipts));
      await page.screenshot({ path: info.outputPath(`navigation-knowledge-${width}-after-source-entry.png`) });
      await expect(page.getByRole('textbox', { name: 'Search Knowledge', exact: true })).toHaveValue(knowledgeDraft);
      await page.getByRole('button', { name: 'Material', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Search Material', exact: true, includeHidden: true })).toHaveValue(materialDraft);
    }
    await backend.crashRestart();
    await page.goto('/knowledge');
    const known = page.getByTestId(`knowledge-target-${target.summary.targetId}`)
      .getByRole('button', { name: `${target.summary.headword}: claimed known`, exact: true });
    await expect(known).toBeVisible();
    await page.screenshot({ path: info.outputPath('knowledge-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(known).toBeInViewport();
    const bounds = await known.boundingBox();
    if (!bounds) throw new Error('Knowledge entry has no visible bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await known.click();
    await expect(inspector).toBeVisible();
    await page.screenshot({ path: info.outputPath('knowledge-phone-inspector.png') });
    await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    await expect(known).toBeFocused();
  } finally {
    await backend.close();
  }
});

test('an unavailable explicit package requires a replacement choice instead of changing scope', async ({ page }, info) => {
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/knowledge-scope-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID,
    execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: English is available, but the requested package is not installed.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();

    // When: the user opens an explicit unavailable scope.
    await page.goto('/knowledge?packageId=org.mlearn.uninstalled');

    // Then: the native failure remains visible until a real replacement choice.
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Knowledge language: English', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('knowledge-package-unavailable-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('alert')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('knowledge-package-unavailable-phone.png') });
    await page.getByRole('combobox', { name: /^Knowledge language:/ }).click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add selected to Material', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Edit selected', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove selected', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('knowledge-empty-selection-phone.png') });
    await page.setViewportSize({ width: 1080, height: 900 });
    await page.screenshot({ path: info.outputPath('knowledge-empty-selection-desktop.png') });

    // Explicit Home scope replaces a different retained scope, without preparing
    // a second catalog or guessing the installed package's display label.
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*Japanese/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*Japanese/ })).toBeVisible();
    const installed = (await client.snapshot()).installedPlugins;
    const scopes = [{ width: 1080, packageId: 'org.mlearn.japanese' }, { width: 390, packageId: 'org.mlearn.english' }].map(scope => {
      const language = installed.find(item => item.id === scope.packageId);
      if (!language) throw new Error(`Expected installed package ${scope.packageId}`);
      return { ...scope, label: language.displayName ?? language.id };
    });
    const scopeReceipts = [];
    for (const scope of scopes) {
      await page.setViewportSize({ width: scope.width, height: 900 });
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('combobox', { name: /^Source language:/ }).click();
      await page.getByTestId(`language-${scope.packageId}`).click();
      const entered = page.waitForResponse(response => {
        if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
        const payload = response.request().postDataJSON();
        if (typeof payload.args?.request !== 'string') return false;
        const request = JSON.parse(payload.args.request);
        return request.type === 'collection' && request.query.surface === 'knowledge'
          && request.query.packageId === scope.packageId;
      });
      const [receipt] = await Promise.all([
        entered, page.getByRole('button', { name: 'Knowledge', exact: true }).click(),
      ]);
      await receipt.finished();
      await expect(page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true })).toBeVisible();
      await expect(page.getByText('Loading Knowledge…', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: `Knowledge language: ${scope.label}`, exact: true })).toBeVisible();
      scopeReceipts.push({
        ...scope, via: 'home', url: page.url(),
        firstQueryPackageId: JSON.parse(receipt.request().postDataJSON().args.request).query.packageId,
        selectedLanguage: await page.getByRole('combobox', { name: /^Knowledge language:/ }).textContent(),
      });
      await page.screenshot({ path: info.outputPath(`knowledge-home-scope-${scope.width}.png`) });
    }
    await writeFile(info.outputPath('knowledge-home-scope.json'), JSON.stringify(scopeReceipts));
    await page.getByRole('combobox', { name: /^Knowledge language:/ }).click();
    await page.getByRole('option', { name: scopes[0].label, exact: true }).click();
    await expect(page).toHaveURL(/packageId=org\.mlearn\.japanese/);
    let releaseHome = () => {};
    let holdHome = true;
    const heldHome = new Promise<void>(resolve => { releaseHome = resolve; });
    const homeAdmitted = page.waitForRequest(request => {
      if (request.url() !== `${backend.url}/invoke` || request.method() !== 'POST') return false;
      const payload = request.postDataJSON();
      return typeof payload.args?.request === 'string' && JSON.parse(payload.args.request).type === 'snapshot';
    });
    const hiddenHomeReads: string[] = [];
    const recordHomeRead = (request: Request) => {
      if (request.url() !== `${backend.url}/invoke` || request.method() !== 'POST') return;
      const payload = request.postDataJSON();
      if (typeof payload.args?.request !== 'string') return;
      const command = JSON.parse(payload.args.request);
      if (command.type === 'recent_sources' || command.type === 'recent_documents')
        hiddenHomeReads.push(command.type);
    };
    await page.route(`${backend.url}/invoke`, async route => {
      const payload = route.request().postDataJSON();
      if (holdHome && typeof payload.args?.request === 'string'
        && JSON.parse(payload.args.request).type === 'snapshot') {
        holdHome = false;
        const response = await route.fetch();
        await heldHome;
        await route.fulfill({ response });
      } else await route.continue();
    });
    try {
      await Promise.all([homeAdmitted, page.getByRole('button', { name: 'Home', exact: true }).click()]);
      page.on('request', recordHomeRead);
      const returned = page.waitForResponse(response => {
        if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
        const payload = response.request().postDataJSON();
        if (typeof payload.args?.request !== 'string') return false;
        const request = JSON.parse(payload.args.request);
        return request.type === 'collection' && request.query.surface === 'knowledge'
          && request.query.packageId === 'org.mlearn.english';
      });
      const [returnedReceipt] = await Promise.all([returned, (async () => {
        await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
        await expect(page.getByRole('combobox', { name: `Knowledge language: ${scopes[1].label}`, exact: true })).toBeVisible();
        releaseHome();
      })()]);
      await returnedReceipt.finished();
      await expect(page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true })).toBeVisible();
      await expect(page.getByText('Loading Knowledge…', { exact: true })).toHaveCount(0);
      expect(hiddenHomeReads).toEqual([]);
      scopeReceipts.push({
        ...scopes[1], via: 'home-after-local-choice', url: page.url(),
        firstQueryPackageId: JSON.parse(returnedReceipt.request().postDataJSON().args.request).query.packageId,
        selectedLanguage: await page.getByRole('combobox', { name: /^Knowledge language:/ }).textContent(),
      });
      await page.screenshot({ path: info.outputPath('knowledge-home-after-local-choice-390.png') });
      await writeFile(info.outputPath('knowledge-home-scope.json'), JSON.stringify(scopeReceipts));
    } finally {
      releaseHome();
      page.off('request', recordHomeRead);
      await page.unroute(`${backend.url}/invoke`);
    }
  } finally {
    await backend.close();
  }
});
