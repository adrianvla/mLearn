import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Material, MaterialContent, MaterialCreate, SourceAnchor, Response } from '@mlearn/contracts';
import { createRuntimeClient, RuntimeError } from '../src/client';
import { encodedBytes, isMaterialResponse, isSourceAnchor } from '../src/materialProtocol';

const anchor: SourceAnchor = { sourceId: 'source', contentRevision: 'media-revision', packageId: 'package', packageVersion: '1',
  text: ' e\u0301 日本語', locator: { kind: 'video', subtitleRevision: 'subtitles', cueIndex: 7, selectionStart: 5, selectionEnd: 14,
    positionMs: 1000, subtitleOffsetMs: -250, playbackRate: 1.25 } };
const content: MaterialContent = { packageId: 'package', targetId: 'target', packageRevision: 'a'.repeat(64),
  sense: { heading: 'noun', labels: ['package:category'], definitions: ['a meaning'], notes: [] },
  phrase: '日本語', reading: 'reading', meaning: 'meaning', context: anchor.text, notes: '', examples: [], source: anchor, attachments: [] };
const material: Material = { id: 'material', revision: 3, excluded: false, content, media: [] };
const saved = { type: 'material_written', outcome: { status: 'saved', material, reused: false, committedRevision: 1 } };
function gate() {
  let release: () => void = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function isProtocol(error: unknown) { return error instanceof RuntimeError && error.code === 'protocol'; }

test('Material removal retains its retry command and rejects unrelated receipts', async () => {
  // Given a lost removal receipt for a selected Material revision.
  let response: unknown = { type: 'material_removed', outcome: { id: material.id, committedRevision: 4 } };
  const submissions: string[] = [];
  const client = createRuntimeClient({
    commandId: () => 'remove-once',
    execute: async raw => {
      submissions.push(raw);
      if (submissions.length === 1) throw new Error('removal receipt lost');
      return JSON.stringify(response);
    },
  });
  const command = client.prepareMaterialRemoval(material);

  // When the admitted command is retried.
  await assert.rejects(client.removeMaterial(command), /removal receipt lost/);
  assert.deepEqual(await client.removeMaterial(command), { id: material.id, committedRevision: 4 });

  // Then replay identity and exact revision are preserved.
  assert.equal(submissions[0], submissions[1]);
  for (const outcome of [
    { id: 'foreign', committedRevision: 4 },
    { id: material.id, committedRevision: 3 },
    { id: material.id, committedRevision: 0 },
  ]) {
    response = { type: 'material_removed', outcome };
    await assert.rejects(client.removeMaterial(command), isProtocol);
  }
});

test('Material responses reject malformed nested values and invalid UTF-8 coordinates', () => {
  // Given valid native content with a replay receipt older than the current item.
  assert.equal(isMaterialResponse(saved), true);
  // When nested transport data is malformed.
  for (const value of [
    { ...saved, outcome: { ...saved.outcome, committedRevision: 4 } },
    { type: 'material', material: { ...material, content: { ...content, examples: Array(17).fill('example') } } },
    { type: 'material', material: { ...material, content: { ...content, notes: 'é'.repeat(16385) } } },
    { type: 'material', material: { ...material, content: { ...content, source: { ...anchor, locator: { ...anchor.locator, selectionStart: 6 } } } } },
    { type: 'material', material: { ...material, content: { ...content, attachments: [{ mediaId: 'missing', segment: null }] } } },
    { type: 'material', material: { ...material, content: { ...content, sense: { ...content.sense, definitions: [] } } } },
    { type: 'material_written', outcome: { status: 'duplicate', items: [] } },
    { type: 'material_captured', results: [{ state: 'saved', commandId: 'command', materialId: 'material', committedRevision: 0, reused: true }] },
    { type: 'material_eligibility', items: [{ target: { packageId: 'package', targetId: 'target' }, availability: { state: 'existing', materialId: 'material', excluded: 'no' } }] },
  ]) {
    // Then no generated Material type is admitted.
    assert.equal(isMaterialResponse(value), false);
  }
});

test('message source anchors retain conversation revision and original UTF-8 coordinates', () => {
  const message = { sourceId: 'conversation', contentRevision: 'message-revision',
    packageId: 'package', packageVersion: '1', text: '日本語',
    locator: { kind: 'message', conversationId: 'conversation', messageId: 'message',
      messageRevision: 2, contextStart: 0, selectionStart: 6, selectionEnd: 9 } };
  assert.equal(isSourceAnchor(message), true);
  for (const locator of [
    { ...message.locator, conversationId: 'another-conversation' },
    { ...message.locator, messageRevision: 0 },
    { ...message.locator, selectionStart: 7 },
    { ...message.locator, contextStart: 4294967295 },
  ]) {
    assert.equal(isSourceAnchor({ ...message, locator }), false);
  }
});

test('frozen message Return admits only the original conversation revision and text', async () => {
  const response = {
    type: 'conversation_material_source',
    conversation: { id: 'conversation', revision: 3, kind: 'thread', title: 'Saved source',
      purpose: '', packageId: 'package', participants: ['person'], discarded: true },
    message: { id: 'message', conversationId: 'conversation', sequence: 1, revision: 2,
      role: 'assistant', participantId: 'person', replyTo: null, text: '日本語',
      contentRevision: 'a'.repeat(64), createdAtMs: 1000, status: 'complete',
      generationId: 'generation', sources: [] },
    anchor: { sourceId: 'conversation', contentRevision: 'a'.repeat(64), packageId: 'package',
      packageVersion: '1', text: '日本語', locator: { kind: 'message',
        conversationId: 'conversation', messageId: 'message', messageRevision: 2,
        contextStart: 0, selectionStart: 6, selectionEnd: 9 } },
  } satisfies Response;
  const client = createRuntimeClient({ commandId: () => 'command', execute: async () => JSON.stringify(response) });
  assert.deepEqual(await client.returnMaterialSource('material'), response);
  for (const invalid of [
    { ...response, conversation: { ...response.conversation, id: 'unrelated' } },
    { ...response, message: { ...response.message, id: 'unrelated' } },
    { ...response, message: { ...response.message, revision: 3 } },
    { ...response, message: { ...response.message, text: '別の文' } },
    { ...response, message: { ...response.message, status: 'invalidated' } },
  ]) assert.equal(isMaterialResponse(invalid), false);
});

test('Material reads validate requested record cursor and target identities', async () => {
  // Given structurally valid responses for the wrong requested identities.
  const responses = [
    { type: 'material', material },
    { type: 'materials', page: { items: [material], next: 'wrong-cursor' } },
    { type: 'material_eligibility', items: [{ target: { packageId: 'package', targetId: 'other' }, availability: { state: 'eligible' } }] },
  ];
  const client = createRuntimeClient({ commandId: () => 'id', execute: async () => JSON.stringify(responses.shift()) });
  // When scoped requests receive another record/cursor/target.
  // Then each request fails at admission rather than publishing unrelated state.
  await assert.rejects(client.material('other'), isProtocol);
  await assert.rejects(client.materials({ after: null, query: '', sourceId: 'source', includeExcluded: true }), isProtocol);
  await assert.rejects(client.materialEligibility([{ packageId: 'package', targetId: 'target' }]), isProtocol);
});

test('prepared Material retries preserve durable intent after cancellation and lost receipts', { timeout: 5000 }, async () => {
  // Given a create receipt lost after the native commit.
  const admitted: string[] = [];
  const entered = gate(); const release = gate(); let attempts = 0;
  const client = createRuntimeClient({ commandId: () => 'create-once', execute: async raw => {
    admitted.push(raw);
    if (attempts++ === 0) { entered.release(); await release.promise; throw new Error('Receipt lost'); }
    return JSON.stringify(saved);
  } });
  const draft = structuredClone(content);
  const command = client.prepareMaterial(draft);
  draft.notes = 'An unrelated editor now changed.';
  const write = client.createMaterial(command);
  const rejected = assert.rejects(write, /Receipt lost/);
  await entered.promise;
  // When its source closes, the durable write is not cancelled or rewritten.
  try { await client.cancelSourceOpen(); } finally { release.release(); }
  await rejected;
  const outcome = await client.createMaterial(command);
  // Then replay uses the exact command and accepts the older receipt revision.
  assert.equal(admitted[0], admitted[1]);
  assert.equal(command.content.notes, '');
  assert.equal(outcome.status, 'saved');
  if (outcome.status === 'saved') assert.equal(outcome.committedRevision, 1);
});

test('obsolete queued Return is fenced while queued create edit and exclusion remain durable', { timeout: 5000 }, async () => {
  // Given a queue held by a confirmed position checkpoint.
  const entered = gate(); const release = gate(); const admitted: string[] = [];
  let id = 0;
  const client = createRuntimeClient({ commandId: () => `command-${id++}`, execute: async raw => {
    const request: unknown = JSON.parse(raw);
    assert.ok(request && typeof request === 'object' && 'type' in request && typeof request.type === 'string');
    admitted.push(request.type);
    switch (request.type) {
      case 'save_position': entered.release(); await release.promise; return JSON.stringify({ type: 'position_saved' });
      case 'create_material': return JSON.stringify(saved);
      case 'update_material': return JSON.stringify({ ...saved, outcome: { ...saved.outcome, material: { ...material, revision: 4 }, committedRevision: 4 } });
      case 'set_capture_exclusion': return JSON.stringify({ type: 'capture_exclusion_changed', item: {
        target: { packageId: 'package', targetId: 'target' }, availability: { state: 'excluded' } } });
      default: throw new Error('Obsolete Return reached the native transport');
    }
  } });
  const checkpoint = client.savePosition('source', 1000, 30000); await entered.promise;
  const obsolete = assert.rejects(client.returnMaterialSource('material'), { code: 'cancelled' });
  const create = client.createMaterial(client.prepareMaterial(content));
  const edit = client.updateMaterial(client.prepareMaterialEdit(material, content, false));
  const exclusion = client.setCaptureExclusion(client.prepareCaptureExclusion({ packageId: 'package', targetId: 'target' }, true));
  // When another source session opens before queued actions start.
  try { await client.beginSourceSession().ready; } finally { release.release(); }
  // Then only Return is discarded, and every durable action gets its receipt.
  await Promise.all([checkpoint, obsolete, create, edit, exclusion]);
  assert.deepEqual(admitted, ['save_position', 'create_material', 'update_material', 'set_capture_exclusion']);
});

test('bulk capture packs bounded groups and retries only failed command identities', async () => {
  // Given large authored entries and a single uncertain commit.
  let id = 0; let lost = true; const payloads: string[] = [];
  const client = createRuntimeClient({ commandId: () => `bulk-${id++}`, execute: async raw => {
    payloads.push(raw);
    const value: unknown = JSON.parse(raw);
    assert.ok(value && typeof value === 'object' && 'type' in value && value.type === 'capture_materials' && 'batch' in value);
    assert.ok(value.batch && typeof value.batch === 'object' && 'commands' in value.batch && Array.isArray(value.batch.commands));
    const results = value.batch.commands.map((command: unknown) => {
      assert.ok(command && typeof command === 'object' && 'commandId' in command && typeof command.commandId === 'string');
      if (lost) { lost = false; return { state: 'failed', commandId: command.commandId, message: 'Receipt lost' }; }
      return { state: 'saved', commandId: command.commandId, materialId: `material-${command.commandId}`, committedRevision: 1, reused: false };
    });
    return JSON.stringify({ type: 'material_captured', results });
  } });
  const commands = Array.from({ length: 18 }, () => client.prepareMaterial({ ...content, notes: 'n'.repeat(30000) }));
  // When a user captures a view and retries its failed entries.
  const results = await client.captureMaterials({ packageId: 'package', commands });
  const failed = new Set(results.filter(item => item.state === 'failed').map(item => item.commandId));
  const retry: MaterialCreate[] = commands.filter(command => failed.has(command.commandId));
  const recovered = await client.captureMaterials({ packageId: 'package', commands: retry });
  // Then every wire group fits the byte/count budget and keeps the original ID.
  assert.equal(results.length, 18); assert.equal(retry.length, 1);
  assert.equal(recovered[0].commandId, commands[0].commandId);
  for (const raw of payloads) {
    assert.ok(encodedBytes(JSON.parse(raw)) <= 131072);
    assert.ok(JSON.parse(raw).batch.commands.length <= 16);
  }
});

test('capture rejects mismatched compact result identities without reporting saves', async () => {
  // Given a native result belonging to a different command.
  const client = createRuntimeClient({ commandId: () => 'expected', execute: async () => JSON.stringify({
    type: 'material_captured', results: [{ state: 'saved', commandId: 'other', materialId: 'material', committedRevision: 1, reused: false }] }) });
  // When the admitted command receives it.
  const results = await client.captureMaterials({ packageId: 'package', commands: [client.prepareMaterial(content)] });
  // Then the original entry remains failed and retryable.
  assert.equal(results[0].state, 'failed'); assert.equal(results[0].commandId, 'expected');
});

test('duplicate decisions create a new distinct intent without changing retry content', async () => {
  // Given a capture with another saved context for the same target and sense.
  let next = 0;
  const submitted: string[] = [];
  const client = createRuntimeClient({ commandId: () => `intent-${next++}`, execute: async raw => {
    submitted.push(raw);
    return JSON.stringify({ type: 'material_written', outcome: { status: 'duplicate', items: [material] } });
  } });
  const command = client.prepareMaterial(content);
  // When a duplicate is shown and the user deliberately chooses distinct.
  const result = await client.createMaterial(command);
  const distinct = client.prepareMaterial(command.content, true);
  // Then duplicate is not reported as saved, and only explicit distinct gets a new ID.
  assert.equal(result.status, 'duplicate');
  assert.notEqual(distinct.commandId, command.commandId);
  assert.equal(distinct.distinct, true);
  assert.deepEqual(distinct.content, command.content);
  assert.equal(submitted.length, 1);
});

test('source return validates exact source language revision and playback clock', async () => {
  // Given a native source restoration with an unrelated current language.
  const source = { id: 'source', title: 'video', mediaPath: 'video.mp4', mediaRevision: anchor.contentRevision,
    packageId: 'other-package', packageVersion: '1', subtitlePath: 'captions.srt', subtitleRevision: 'subtitles',
    positionMs: 1000, durationMs: 10000, subtitleOffsetMs: -250, subtitleOffsetRevision: 1, playbackRate: 1.25, inspectionTrigger: 'click' };
  const response = { type: 'material_source', window: { source, cues: [], totalCues: 8 }, anchor };
  const client = createRuntimeClient({ commandId: () => 'id', execute: async () => JSON.stringify(response) });
  // When Return tries to publish that inconsistent restoration.
  // Then it fails instead of substituting the global/current language.
  await assert.rejects(client.returnMaterialSource('material'), isProtocol);
  response.window.source.packageId = 'package';
  assert.deepEqual((await client.returnMaterialSource('material')).anchor, anchor);
});

test('saved frame media accepts a source without subtitle selection', () => {
  const source: SourceAnchor = { ...anchor, text: '', locator: { ...anchor.locator,
    subtitleRevision: null, cueIndex: null, selectionStart: 0, selectionEnd: 0 } };
  const frame: Material = { ...material, content: { ...content, source, phrase: '', sense: null,
    targetId: null, packageRevision: null, attachments: [{ mediaId: 'frame', segment: null }] },
    media: [{ id: 'frame', kind: 'image', name: 'frame.png', mimeType: 'image/png', byteLength: 123 }] };
  assert.equal(isMaterialResponse({ type: 'material', material: frame }), true);
});

test('instant media origins are valid for images but not empty audio or video clips', () => {
  for (const kind of ['image', 'audio', 'video'] as const) {
    const frame: Material = { ...material, content: { ...content, attachments: [{ mediaId: 'frame', segment: {
      sourceId: anchor.sourceId, contentRevision: anchor.contentRevision, startMs: 1000, endMs: 1000 } }] },
      media: [{ id: 'frame', kind, name: 'frame',
        mimeType: kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/wav' : 'video/mp4', byteLength: 123 }] };
    assert.equal(isMaterialResponse({ type: 'material', material: frame }), kind === 'image');
  }
});

test('authored target language remains distinct from original source language', () => {
  const authored: Material = { ...material, content: { ...content, packageId: 'another-target-package' } };
  assert.equal(isMaterialResponse({ type: 'material', material: authored }), true);
});

test('audio binding preserves explicit target snapshots and rejects changed or nonaudio content', () => {
  // Given historical authored audio without a listening assertion.
  const audio: Material = { ...material, content: { ...content,
    attachments: [{ mediaId: 'audio', segment: null }] },
    media: [{ id: 'audio', kind: 'audio', name: 'word.wav', mimeType: 'audio/wav', byteLength: 128 }] };
  assert.equal(isMaterialResponse({ type: 'material', material: audio }), true);
  const binding = { packageId: content.packageId, targetId: content.targetId, phrase: content.phrase };
  const bound = { ...audio, content: { ...audio.content, attachments: [
    { mediaId: 'audio', segment: null, audioBinding: binding },
  ] } };
  // When an explicit assertion is transported, then only its exact audio target is admitted.
  assert.equal(isMaterialResponse({ type: 'material', material: bound }), true);
  for (const changed of [
    { ...bound, content: { ...bound.content, phrase: 'Changed phrase' } },
    { ...bound, content: { ...bound.content, targetId: 'other-target' } },
    { ...bound, content: { ...bound.content, packageId: 'other-package' } },
    { ...bound, media: [{ ...audio.media[0], kind: 'image' }] },
    { ...bound, content: { ...bound.content, attachments: [
      { mediaId: 'audio', segment: null, audioBinding: { ...binding, phrase: '' } },
    ] } },
  ]) assert.equal(isMaterialResponse({ type: 'material', material: changed }), false);
});

test('source return retains the admitted package version after an installed package update', () => {
  // Given a historical source anchor and the current installed language version.
  const source = { id: anchor.sourceId, title: 'video', mediaPath: 'video.mp4', mediaRevision: anchor.contentRevision,
    packageId: anchor.packageId, packageVersion: '2', subtitlePath: 'captions.srt', subtitleRevision: 'subtitles',
    positionMs: 1000, durationMs: 10000, subtitleOffsetMs: -250, subtitleOffsetRevision: 1,
    playbackRate: 1.25, inspectionTrigger: 'click' };
  const response = { type: 'material_source', window: { source, cues: [], totalCues: 8 }, anchor };
  // When source restoration crosses the client boundary, then frozen provenance is not rewritten.
  assert.equal(isMaterialResponse(response), true);
  assert.equal(response.anchor.packageVersion, '1');
  assert.equal(response.window.source.packageVersion, '2');
});

test('manual authoring retains copied sense data after unlinking its target', () => {
  const authored: Material = { ...material, content: { ...content, targetId: null } };
  assert.equal(isMaterialResponse({ type: 'material', material: authored }), true);
});
