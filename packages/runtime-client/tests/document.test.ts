import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentCheckpoint, DocumentWindow } from '@mlearn/contracts';
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
