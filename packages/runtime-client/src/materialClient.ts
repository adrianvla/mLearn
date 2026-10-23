import type { CaptureExclusion, Material, MaterialCaptureBatch, MaterialCaptureResult, MaterialContent,
  MaterialCreate, MaterialEdit, MaterialQuery, MaterialTarget, Request } from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { encodedBytes, isMaterialContent, isMaterialResponse } from './materialProtocol';

export function createMaterialClient(request: (command: Request) => Promise<unknown>, commandId: () => string) {
  const malformed = () => new RuntimeError('protocol', 'Malformed or mismatched Material response.');
  function content(value: MaterialContent) {
    if (!isMaterialContent(value)) throw new RuntimeError('invalid_request', 'Material content or source selection exceeds its bounds.');
  }
  async function read(command: Request) {
    const response = await request(command);
    if (!isMaterialResponse(response)) throw malformed();
    return response;
  }
  const sameTarget = (a: MaterialTarget, b: MaterialTarget) => a.packageId === b.packageId && a.targetId === b.targetId;
  return {
    async materials(query: MaterialQuery) {
      const r = await read({ type: 'materials', query });
      if (r.type !== 'materials' || new Set(r.page.items.map(item => item.id)).size !== r.page.items.length
        || r.page.items.some(item => query.after !== null && item.id <= query.after
          || !query.includeExcluded && item.excluded || query.sourceId !== null && item.content.source?.sourceId !== query.sourceId)
        || r.page.next !== null && r.page.next !== r.page.items.at(-1)?.id) throw malformed();
      return r.page;
    },
    async material(id: string) {
      const r = await read({ type: 'material', id });
      if (r.type !== 'material' || r.material.id !== id) throw malformed();
      return r.material;
    },
    prepareMaterial(value: MaterialContent, distinct = false): MaterialCreate {
      content(value);
      return { commandId: commandId(), content: structuredClone(value), distinct };
    },
    async createMaterial(command: MaterialCreate) {
      content(command.content);
      const r = await read({ type: 'create_material', command });
      if (r.type !== 'material_written' || (r.outcome.status === 'saved'
        ? r.outcome.material.content.packageId !== command.content.packageId
        : r.outcome.items.some(item => item.content.packageId !== command.content.packageId))) throw malformed();
      return r.outcome;
    },
    prepareMaterialEdit(material: Material, value: MaterialContent, excluded: boolean): MaterialEdit {
      content(value);
      return { commandId: commandId(), id: material.id, expectedRevision: material.revision, content: structuredClone(value), excluded };
    },
    async updateMaterial(command: MaterialEdit) {
      content(command.content);
      const r = await read({ type: 'update_material', command });
      if (r.type !== 'material_written' || r.outcome.status !== 'saved' || r.outcome.material.id !== command.id
        || r.outcome.committedRevision !== command.expectedRevision + 1) throw malformed();
      return r.outcome;
    },
    async captureMaterials(batch: MaterialCaptureBatch): Promise<MaterialCaptureResult[]> {
      if (new Set(batch.commands.map(command => command.commandId)).size !== batch.commands.length)
        throw new RuntimeError('invalid_request', 'Capture commands must have unique identities.');
      for (const command of batch.commands) {
        content(command.content);
        if (command.content.packageId !== batch.packageId) throw new RuntimeError('invalid_request', 'Capture language mismatch.');
      }
      const results: MaterialCaptureResult[] = [];
      // Every group uses the existing action queue. A lost group retains its
      // original command IDs; callers can retry failed entries, not successes.
      let offset = 0;
      while (offset < batch.commands.length) {
        const commands: MaterialCreate[] = [];
        while (offset < batch.commands.length && commands.length < 16) {
          const command = batch.commands[offset];
          const candidate: Request = { type: 'capture_materials', batch: { packageId: batch.packageId, commands: [...commands, command] } };
          if (encodedBytes(candidate) > 131072) break;
          commands.push(command); offset++;
        }
        if (!commands.length) throw new RuntimeError('invalid_request', 'Capture entry exceeds the request budget.');
        try {
          const r = await read({ type: 'capture_materials', batch: { packageId: batch.packageId, commands } });
          if (r.type !== 'material_captured' || r.results.length !== commands.length
            || r.results.some((result, index) => result.commandId !== commands[index].commandId)) throw malformed();
          results.push(...r.results);
        } catch (cause) {
          if (!(cause instanceof Error)) throw cause;
          results.push(...commands.map(command => ({ state: 'failed', commandId: command.commandId, message: cause.message } satisfies MaterialCaptureResult)));
        }
      }
      return results;
    },
    async materialEligibility(targets: MaterialTarget[]) {
      const r = await read({ type: 'material_eligibility', targets });
      if (r.type !== 'material_eligibility' || r.items.length !== targets.length
        || r.items.some((item, index) => !sameTarget(item.target, targets[index]))) throw malformed();
      return r.items;
    },
    prepareCaptureExclusion(target: MaterialTarget, excluded: boolean): CaptureExclusion {
      return { commandId: commandId(), target: { ...target }, excluded };
    },
    async setCaptureExclusion(command: CaptureExclusion) {
      const r = await read({ type: 'set_capture_exclusion', command });
      if (r.type !== 'capture_exclusion_changed' || !sameTarget(r.item.target, command.target)) throw malformed();
      return r.item;
    },
    async returnMaterialSource(id: string) {
      const r = await read({ type: 'return_material_source', id });
      if (r.type !== 'material_source' && r.type !== 'document_material_source') throw malformed();
      return r;
    },
  };
}
