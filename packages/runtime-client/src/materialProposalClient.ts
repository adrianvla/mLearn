import type {
  MaterialContent, MaterialProposal, MaterialProposalAcceptance, MaterialProposalDecision,
  MaterialProposalQuery, MaterialProposalReceipt, MaterialProposalReview, MaterialReference,
  MaterialSuggestion, Request, Response,
  MaterialGenerationBasis, MaterialGenerationStart, MaterialGenerationReport,
} from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { encodedBytes, isMaterialContent, isMaterialResponse, isSourceAnchor } from './materialProtocol';
import { isConversationGeneration, isConversationResponse } from './conversationProtocol';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const text = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= max;
const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 4294967295;
function proposal(value: unknown): value is MaterialProposal {
  if (!object(value) || !text(value.id, 128) || !revision(value.revision)
    || !isMaterialContent(value.content) || value.content.attachments.length !== 0
    || !(value.generationId === null || text(value.generationId))
    || !(value.replaces === null || object(value.replaces) && text(value.replaces.id) && revision(value.replaces.revision))
    || value.content.source === null && value.replaces === null
    || value.replaces === null && value.content.source !== null && value.content.source.packageId !== value.content.packageId
    || !object(value.state)) return false;
  switch (value.state.state) {
    case 'pending': case 'rejected': return true;
    case 'accepted': return text(value.state.materialId) && revision(value.state.committedRevision);
    default: return false;
  }
}
function acceptance(value: unknown): value is MaterialProposalAcceptance {
  if (!object(value)) return false;
  switch (value.state) {
    case 'saved': return text(value.materialId) && revision(value.committedRevision) && typeof value.reused === 'boolean';
    case 'duplicate': return Array.isArray(value.materialIds) && value.materialIds.length > 0
      && value.materialIds.length <= 3 && value.materialIds.every(id => text(id))
      && new Set(value.materialIds).size === value.materialIds.length;
    default: return false;
  }
}
function receipt(value: unknown): value is MaterialProposalReceipt {
  if (!object(value) || !text(value.commandId, 128) || !proposal(value.proposal)
    || !revision(value.committedRevision) || value.committedRevision > value.proposal.revision
    || !(value.acceptance === null || acceptance(value.acceptance))) return false;
  if (value.acceptance?.state === 'saved') {
    const state = value.proposal.state;
    return state.state === 'accepted' && state.materialId === value.acceptance.materialId
      && state.committedRevision === value.acceptance.committedRevision;
  }
  return true;
}
function basis(value: MaterialContent) {
  const source = value.source;
  const sense = value.sense;
  return JSON.stringify([value.packageId, value.targetId, value.packageRevision,
    sense === null ? null : [sense.heading, sense.labels, sense.definitions, sense.notes],
    source === null ? null : [source.sourceId, source.contentRevision, source.packageId, source.packageVersion,
      source.text, Object.entries(source.locator).sort(([a], [b]) => a.localeCompare(b))],
  ]);
}
function generationReport(value: unknown): value is MaterialGenerationReport {
  return object(value) && text(value.commandId, 128) && isConversationGeneration(value.generation)
    && text(value.label, 2048) && typeof value.maximum === 'number' && Number.isInteger(value.maximum)
    && value.maximum >= 1 && value.maximum <= 8 && typeof value.collected === 'boolean'
    && Array.isArray(value.proposalIds) && value.proposalIds.length <= value.maximum
    && value.proposalIds.every(id => text(id, 128)) && new Set(value.proposalIds).size === value.proposalIds.length
    && Array.isArray(value.errors) && value.errors.length <= value.maximum + 1
    && value.errors.every(error => text(error, 1200))
    && (value.collected || value.proposalIds.length === 0 && value.errors.length === 0);
}
type ProposalResponse = Extract<Response, { type: 'material_proposals' | 'material_proposal' | 'material_proposal_reviewed'
  | 'material_generation' | 'material_generations' }>;
function response(value: unknown): value is ProposalResponse {
  if (!object(value)) return false;
  switch (value.type) {
    case 'material_proposal': return proposal(value.proposal);
    case 'material_proposal_reviewed': return receipt(value.receipt);
    case 'material_generation': return generationReport(value.report);
    case 'material_generations':
      return object(value.page) && Array.isArray(value.page.items) && value.page.items.length <= 12
        && value.page.items.every(generationReport) && (value.page.next === null || text(value.page.next, 128))
        && encodedBytes(value.page.items) <= 196608;
    case 'material_proposals':
      return object(value.page) && Array.isArray(value.page.items) && value.page.items.length <= 12
        && value.page.items.every(proposal) && (value.page.next === null || text(value.page.next, 128))
        && encodedBytes(value.page.items) <= 196608;
    default: return false;
  }
}

