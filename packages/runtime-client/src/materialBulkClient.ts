import type {
  MaterialBulkAction, MaterialBulkCommand, MaterialBulkStart, Request, Response,
} from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { isMaterialBulkResponse, isMaterialBulkStart } from './materialBulkProtocol';

function identity(command: MaterialBulkStart): readonly unknown[] {
  const prefix = [command.commandId, command.selectionId, command.action.kind];
  switch (command.action.kind) {
    case 'add': return [...prefix, command.action.distinct];
    case 'exclude': return [...prefix, command.action.excluded];
    case 'remove': return prefix;
    case 'edit': {
      const patch = command.action.patch;
      return [...prefix, patch.phrase, patch.reading, patch.meaning, patch.context, patch.notes, patch.examples];
    }
    default: {
      const unexpected: never = command.action;
      throw new RuntimeError('invalid_request', `Unsupported bulk action: ${String(unexpected)}`);
    }
  }
}
export function createMaterialBulkClient(execute: (request: Request) => Promise<Response>, commandId: () => string) {
  const malformed = () => new RuntimeError('protocol', 'Malformed or mismatched bulk management receipt.');
  async function read(command: MaterialBulkCommand) {
    // Admission is a long native call. Its status/cancel/recovery must not join
    // an action queue behind it, and source navigation cannot discard its intent.
    const response = await execute({ type: 'material_bulk', command });
    if (!isMaterialBulkResponse(response)) throw malformed();
    return response;
  }
  async function control(command: MaterialBulkCommand, expectedId: string) {
    const response = await read(command);
    if (response.type !== 'material_bulk_status' || response.status.command.commandId !== expectedId) throw malformed();
    return response.status;
  }
  return {
    prepareMaterialBulk(selectionId: string, action: MaterialBulkAction): MaterialBulkStart {
      const command = { commandId: commandId(), selectionId, action: structuredClone(action) };
      if (!isMaterialBulkStart(command)) throw new RuntimeError('invalid_request', 'Bulk edit or selection exceeds its bounds.');
      return command;
    },
    async startMaterialBulk(command: MaterialBulkStart) {
      if (!isMaterialBulkStart(command)) throw new RuntimeError('invalid_request', 'Bulk edit or selection exceeds its bounds.');
      const status = await control({ kind: 'start', command }, command.commandId);
      if (JSON.stringify(identity(status.command)) !== JSON.stringify(identity(command))) throw malformed();
      return status;
    },
    retryMaterialBulk(commandId: string) {
      return control({ kind: 'retry', commandId }, commandId);
    },
    materialBulkStatus(commandId: string) {
      return control({ kind: 'status', commandId }, commandId);
    },
    async cancelMaterialBulk(commandId: string) {
      const status = await control({ kind: 'cancel', commandId }, commandId);
      if (status.phase === 'running') throw malformed();
      return status;
    },
    async materialBulkJobs() {
      const response = await read({ kind: 'jobs' });
      if (response.type !== 'material_bulk_jobs') throw malformed();
      return response.jobs;
    },
    async materialBulkResults(commandId: string, after: string | null = null) {
      const response = await read({ kind: 'results', commandId, after });
      if (response.type !== 'material_bulk_page' || response.commandId !== commandId) throw malformed();
      return response.page;
    },
    async releaseMaterialBulk(commandId: string) {
      const status = await control({ kind: 'release', commandId }, commandId);
      if (status.resultsAvailable) throw malformed();
      return status;
    },
  };
}
