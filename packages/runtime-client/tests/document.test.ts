import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentCheckpoint, DocumentSearchPage, DocumentSearchQuery, DocumentWindow, SourceAnchor } from '@mlearn/contracts';
import { createRuntimeClient, RuntimeError } from '../src/client.ts';

function document(): DocumentWindow {
  return {
    source: {
      id: 'document-fixture', title: 'Source ruby', documentPath: '/profile/documents/fixture.epub',
      contentRevision: 'content', parserRevision: 'parser-1', format: 'epub',
      packageId: 'package', packageVersion: '1', position: null,
      appearance: { writingMode: 'auto', font: 'source', fontSize: 24, lineHeight: 1.6, letterSpacing: 0 },
      progression: 'rtl', totalBlocks: 1, totalPages: 0, fidelity: [],
    },
    blocks: [{
      resource: 'chapter.xhtml', id: 'partial', kind: 'p', text: '🌱 取り戻す。',
      readings: [{ start: 5, end: 8, text: 'と' }, { start: 11, end: 14, text: 'もど' }],
      image: null, page: null, writingMode: 'vertical-lr',
    }],
    previous: null, next: null,
  };
}

test('document transport preserves authored partial ruby and rejects split source coordinates', async () => {
  const expected = document();
  let response = expected;
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => JSON.stringify({ type: 'document', window: response }),
  });

  assert.deepEqual(await client.resumeDocument(expected.source.id), expected);
  response = structuredClone(expected);
  response.blocks[0].readings[0].start = 1;

  await assert.rejects(client.resumeDocument(expected.source.id),
    (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol');
});

test('checkpoint admission snapshots its source position and appearance before awaiting transport', { timeout: 5000 }, async () => {
  const window = document();
  const checkpoint: DocumentCheckpoint = {
    sourceId: window.source.id, contentRevision: window.source.contentRevision,
    position: { parserRevision: 'parser-1', resource: 'chapter.xhtml', blockId: 'partial', offset: 5 },
    appearance: { ...window.source.appearance, fontSize: 30 },
  };
  const expected = structuredClone(checkpoint);
  let submitted = '';
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async raw => {
      submitted = raw;
      entered();
      await gate;
      return JSON.stringify({ type: 'document', window: {
        ...window, source: { ...window.source, position: expected.position, appearance: expected.appearance },
      } });
    },
  });

  const pending = client.checkpointDocument(checkpoint);
  await ready;
  checkpoint.position.offset = 8;
  checkpoint.appearance.fontSize = 48;
  release();
  const result = await pending;

  assert.deepEqual(JSON.parse(submitted), { type: 'checkpoint_document', checkpoint: expected });
  assert.deepEqual(result.source.position, expected.position);
  assert.deepEqual(result.source.appearance, expected.appearance);
});

test('document source return rejects a different original block despite matching quotation text', async () => {
  const window = document();
  window.source.position = {
    parserRevision: 'parser-1', resource: 'chapter.xhtml', blockId: 'partial', offset: 5,
  };
  const anchor = {
    sourceId: window.source.id, contentRevision: window.source.contentRevision,
    packageId: window.source.packageId, packageVersion: window.source.packageVersion,
    text: window.blocks[0].text,
    locator: { kind: 'document', parserRevision: 'parser-1', resource: 'chapter.xhtml',
      blockId: 'partial', contextStart: 0, selectionStart: 5, selectionEnd: 8 },
  };
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => JSON.stringify({ type: 'document_material_source', window, anchor }),
  });

  assert.equal((await client.returnMaterialSource('material')).anchor.locator.kind, 'document');
  anchor.locator.blockId = 'same-quotation-in-another-block';

  await assert.rejects(client.returnMaterialSource('material'),
    (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol');
});

function searchFixture() {
  const window = document();
  const position = { parserRevision: 'parser-1', resource: 'chapter.xhtml', blockId: 'partial', offset: 5 };
  const anchor: SourceAnchor = {
    sourceId: window.source.id, contentRevision: window.source.contentRevision,
    packageId: window.source.packageId, packageVersion: window.source.packageVersion, text: window.blocks[0].text,
    locator: { kind: 'document', parserRevision: position.parserRevision, resource: position.resource,
      blockId: position.blockId, contextStart: 0, selectionStart: 5, selectionEnd: 8 },
  };
  const query: DocumentSearchQuery = {
    sourceId: anchor.sourceId, contentRevision: anchor.contentRevision, parserRevision: position.parserRevision,
    scope: 'text', text: '取', after: null,
  };
  const page: DocumentSearchPage = {
    sourceId: query.sourceId, contentRevision: query.contentRevision, parserRevision: query.parserRevision,
    scope: query.scope, text: query.text,
    hits: [{ position, anchor }], next: null, scanned: 1, total: 1, unavailable: 0,
  };
  return { query, page, window: { ...window, source: { ...window.source, position } }, anchor };
}

