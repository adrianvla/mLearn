/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CollectionItemId, CollectionQuery, CollectionSelectionSource } from '@mlearn/contracts';
import { createRuntimeClient } from '../src/client.ts';

const query: CollectionQuery = {
  packageId: 'org.example',
  surface: 'knowledge',
  filter: { kind: 'all', filters: [] },
  sort: 'default',
  after: null,
};

test('selection amendment freezes its draft and visible membership validates exact requested keys', async () => {
  // Given a prepared amendment whose unsubmitted draft later changes.
  const selected = {
    id: 'amended-selection', packageId: query.packageId, packageRevision: 'revision-one',
    targetCount: 1, materialCount: 0,
  };
  const first: CollectionItemId = { kind: 'target', targetId: 'entry-1' };
  const second: CollectionItemId = { kind: 'target', targetId: 'entry-2' };
  const source: CollectionSelectionSource = {
    kind: 'amend', selectionId: 'base-selection', query: structuredClone(query),
    add: [first], remove: [],
  };
  const original = structuredClone(source);
  let response: unknown = { type: 'collection_selection', selection: selected };
  const submissions: unknown[] = [];
  const client = createRuntimeClient({
    commandId: () => 'amend-once',
    execute: async raw => {
      const request: unknown = JSON.parse(raw);
      submissions.push(request);
      return JSON.stringify(response);
    },
  });
  const prepared = client.prepareCollectionSelection(source);
  source.add.push(second);

  // When the frozen intent is submitted and only the current page asks for membership.
  assert.deepEqual(await client.createCollectionSelection(prepared), selected);
  assert.deepEqual(submissions[0], {
    type: 'create_collection_selection', command: { commandId: 'amend-once', source: original },
  });
  const membership = [{ item: first, selected: true }, { item: second, selected: false }];
  response = { type: 'collection_selection_membership', id: selected.id, items: membership };

  // Then native item order/identity, bounded cardinality and boolean state are checked.
  assert.deepEqual(await client.collectionSelectionMembership(selected.id, query, [first,second]), membership);
  for (const invalid of [
    { id: 'foreign', items: membership },
    { id: selected.id, items: [...membership].reverse() },
    { id: selected.id, items: [{ item: first, selected: 'yes' }, membership[1]] },
    { id: selected.id, items: Array.from({ length: 65 }, () => membership[0]) },
  ]) {
    response = { type: 'collection_selection_membership', ...invalid };
    await assert.rejects(client.collectionSelectionMembership(selected.id, query, [first,second]), { code: 'protocol' });
  }
});

test('frozen selection retries retain the command and reject foreign or unbounded pages', async () => {
  // Given a selection receipt lost once at the transport boundary.
  const selected = {
    id: 'selection-1', packageId: query.packageId, packageRevision: 'revision-one',
    targetCount: 65, materialCount: 0,
  };
  const entry = {
    item: { kind: 'target', targetId: 'entry-1' }, packageId: query.packageId,
    packageRevision: 'revision-one', materialRevision: null,
  };
  const submissions: string[] = [];
  let response: unknown = { type: 'collection_selection', selection: selected };
  const client = createRuntimeClient({
    commandId: () => 'select-once',
    execute: async raw => {
      const request: unknown = JSON.parse(raw);
      if (request && typeof request === 'object' && 'type' in request
        && request.type === 'create_collection_selection') {
        submissions.push(raw);
        if (submissions.length === 1) throw new Error('selection receipt lost');
      }
      return JSON.stringify(response);
    },
  });
  const command = client.prepareCollectionSelection({ kind: 'matching', query });

  // When the same admitted command is retried.
  await assert.rejects(client.createCollectionSelection(command), /selection receipt lost/);
  assert.deepEqual(await client.createCollectionSelection(command), selected);

  // Then identity is retained and page validation cannot accept a foreign or full corpus.
  assert.equal(submissions[0], submissions[1]);
  assert.deepEqual(await client.collectionSelection(selected.id), selected);
  response = { type: 'collection_selections', selections: [selected] };
  assert.deepEqual(await client.collectionSelections(), [selected]);
  response = { type: 'collection_selections', selections: Array.from({ length: 9 }, () => selected) };
  await assert.rejects(client.collectionSelections(), { code: 'protocol' });
  response = { type: 'collection_selection_page', id: selected.id, page: { items: [entry], next: null } };
  assert.deepEqual(await client.collectionSelectionPage(selected.id), { items: [entry], next: null });
  for (const invalid of [
    { type: 'collection_selection_page', id: 'foreign', page: { items: [entry], next: null } },
    { type: 'collection_selection_page', id: selected.id, page: { items: Array.from({ length: 65 }, () => entry), next: null } },
    { type: 'collection_selection_page', id: selected.id, page: { items: [{ ...entry, materialRevision: 2 }], next: null } },
  ]) {
    response = invalid;
    await assert.rejects(client.collectionSelectionPage(selected.id), { code: 'protocol' });
  }
  response = { type: 'collection_selection', selection: { ...selected, id: 'foreign' } };
  await assert.rejects(client.collectionSelection(selected.id), { code: 'protocol' });
  response = { type: 'collection_selection_released', id: 'foreign' };
  await assert.rejects(client.releaseCollectionSelection(selected.id), { code: 'protocol' });
  response = { type: 'collection_selection_released', id: selected.id };
  await client.releaseCollectionSelection(selected.id);
});

