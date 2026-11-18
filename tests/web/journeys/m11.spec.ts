import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import { test, expect, installPackage } from './fixture';

// PLAN M11 Review: open a source-filtered practice, suspend it, calibrate a different scope, resume
// the first task, exercise valid and unsupported grammar tasks, and inspect the difference between
// self-report and validated evidence.
test('M11 source practice, Word Sync on another scope, resume, grammar tasks and evidence kinds', async ({ page, nativeCore }, info) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(20_000);
  const client = createRuntimeClient({ commandId: randomUUID, execute: request => nativeCore.invoke('runtime_execute', { request }) });
  const packageId = 'org.mlearn.english';
  await installPackage(page);

  // Source-filtered practice from the book's vocabulary, then suspend it.
  const book = await client.openDocument(path.resolve('tests/fixtures/reader/continuity.txt'), packageId);
  await page.goto(`/reader?id=${book.source.id}`);
  await expect(page.getByTestId('reader-document-ready').getByRole('button', { name: /^Children: / })).toBeVisible();
  await page.getByTestId('reader-side-panel').getByRole('button', { name: /^Practi[cs]e/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Word Practice', exact: true })).toBeVisible();
  await expect(page.getByTestId('review-cue')).toBeVisible();
  const [practice] = await client.reviewSessions();
  if (!practice?.encounter) throw new Error('Source practice has no encounter');
  const cue = practice.encounter;
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText(/paused/i).first()).toBeVisible();

  // Calibrate a different scope while the first task stays suspended.
  await page.goto(`/review?activity=calibration&packageId=${packageId}`);
  await page.getByRole('button', { name: 'Unmeasured items', exact: true }).click();
  await page.getByRole('textbox', { name: 'Scope text', exact: true }).fill('The small bridge is quiet.');
  await page.getByRole('button', { name: 'Start Word Sync', exact: true }).click();
  // Fresh words are not prepared yet: Word Sync says so in place and leads to preparation.
  await expect(page.getByTestId('calibration-unprepared')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('m11-unprepared.png') });
  await page.getByRole('button', { name: 'Prepare words', exact: true }).click();
  const prepare = page.getByRole('button', { name: 'Prepare Knowledge collection', exact: true });
  await prepare.click();
  // Prepare is hidden while preparing, so completion is the end of the progress line.
  await expect(page.getByText(/^Preparing words · /)).toHaveCount(0, { timeout: 300_000 });
  await expect(prepare).toHaveCount(0);
  await page.goto(`/review?activity=calibration&packageId=${packageId}`);
  await page.getByRole('button', { name: 'Unmeasured items', exact: true }).click();
  await page.getByRole('textbox', { name: 'Scope text', exact: true }).fill('bridge');
  await page.getByRole('button', { name: 'Start Word Sync', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Word Sync', exact: true })).toBeVisible();
  await expect(page.getByTestId('review-cue')).toBeVisible();
  const sessions = await client.reviewSessions();
  const calibration = sessions.find(session => session.id !== practice.id);
  if (!calibration?.encounter) throw new Error('Word Sync did not admit its own scope');
  expect(calibration.encounter.targets.map(target => target.key?.targetId)).not.toContain(cue.targets[0]?.key?.targetId);
  await page.screenshot({ path: info.outputPath('m11-word-sync.png') });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  // Resume the first task exactly where it was suspended.
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await page.getByRole('button', { name: `Open Word Practice ${practice.id}`, exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('review-cue')).toBeVisible();
  expect((await client.reviewSession(practice.id)).encounter).toEqual(cue);

  // A valid typed grammar task runs the package validator; an undeclared one is refused.
  const grammar = await client.inspectTarget(packageId, 'org.mlearn.english:grammar/past-simple-negative');
  const typed = (await client.review(client.prepareReviewStart({
    kind: 'target_practice', items: [{
      packageId, targetId: grammar.entry.targetId, packageRevision: grammar.packageRevision,
      capabilities: grammar.entry.capabilities.map(capability => capability.id), source: null,
    }],
  }))).session;
  await page.goto(`/review?sessionId=${typed.id}`);
  await page.getByRole('textbox', { name: 'Your response', exact: true }).fill('did not walk');
  await page.getByRole('button', { name: 'Check response', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.getByTestId('review-answer')).toBeVisible();
  const validated = await client.reviewSession(typed.id);
  expect(validated.encounter?.capture?.feedback?.outcomes.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'All Fluent', exact: true }).click();
  await expect.poll(async () => (await client.reviewSession(typed.id)).completed).toBe(1);
  await expect(client.review(client.prepareReviewStart({
    kind: 'target_practice', items: [{
      packageId, targetId: 'org.mlearn.english:grammar/undeclared-construction', packageRevision: grammar.packageRevision,
      capabilities: grammar.entry.capabilities.map(capability => capability.id), source: null,
    }],
  }))).rejects.toThrow();

  // Evidence keeps a validated attempt distinct from a self-reported claim.
  await page.goto(`/reader?id=${book.source.id}`);
  await page.getByTestId('reader-document-ready').getByRole('button', { name: /^Children: / }).click();
  const inspector = page.getByTestId('inspector-panel');
  const description = await client.describeLanguage(packageId);
  const capability = description.capabilities.find(value => value.id === description.annotationCapability);
  if (!capability) throw new Error('The package names no annotation capability');
  await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
  await inspector.getByRole('button', { name: capability.label, exact: true }).click();
  await inspector.getByRole('button', { name: `Claim ${capability.label} known`, exact: true }).click();
  await inspector.getByRole('button', { name: 'Inspect evidence', exact: true }).first().click();
  await expect(inspector.getByText(/^Explicit claim: known/)).toBeVisible();
  await expect(inspector.getByText(/^Assessed state: /)).not.toHaveText(/known$/);
  await page.screenshot({ path: info.outputPath('m11-evidence.png') });
});