test('document search rejects broadened scope, false progress and forged UTF-8 source matches', async () => {
  // Given: a bounded original span returned by the native search owner.
  const { query, page } = searchFixture();
  let packet: unknown = page;
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => JSON.stringify({ type: 'document_search', page: packet }),
  });
  assert.deepEqual(await client.searchDocument(query), page);
  const hit = page.hits[0];

  // When: a response cannot describe this source query or its scan/match coordinates.
  for (const malformed of [
    { ...page, sourceId: 'foreign' },
    { ...page, contentRevision: 'changed' },
    { ...page, parserRevision: 'changed' },
    { ...page, scope: 'recognized_pages' },
    { ...page, text: 'another query' },
    { ...page, scanned: 0 },
    { ...page, unavailable: 2 },
    { ...page, hits: Array.from({ length: 17 }, () => hit) },
    { ...page, hits: [{ ...hit, position: { ...hit.position, offset: 8 } }] },
    { ...page, hits: [{ ...hit, anchor: { ...hit.anchor, locator: { ...hit.anchor.locator, selectionStart: 1 } } }] },
    { ...page, hits: [{ ...hit, anchor: { ...hit.anchor, locator: { ...hit.anchor.locator, selectionStart: 8, selectionEnd: 11 } } }] },
  ]) {
    packet = malformed;
    await assert.rejects(client.searchDocument(query), { code: 'protocol' });
  }

  // Then: even a structurally valid cursor must advance the exact prior continuation.
  const cursor = { identity: 'a'.repeat(64), index: 0, region: 0, offset: 5, unavailable: 0 };
  packet = { ...page, scanned: 0, next: cursor };
  await assert.rejects(client.searchDocument({ ...query, after: cursor }), { code: 'protocol' });
});

test('search admission freezes the query and original cursor before awaiting native transport', { timeout: 5000 }, async () => {
  // Given: a queued read whose caller still owns mutable presentation input.
  const { query, page } = searchFixture();
  let submitted = '';
  let admit = () => {};
  let release = () => {};
  const admitted = new Promise<void>(resolve => { admit = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async raw => { submitted = raw; admit(); await held; return JSON.stringify({ type: 'document_search', page }); },
  });
  const expected = structuredClone(query);
  const pending = client.searchDocument(query);
  await admitted;

  // When: local input changes while the original source read is held.
  query.text = 'Changed input';
  release();

  // Then: only the originally submitted query is correlated and published.
  assert.deepEqual(await pending, page);
  assert.deepEqual(JSON.parse(submitted), { type: 'search_document', query: expected });
});

test('shared source Return preserves the requested anchor and rejects a late replaced-source receipt', { timeout: 5000 }, async () => {
  // Given: a real source-return shape behind the same client source epoch.
  const { window, anchor } = searchFixture();
  let returned = structuredClone(anchor);
  let hold = false;
  let admit = () => {};
  let release = () => {};
  const admitted = new Promise<void>(resolve => { admit = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => {
      if (hold) { admit(); await held; }
      return JSON.stringify({ type: 'document_material_source', window, anchor: returned });
    },
  });
  assert.deepEqual((await client.returnSourceAnchor(anchor)).anchor, anchor);
  returned.text = 'Fabricated quotation';
  await assert.rejects(client.returnSourceAnchor(anchor), { code: 'protocol' });
  returned = structuredClone(anchor);
  hold = true;
  const pending = client.returnSourceAnchor(anchor);
  const refused = assert.rejects(pending, { code: 'cancelled' });
  await admitted;

  // When: another source replaces the current navigation epoch before delivery.
  await client.cancelSourceOpen();
  release();

  // Then: a valid old packet cannot navigate the replacement source.
  await refused;
});

test('a held search receipt permits one bounded replacement and cannot block source navigation', { timeout: 5000 }, async () => {
  const { query, page, window } = searchFixture();
  let release = () => {};
  let enteredFirst = () => {};
  let enteredThird = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const firstEntered = new Promise<void>(resolve => { enteredFirst = resolve; });
  const thirdEntered = new Promise<void>(resolve => { enteredThird = resolve; });
  let searches = 0;
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async raw => {
      const command = JSON.parse(raw);
      if (command.type !== 'search_document') return JSON.stringify({ type: 'document', window });
      searches++;
      if (searches === 1) { enteredFirst(); await held; }
      if (searches === 3) { enteredThird(); await held; }
      return JSON.stringify({ type: 'document_search', page });
    },
  });
  const first = client.searchDocument(query);
  const firstCancelled = assert.rejects(first, { code: 'cancelled' });
  await firstEntered;
  assert.deepEqual(await client.searchDocument(query), page);
  assert.deepEqual(await client.resumeDocument(query.sourceId), window);
  const third = client.searchDocument(query);
  const thirdCancelled = assert.rejects(third, { code: 'cancelled' });
  await thirdEntered;
  await assert.rejects(client.searchDocument(query), { code: 'busy' });
  await client.cancelSourceOpen();
  release();
  await Promise.all([firstCancelled, thirdCancelled]);
  assert.deepEqual(await client.searchDocument(query), page);
});