test('collection controls and reads bypass preparation and retain its replay identity', { timeout: 5000 }, async () => {
  // Given a native preparation held at the transport boundary.
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const submissions: string[] = [];
  let attempts = 0;
  const command = { packageId: 'org.example', commandId: 'prepare-once' };
  const progress = { command, phase: 'preparing', processed: 24, total: 100, message: null };
  const completed = { ...progress, phase: 'succeeded', processed: 100 };
  const client = createRuntimeClient({
    commandId: () => command.commandId,
    execute: async raw => {
      const request: unknown = JSON.parse(raw);
      if (!request || typeof request !== 'object' || !('type' in request))
        throw new Error('Malformed test transport request');
      switch (request.type) {
        case 'prepare_collection':
          submissions.push(raw);
          entered();
          await gate;
          if (attempts++ === 0) throw new Error('preparation receipt lost');
          return JSON.stringify({ type: 'collection_preparation', status: completed });
        case 'collection':
          return JSON.stringify({ type: 'collection', result: { state: 'preparing', processed: 24, total: 100 } });
        case 'collection_preparation_status':
        case 'cancel_collection_preparation':
          return JSON.stringify({ type: 'collection_preparation', status: progress });
        default: throw new Error('Unexpected test transport operation');
      }
    },
  });
  const prepared = client.prepareCollection(command.packageId);
  const pending = client.prepareCollectionCatalog(prepared);
  const lost = assert.rejects(pending, /preparation receipt lost/);
  await started;
  try {
    // When another surface reads progress or cancels the pending task.
    assert.deepEqual(await client.collection(query), { state: 'preparing', processed: 24, total: 100 });
    assert.deepEqual(await client.currentCollectionPreparation(), progress);
    assert.deepEqual(await client.collectionPreparationStatus(command.commandId), progress);
    assert.deepEqual(await client.cancelCollectionPreparation(command.commandId), progress);
  } finally {
    release();
  }
  await lost;
  // Then transport recovery resubmits the exact admitted command.
  assert.deepEqual(await client.prepareCollectionCatalog(prepared), completed);
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0], submissions[1]);
});

test('collection preparation rejects impossible progress and foreign receipts', async () => {
  const command = { packageId: 'org.example', commandId: 'expected' };
  const base = { command, phase: 'preparing', processed: 1, total: 2, message: null };
  for (const status of [
    { ...base, processed: 3 },
    { ...base, phase: 'succeeded' },
    { ...base, total: null },
    { ...base, command: { ...command, commandId: 'other' } },
  ]) {
    const client = createRuntimeClient({
      commandId: () => 'unused',
      execute: async () => JSON.stringify({ type: 'collection_preparation', status }),
    });
    await assert.rejects(client.collectionPreparationStatus(command.commandId), { code: 'protocol' });
  }
});

test('collection pages retain native counts and reject malformed or oversized rows', async () => {
  const item = {
    kind: 'target',
    target: {
      summary: { targetId: 'entry-1', headword: 'word', reading: null, summary: 'meaning', presentation: null },
      kind: 'org.example:lexeme', capabilities: ['org.example:meaning'], scopes: [], levels: [],
      extensions: { 'org.future:data': { schemaVersion: 2, value: 'preserved' } },
    },
    knowledge: [], materialCount: 0,
  };
  const page = {
    items: [item], count: 100, next: 'opaque-native-cursor', packageRevision: 'revision-one',
    knowledgeRevision: 0, materialRevision: 0,
  };
  const result = { state: 'ready', page };
  let response: unknown = { type: 'collection', result };
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => JSON.stringify(response),
  });
  assert.deepEqual(await client.collection(query), result);
  // Native admission bounds the encoded target, not the number of extension
  // fields. Valid future namespaced data must survive the transport unchanged.
  const extended = {
    ...item,
    target: { ...item.target, extensions: Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`org.future:field-${index}`, { value: index }]),
    ) },
  };
  const extendedResult = { state: 'ready', page: { ...page, items: [extended] } };
  response = { type: 'collection', result: extendedResult };
  assert.deepEqual(await client.collection(query), extendedResult);
  for (const invalid of [
    { ...page, items: Array.from({ length: 25 }, () => item) },
    { ...page, items: [{ ...item, target: { ...item.target, summary: { targetId: 'missing-fields' } } }] },
    { ...page, count: -1 },
    { ...page, count: 0 },
    { ...page, items: [{ ...item, target: { ...item.target, extensions: { unnamespaced: 1 } } }] },
    { ...page, items: [{ ...item, target: { ...item.target, extensions: { 'org.future:data': 'x'.repeat(16384) } } }] },
  ]) {
    response = { type: 'collection', result: { state: 'ready', page: invalid } };
    await assert.rejects(client.collection(query), { code: 'protocol' });
  }
});

test('language catalog metadata is optional but checked before the filter UI consumes it', async () => {
  const catalog = {
    capabilities: [{ id: 'org.example:meaning', label: 'Meaning' }],
    kinds: [{ id: 'org.example:lexeme', label: 'Lexeme', color: null, attribution: 'Fixture' }],
    scopes: [], levels: [{
      scaleId: 'org.example:course', level: 'stage-42', label: 'Stage 42', rank: 42, attribution: 'Fixture',
    }],
  };
  const description = {
    language: 'example', label: 'Example', annotationCapability: 'org.example:meaning',
    attribution: 'Fixture', capabilities: catalog.capabilities, catalog,
  };
  let response: unknown = { type: 'language', description };
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => JSON.stringify(response),
  });
  assert.deepEqual(await client.describeLanguage('org.example'), description);
  response = { type: 'language', description: { ...description, catalog: { ...catalog, scopes: false } } };
  await assert.rejects(client.describeLanguage('org.example'), { code: 'protocol' });
});
