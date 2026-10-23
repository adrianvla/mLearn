import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentWindow, MaterialContent, OcrPage, SourceAnchor } from '@mlearn/contracts';
import { createRuntimeClient, RuntimeError } from '../src/client.ts';

const source: DocumentWindow = {
  source: {
    id: 'image-book', title: 'Original collection', documentPath: '/owned/original.images', format: 'images',
    contentRevision: 'original-bytes', parserRevision: 'images-1', packageId: 'package', packageVersion: '1',
    appearance: { writingMode: 'auto', font: 'source', fontSize: 24, lineHeight: 1.6, letterSpacing: 0 },
    position: { parserRevision: 'images-1', resource: 'image-0', blockId: 'page-0', offset: 0 },
    totalBlocks: 1, totalPages: 1, progression: null, fidelity: [],
  },
  blocks: [{ resource: 'image-0', id: 'page-0', kind: 'image', text: '', readings: [],
    image: { resourceId: 'image-0', alt: 'Original page' }, page: 0, writingMode: null }],
  previous: null, next: null,
};
const page: OcrPage = {
  sourceId: source.source.id, contentRevision: source.source.contentRevision, resourceId: 'image-0', ocrRevision: 1,
  provider: { id: 'provider', label: 'Provider', revision: '1', availability: 'ready', languages: [], scripts: [],
    languageProvenance: 'test SDK', reason: null },
  width: 400, height: 800, crop: null, regions: [{ id: 'original-region', text: '🌱 東京へ。',
    quad: { topLeft: { x: 0.1, y: 0.1 }, topRight: { x: 0.8, y: 0.1 },
      bottomRight: { x: 0.8, y: 0.3 }, bottomLeft: { x: 0.1, y: 0.3 } },
    candidates: [{ text: '🌱 東京へ。', confidence: 0.9 }], language: null, orientation: null, readingOf: null }],
};
const anchor: SourceAnchor = {
  sourceId: source.source.id, contentRevision: source.source.contentRevision,
  packageId: source.source.packageId, packageVersion: source.source.packageVersion, text: page.regions[0].text,
  locator: { kind: 'image', resourceId: page.resourceId, pageIndex: 0, ocrRevision: 1,
    regionId: 'original-region', contextStart: 0, selectionStart: 5, selectionEnd: 11 },
};

test('Review image Return retains its original region revision rather than accepting a newer projection', async () => {
  // Given a frozen encounter and a matching immutable OCR source response.
  let returnedPage = page;
  const client = createRuntimeClient({ commandId: () => 'unused',
    execute: async () => JSON.stringify({ type: 'image_material_source', window: source, page: returnedPage, anchor }) });
  // When the original response is returned, then only that exact region is admitted.
  const result = await client.returnReviewSource('review', 'encounter');
  assert.equal(result.type, 'image_material_source');
  assert.deepEqual(result.anchor, anchor);
  returnedPage = { ...page, ocrRevision: 2 };
  await assert.rejects(client.returnReviewSource('review', 'encounter'),
    (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol');
});

test('OCR recovery preserves terminal native state and rejects a receipt for different source or provider', async () => {
  let recovery: unknown = { state: 'completed', page };
  const client = createRuntimeClient({ commandId: () => 'original-action',
    execute: async raw => {
      assert.equal(JSON.parse(raw).type, 'ocr_recovery');
      return JSON.stringify({ type: 'ocr_recovery', recovery });
    } });
  const request = client.prepareOcr(source.source, page.resourceId, page.provider, [], null);
  assert.deepEqual(await client.ocrRecovery(request), { state: 'completed', page });
  for (const state of ['unknown', 'pending', 'cancelled']) {
    recovery = { state };
    assert.deepEqual(await client.ocrRecovery(request), recovery);
  }
  for (const invalid of [
    { state: 'failed' },
    { state: 'completed', page: { ...page, resourceId: 'another-image' } },
    { state: 'completed', page: { ...page, contentRevision: 'different-original' } },
    { state: 'completed', page: { ...page, provider: { ...page.provider, id: 'different-provider' } } },
  ]) {
    recovery = invalid;
    await assert.rejects(client.ocrRecovery(request),
      (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol');
  }
});

test('image Capture accepts exact UTF8 source bytes and rejects a split supplementary character', () => {
  // Given an authored capture linked to original OCR bytes after an astral prefix.
  const content: MaterialContent = { packageId: 'package', targetId: 'target', packageRevision: null, sense: null,
    phrase: '東京', reading: '', meaning: '', context: anchor.text, notes: '', examples: [], source: anchor, attachments: [] };
  const client = createRuntimeClient({ commandId: () => 'capture-action', execute: async () => { throw new Error('Not a read'); } });
  // When source-linked capture is prepared, then only UTF8-aligned selection is valid.
  assert.deepEqual(client.prepareMaterial(content).content.source, anchor);
  assert.throws(() => client.prepareMaterial({ ...content, source: {
    ...anchor, locator: { ...anchor.locator, selectionStart: 1 },
  } }), (cause: unknown) => cause instanceof RuntimeError && cause.code === 'invalid_request');
});
