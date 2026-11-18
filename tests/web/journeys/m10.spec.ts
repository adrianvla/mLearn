import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { emptyMaterial } from '../../../apps/client/src/features/material/content';
import { selectionAction } from '../collection-actions';
import { test, expect, installPackage } from './fixture';

// PLAN M10 Review: use mixed captured/manual/import-fixture material; filter and bulk-edit a large
// set; inspect status basis and a graph relation; make a change and see source annotations and
// Knowledge agree. Test one missing optional provider without losing saved content.
test('M10 dense Knowledge and Material management', async ({ page, nativeCore }, info) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(20_000);
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  await installPackage(page);
  const packageId = 'org.mlearn.english';

  // Captured from a book, authored by hand, and an import-shaped fixture with examples.
  const book = await client.openDocument(path.resolve('tests/fixtures/reader/continuity.txt'), packageId);
  await page.goto(`/reader?id=${book.source.id}`);
  const document = page.getByTestId('reader-document-ready');
  const inspector = page.getByTestId('inspector-panel');
  await document.getByRole('button', { name: /^Children: / }).click();
  await inspector.getByRole('button', { name: 'Capture Children', exact: true }).click();
  await expect(inspector.getByRole('button', { name: 'Open saved Children: revision 1', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
  const total = 40;
  for (let index = 0; index < total; index++) {
    const saved = await client.createMaterial(client.prepareMaterial({
      ...emptyMaterial(packageId), phrase: `dense entry ${String(index).padStart(2, '0')}`,
      ...(index === 0 ? { meaning: 'Imported meaning', examples: ['An imported example.'], notes: 'Imported deck' } : {}),
    }));
    expect(saved.status).toBe('saved');
  }

  // Home, Knowledge and Material keep their state while switching, but only the focused one is
  // shown: on the transparent native window an unfocused view must not paint beneath it. Text and
  // placeholder locators see a painted view even when it is hidden from accessibility.
  await page.goto('/');
  const openReview = page.getByText('Open Review', { exact: true });
  const knowledgeSearch = page.getByPlaceholder('Search Knowledge');
  await page.getByRole('button', { name: 'Knowledge', exact: true }).first().click();
  await expect(knowledgeSearch).toBeVisible();
  await expect(openReview).toBeHidden();
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await expect(openReview).toBeVisible();
  await expect(knowledgeSearch).toBeHidden();

  // Filter the large set and bulk-edit every match.
  await page.goto('/materials');
  await page.getByTestId('material-search').fill('dense entry');
  await page.getByTestId('material-search-submit').click();
  await page.getByRole('button', { name: 'Select items', exact: true }).click();
  await selectionAction(page, `Select all ${total} matching`);
  await expect(page.getByText(`${total} selected`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit selected', exact: true }).click();
  await page.getByRole('textbox', { name: 'Replacement text', exact: true }).fill('dense shared note');
  await page.getByRole('button', { name: 'Apply bulk change', exact: true }).click();
  await expect(page.getByText(new RegExp(`completed · ${total} of ${total} processed`)).first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: info.outputPath('m10-bulk.png') });
  const edited = await client.materials({ after: null, query: 'dense entry', sourceId: null, includeExcluded: true });
  expect(edited.items.length).toBeGreaterThan(0);
  expect(edited.items.every(item => item.content.notes === 'dense shared note')).toBe(true);
  const captured = await client.materials({ after: null, query: 'Children', sourceId: book.source.id, includeExcluded: true });
  expect(captured.items.map(item => item.content.notes)).not.toContain('dense shared note');

  // Status basis and a graph relation of the captured target, then a claim change.
  await page.goto(`/reader?id=${book.source.id}`);
  await document.getByRole('button', { name: /^Children: / }).click();
  await inspector.getByRole('button', { name: 'Inspect', exact: true }).click();
  await inspector.getByRole('button', { name: 'Linguistic relationships', exact: true }).click();
  await expect(inspector.getByTestId('graph-relation').first()).toBeVisible();
  const description = await client.describeLanguage(packageId);
  const capability = description.capabilities.find(value => value.id === description.annotationCapability);
  if (!capability) throw new Error('The package names no annotation capability');
  await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
  await inspector.getByRole('button', { name: capability.label, exact: true }).click();
  await inspector.getByRole('button', { name: `Claim ${capability.label} known`, exact: true }).click();
  await expect(inspector.getByText(`${capability.label} · claimed known`, { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('m10-status-basis.png') });
  await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
  await expect(document.getByRole('button', { name: /^Children: / })).not.toHaveAccessibleName(/untracked/);
  await page.goto('/knowledge');
  const prepare = page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true });
  await expect(prepare).toBeVisible();
  await prepare.click();
  await expect(page.getByText(/^Preparing words · [1-9]/)).toBeVisible({ timeout: 60_000 });
  // Preparation runs natively: a reloaded screen keeps following its progress.
  await page.reload();
  const followed = page.getByText(/^Preparing words · /);
  await expect(followed).toBeVisible({ timeout: 30_000 });
  const followedFirst = await followed.innerText();
  await expect.poll(() => followed.innerText(), { timeout: 60_000 }).not.toBe(followedFirst);
  // Once progress has advanced (the collection has been re-read), one status line remains.
  const progress = page.getByText(/^Preparing words · /);
  const first = await progress.innerText();
  await expect.poll(() => progress.innerText(), { timeout: 60_000 }).not.toBe(first);
  await expect(page.getByText(/^Words need to be prepared/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true })).toHaveCount(0);
  // Prepare is hidden while preparing, so completion is the end of the progress line.
  await expect(page.getByText(/^Preparing words · /)).toHaveCount(0, { timeout: 300_000 });
  await expect(prepare).toHaveCount(0);
  const targetId = captured.items[0]?.content.targetId;
  if (!targetId) throw new Error('The captured word kept no target');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Group 1 add condition', exact: true }).click();
  await page.getByRole('combobox', { name: /^Condition 2 type/ }).click();
  await page.getByRole('option', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('combobox', { name: /^Condition 2 capability/ }).click();
  await page.getByRole('option', { name: capability.label, exact: true }).click();
  await page.getByRole('combobox', { name: /^Condition 2 Knowledge state/ }).click();
  await page.getByRole('option', { name: 'Claimed known', exact: true }).click();
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const row = page.getByTestId(`knowledge-target-${targetId}`);
  await expect(row).toContainText('claimed known');
  await expect(page.getByTestId(/^knowledge-target-/)).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('m10-knowledge-filter.png') });

  // A missing optional provider fails in place; saved content is unchanged.
  nativeCore.providerMode('fail');
  const before = await client.material(edited.items[0].id);
  await page.goto('/materials');
  await page.getByTestId('material-search').fill(before.content.phrase);
  await page.getByTestId('material-search-submit').click();
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  await page.getByRole('button', { name: 'Propose changes to saved Material', exact: true }).click();
  const proposals = page.getByRole('dialog', { name: 'Material proposals', exact: true });
  await proposals.getByRole('button', { name: 'Proposal generation and saved jobs', exact: true }).click();
  await proposals.getByRole('button', { name: 'Generate text proposals', exact: true }).click();
  const failed = proposals.getByRole('alert').first();
  await expect(failed).toBeVisible({ timeout: 30_000 });
  expect(await failed.innerText()).not.toMatch(/HTTP|\d{3}|fixture|provider_/i);
  await page.screenshot({ path: info.outputPath('m10-provider-missing.png') });
  expect(await client.material(before.id)).toEqual(before);
  nativeCore.providerMode('complete');
});
