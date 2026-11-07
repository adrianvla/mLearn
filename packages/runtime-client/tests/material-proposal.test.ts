import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MaterialContent, MaterialProposal, MaterialProposalReceipt } from '@mlearn/contracts';
import { createRuntimeClient } from '../src/client.ts';

const content: MaterialContent = {
  packageId: 'example.language', targetId: null, packageRevision: null, sense: null,
  phrase: 'authored phrase', reading: '', meaning: 'meaning', context: '', notes: '',
  examples: [], source: null, attachments: [],
};
const proposal: MaterialProposal = {
  id: 'proposal-one', revision: 1, content,
  replaces: { id: 'material-one', revision: 1 }, generationId: null, state: { state: 'pending' },
};
const receipt: MaterialProposalReceipt = {
  commandId: 'suggest-one', proposal, committedRevision: 1, acceptance: null,
};

test('lost proposal receipts retry the original draft rather than a changed local input', async () => {
  // Given a native suggestion whose first committed receipt is lost at transport.
  const submitted: string[] = [];
  const client = createRuntimeClient({
    commandId: () => 'suggest-one',
    execute: async raw => {
      submitted.push(raw);
      if (submitted.length === 1) throw new Error('Fixture lost receipt');
      return JSON.stringify({ type: 'material_proposal_reviewed', receipt });
    },
  });
  const draft = structuredClone(content);
  const command = client.prepareMaterialSuggestion(draft, { revision: 1, id: 'material-one' });
  await assert.rejects(client.suggestMaterial(command), /Fixture lost receipt/);
  // When the learner changes unrelated unsubmitted input and retries the same intent.
  draft.notes = 'not submitted';
  const recovered = await client.suggestMaterial(command);
  // Then transport preserves the command and accepts property-order-independent identity.
  assert.equal(submitted[0], submitted[1]);
  assert.equal(command.content.notes, '');
  assert.deepEqual(recovered, receipt);
});

test('proposal packets reject foreign receipts, invalid decisions and unbounded or broadened pages', async () => {
  // Given a client receiving unknown packets at the native boundary.
  let response: unknown = { type: 'material_proposal_reviewed', receipt };
  const client = createRuntimeClient({ commandId: () => 'suggest-one', execute: async () => JSON.stringify(response) });
  const command = client.prepareMaterialSuggestion(content, proposal.replaces);
  assert.deepEqual(await client.suggestMaterial(command), receipt);
  // When packet structure or its action/scope correlation is inconsistent.
  for (const invalid of [
    { ...receipt, commandId: 'foreign' },
    { ...receipt, committedRevision: 2 },
    { ...receipt, proposal: { ...proposal, generationId: 'unrequested-generation' } },
    { ...receipt, proposal: { ...proposal, content: { ...content, packageId: 'other.package' } } },
    { ...receipt, proposal: { ...proposal, replaces: { id: 'other-material', revision: 1 } } },
    { ...receipt, acceptance: { state: 'saved', materialId: 'material-one', committedRevision: 1, reused: false } },
  ]) {
    response = { type: 'material_proposal_reviewed', receipt: invalid };
    await assert.rejects(client.suggestMaterial(command), { code: 'protocol' });
  }
  const accept = client.prepareMaterialProposalReview(proposal, { kind: 'accept', distinct: false });
  for (const invalid of [
    { ...receipt, committedRevision: 2, proposal: { ...proposal, revision: 2 } },
    { ...receipt, proposal: { ...proposal, revision: 2 }, acceptance: { state: 'duplicate', materialIds: ['a', 'a'] } },
  ]) {
    response = { type: 'material_proposal_reviewed', receipt: invalid };
    await assert.rejects(client.reviewMaterialProposal(accept), { code: 'protocol' });
  }
  for (const items of [
    [proposal, proposal],
    Array.from({ length: 13 }, () => proposal),
    [{ ...proposal, content: { ...content, packageId: 'other.package' } }],
    [{ ...proposal, state: { state: 'rejected' } }],
  ]) {
    response = { type: 'material_proposals', page: { items, next: null } };
    await assert.rejects(client.materialProposals({ after: null, packageId: content.packageId, pendingOnly: true }), { code: 'protocol' });
  }
  // Then a matching accepted receipt remains usable without requiring the optional provider.
  const accepted: MaterialProposalReceipt = {
    commandId: accept.commandId, committedRevision: 2,
    proposal: { ...proposal, revision: 2, state: { state: 'accepted', materialId: 'material-one', committedRevision: 2 } },
    acceptance: { state: 'saved', materialId: 'material-one', committedRevision: 2, reused: false },
  };
  response = { type: 'material_proposal_reviewed', receipt: accepted };
  assert.deepEqual(await client.reviewMaterialProposal(accept), accepted);
});

test('replacement proposals retain the original source language independently of their authored target', async () => {
  // Given an existing Material replacement with source provenance in another package.
  const draft: MaterialContent = {
    ...content,
    source: {
      sourceId: 'document-one', contentRevision: 'content-v1', packageId: 'source.language',
      packageVersion: 'v1', text: 'text',
      locator: { kind: 'document', parserRevision: 'parser-v1', resource: 'text',
        blockId: 'block-one', contextStart: 0, selectionStart: 0, selectionEnd: 4 },
    },
  };
  const retained = { ...proposal, content: draft };
  const expected = { ...receipt, proposal: retained };
  const client = createRuntimeClient({
    commandId: () => 'suggest-one',
    execute: async () => JSON.stringify({ type: 'material_proposal_reviewed', receipt: expected }),
  });
  // When its suggestion receipt is admitted at the typed boundary.
  const result = await client.suggestMaterial(client.prepareMaterialSuggestion(draft, proposal.replaces));
  // Then it retains both identities without claiming they are the same language.
  assert.deepEqual(result.proposal.content.source, draft.source);
  assert.equal(result.proposal.content.packageId, content.packageId);
});
