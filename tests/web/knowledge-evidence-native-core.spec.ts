/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createRuntimeClient } from '@mlearn/runtime-client';
import type { KnowledgeKey, ReviewSession } from '@mlearn/contracts';
import { builtInThemes } from '../../packages/theme/src/theme';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

test('Inspector evidence preserves actual claims, physical attempts and source context through paging and restart', async ({ page }, info) => {
  test.setTimeout(180_000);
  const backend = await startRuntimeBrowserQa({
    profile: `${process.env.RUN_TMP ?? '.mlearn/m10'}/knowledge-evidence-${randomUUID()}`,
  });
  const client = createRuntimeClient({
    commandId: randomUUID, execute: request => backend.invoke('runtime_execute', { request }),
  });
  try {
    // Given: a real source-selected canonical word captured through Inspector.
    await attachRuntimeBrowserQa(page, backend.url);
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const document = await client.openDocument(resolve('tests/fixtures/reader/continuity.txt'), 'org.mlearn.english');
    await page.goto(`/reader?id=${document.source.id}`);
    const word = page.getByRole('button', { name: 'Children: untracked', exact: true });
    await word.click();
    const inspector = page.getByTestId('inspector-panel');
    await inspector.getByRole('button', { name: 'Capture Children', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Open saved Children: revision 1', exact: true })).toBeVisible();
    const materials = await client.materials({ after: null, query: '', sourceId: document.source.id, includeExcluded: true });
    expect(materials.items).toHaveLength(1);
    const material = materials.items[0];
    expect(material.content.source?.sourceId).toBe(document.source.id);
    await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    let key: KnowledgeKey | null = null;
    let latest: ReviewSession | null = null;
    for (let index = 0; index < 17; index++) {
      let session = (await client.review(client.prepareReviewStart({
        kind: 'practice', items: [{ materialId: material.id, source: null }],
      }))).session;
      const encounter = session.encounter;
      if (!encounter) throw new Error('Actual package did not admit the captured Material');
      const targetKey = encounter.targets.find(target => target.key)?.key;
      if (!targetKey) throw new Error('Actual probe has no Knowledge target');
      key ??= targetKey;
      expect(targetKey).toEqual(key);
      session = (await client.review(client.prepareReviewMutation(session, { kind: 'reveal', encounterId: encounter.id }))).session;
      latest = (await client.review(client.prepareReviewMutation(session, {
        kind: 'submit', response: { encounterId: encounter.id, grades: encounter.targets.map(target => ({
          targetId: target.id, quality: index === 16 ? 'missed' : 'fluent', method: 'remembered', easy: false,
        })) },
      }))).session;
      if (index < 16 && latest.state === 'active')
        await client.review(client.prepareReviewMutation(latest, { kind: 'pause' }));
    }
    if (!key || !latest) throw new Error('Physical Review attempts were not recorded');
    const initial = await client.knowledgeEvidence({ key, after: null });
    expect(initial.observations).toHaveLength(16);
    expect(initial.projection.assessed).toBe(false);
    const physical = initial.observations[0];
    const undone = (await client.review(client.prepareReviewMutation(latest, { kind: 'undo' }))).session;
    const correction = undone.encounter;
    if (!correction) throw new Error('Undo did not restore the physical encounter');
    await client.review(client.prepareReviewMutation(undone, {
      kind: 'correct', response: { encounterId: correction.id, grades: correction.targets.map(target => ({
        targetId: target.id, quality: 'struggled', method: 'worked_out', easy: false,
      })) },
    }));
    const corrected = await client.knowledgeEvidence({ key, after: null });
    expect(corrected.observations[0]).toMatchObject({
      attemptId: physical.attemptId, createdAt: physical.createdAt, conditions: physical.conditions, assessed: null,
    });
    expect(corrected.projection.assessed).toBe(true);
    const description = await client.describeLanguage(key.packageId);
    const capability = description.capabilities.find(value => value.id === key.capability);
    if (!capability) throw new Error('Actual evidence capability has no package label');

    // When: the same Inspector opens the bounded native evidence, including
    // a conflicting explicit claim and the corrected physical attempt.
    await word.click();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: capability.label, exact: true }).click();
    await inspector.getByRole('button', { name: `Claim ${capability.label} unknown`, exact: true }).click();
    await expect(inspector.getByText(`${capability.label} · claimed unknown`, { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Inspect evidence', exact: true }).click();
    const evidence = inspector.getByTestId('knowledge-evidence');
    await expect(evidence.getByText('Explicit claim: unknown', { exact: false })).toBeVisible();
    await expect(evidence.getByText('Assessed self-report: remembered', { exact: true })).toBeVisible();
    await expect(evidence.getByRole('button', { name: /^Attempt \d+ details$/ })).toHaveCount(16);
    await evidence.getByRole('button', { name: `Attempt ${physical.sequence} details`, exact: true }).click();
    await expect(evidence.getByText(`Material: ${material.id} · revision 1`, { exact: true })).toBeVisible();
    await expect(evidence.getByText(/^Source: document/)).toContainText(document.source.id);
    await page.screenshot({ path: info.outputPath('evidence-expanded-source-desktop.png') });
    await evidence.getByRole('button', { name: 'Older observations', exact: true }).click();
    await expect(evidence.getByRole('button', { name: /^Attempt \d+ details$/ })).toHaveCount(1);
    await expect(evidence.getByRole('button', { name: 'Older observations', exact: true })).toHaveCount(0);
    await evidence.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
    await expect(evidence.getByRole('button', { name: /^Attempt \d+ details$/ })).toHaveCount(16);
    await evidence.getByRole('button', { name: 'Back to entry', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Inspect evidence', exact: true })).toBeFocused();
    await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
    await inspector.getByRole('button', { name: 'Close Inspector', exact: true }).click();

    // Then: restart and either theme retain the same projection and source;
    // only the bounded Inspector body scrolls and its dismissal returns focus.
    await backend.crashRestart();
    const reopened = await client.knowledgeEvidence({ key, after: null });
    expect(reopened.projection).toMatchObject({ claim: false, assessed: true, prediction: null, status: 'claimed_unknown' });
    expect(reopened.observations[0].attemptId).toBe(physical.attemptId);
    const summary = await client.inspectTarget(key.packageId, key.targetId, null);
    expect(summary.knowledge.claim).toBe('mixed');
    for (const theme of builtInThemes) {
      await client.saveTheme(theme, (await client.snapshot()).revision);
      await page.goto(`/reader?id=${document.source.id}`);
      const current = page.getByRole('button', { name: `Children: ${summary.knowledge.claim}`, exact: true });
      await current.click();
      await inspector.getByRole('button', { name: /^Knowledge:/ }).click();
      await inspector.getByRole('button', { name: capability.label, exact: true }).click();
      await inspector.getByRole('button', { name: 'Inspect evidence', exact: true }).click();
      await expect(evidence.getByRole('button', { name: /^Attempt \d+ details$/ })).toHaveCount(16);
      for (const width of [1080, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await evidence.getByRole('button', { name: 'Back to entry', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`evidence-${theme.id}-${width}-top.png`) });
        const details = evidence.getByRole('button', { name: `Attempt ${physical.sequence} details`, exact: true });
        await details.click();
        const source = evidence.getByText(/^Source: document/);
        await source.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`evidence-${theme.id}-${width}-provenance.png`) });
        await details.click();
        await evidence.getByRole('button', { name: 'Older observations', exact: true }).scrollIntoViewIfNeeded();
        await expect(evidence.getByRole('button', { name: 'Older observations', exact: true })).toBeInViewport();
        const bounds = await inspector.boundingBox();
        if (!bounds) throw new Error('Inspector has no rendered bounds');
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath(`evidence-${theme.id}-${width}-end.png`) });
      }
      await page.keyboard.press('Escape');
      await expect(inspector).toHaveCount(0);
      await expect(current).toBeFocused();
    }
  } finally {
    await backend.close();
  }
});