export function createMaterialProposalClient(request: (command: Request) => Promise<unknown>, commandId: () => string,
  control: (command: Request) => Promise<unknown> = request) {
  const malformed = () => new RuntimeError('protocol', 'Malformed or mismatched Material proposal response.');
  async function read(command: Request) {
    const execute = command.type === 'material_generation' || command.type === 'material_generations'
      || command.type === 'collect_material_generation' ? control : request;
    const value = await execute(command);
    if (!response(value)) throw malformed();
    return value;
  }
  return {
    prepareMaterialGeneration(basis: MaterialGenerationBasis, instruction: string, maximum = 4): MaterialGenerationStart {
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 8
        || new TextEncoder().encode(instruction).length > 2048
        || (basis.kind === 'source' ? !isSourceAnchor(basis.source) : !text(basis.material.id) || !revision(basis.material.revision)))
        throw new RuntimeError('invalid_request', 'Choose source text or existing Material and request 1–8 proposals.');
      return { commandId: commandId(), basis: structuredClone(basis), instruction, maximum };
    },
    async generateMaterial(command: MaterialGenerationStart) {
      const r = await control({ type: 'conversation', command: { action: 'generate_material', command: structuredClone(command) } });
      if (!isConversationResponse(r) || r.result.kind !== 'generation' || r.result.generation.retryOf !== null) throw malformed();
      const started = r.result.generation;
      const status = await read({ type: 'material_generation', id: started.id });
      if (status.type !== 'material_generation' || status.report.commandId !== command.commandId
        || status.report.maximum !== command.maximum || status.report.generation.id !== started.id
        || status.report.generation.conversationId !== started.conversationId) throw malformed();
      return status.report;
    },
    async materialGeneration(id: string) {
      const r = await read({ type: 'material_generation', id });
      if (r.type !== 'material_generation' || r.report.generation.id !== id) throw malformed();
      return r.report;
    },
    async materialGenerations(after: string | null = null) {
      const r = await read({ type: 'material_generations', after });
      if (r.type !== 'material_generations'
        || r.page.items.some((item, index) => item.generation.id <= (index === 0 ? after ?? '' : r.page.items[index - 1].generation.id))
        || r.page.next !== null && r.page.next !== r.page.items.at(-1)?.generation.id) throw malformed();
      return r.page;
    },
    async collectMaterialGeneration(id: string) {
      const r = await read({ type: 'collect_material_generation', id });
      if (r.type !== 'material_generation' || r.report.generation.id !== id || !r.report.collected) throw malformed();
      return r.report;
    },
    async materialProposals(query: MaterialProposalQuery) {
      const r = await read({ type: 'material_proposals', query });
      if (r.type !== 'material_proposals'
        || r.page.items.some((item, index) => query.packageId !== null && item.content.packageId !== query.packageId
          || query.pendingOnly && item.state.state !== 'pending'
          || item.id <= (index === 0 ? query.after ?? '' : r.page.items[index - 1].id))
        || r.page.next !== null && r.page.next !== r.page.items.at(-1)?.id) throw malformed();
      return r.page;
    },
    async materialProposal(id: string) {
      const r = await read({ type: 'material_proposal', id });
      if (r.type !== 'material_proposal' || r.proposal.id !== id) throw malformed();
      return r.proposal;
    },
    prepareMaterialSuggestion(content: MaterialContent, replaces: MaterialReference | null = null): MaterialSuggestion {
      if (!isMaterialContent(content) || content.attachments.length !== 0 || content.source === null && replaces === null)
        throw new RuntimeError('invalid_request', 'Choose source text or existing Material for a text proposal.');
      return { commandId: commandId(), content: structuredClone(content), replaces: structuredClone(replaces) };
    },
    async suggestMaterial(command: MaterialSuggestion) {
      const r = await read({ type: 'suggest_material', command });
      if (r.type !== 'material_proposal_reviewed' || r.receipt.commandId !== command.commandId
        || r.receipt.committedRevision !== 1 || r.receipt.proposal.generationId !== null
        || basis(r.receipt.proposal.content) !== basis(command.content)
        || r.receipt.proposal.replaces?.id !== command.replaces?.id
        || r.receipt.proposal.replaces?.revision !== command.replaces?.revision
        || r.receipt.acceptance !== null) throw malformed();
      return r.receipt;
    },
    prepareMaterialProposalReview(item: MaterialProposal, decision: MaterialProposalDecision): MaterialProposalReview {
      return { commandId: commandId(), id: item.id, expectedRevision: item.revision, decision: structuredClone(decision) };
    },
    async reviewMaterialProposal(command: MaterialProposalReview) {
      const r = await read({ type: 'review_material_proposal', command });
      if (r.type !== 'material_proposal_reviewed' || r.receipt.commandId !== command.commandId
        || r.receipt.proposal.id !== command.id || r.receipt.committedRevision !== command.expectedRevision + 1
        || (command.decision.kind === 'accept' ? r.receipt.acceptance === null : r.receipt.acceptance !== null)) throw malformed();
      return r.receipt;
    },
    async returnMaterialProposalSource(id: string) {
      const r = await request({ type: 'return_material_proposal_source', id });
      if (!isMaterialResponse(r) || r.type !== 'material_source' && r.type !== 'document_material_source'
        && r.type !== 'image_material_source' && r.type !== 'conversation_material_source') throw malformed();
      return r;
    },
  };
}
