import type {
  CollectionPreparationCommand, CollectionQuery, CollectionSelectionCreate,
  CollectionSelectionSource, Request, Response,
} from '@mlearn/contracts';
import { isCollectionResponse } from './collectionProtocol';
import { RuntimeError } from './errors';

type Execute = (request: Request) => Promise<Response>;

export function createCollectionClient(request: Execute, commandId: () => string, execute: Execute) {
  async function control(command: Request, expectedId: string | null) {
    // Task control must not join the display queue behind its own pending call.
    const response = await execute(command);
    if (!isCollectionResponse(response) || response.type !== 'collection_preparation')
      throw new RuntimeError('protocol', 'Malformed collection preparation status.');
    if (response.status !== null && expectedId !== null
      && response.status.command.commandId !== expectedId)
      throw new RuntimeError('protocol', 'Mismatched collection preparation identity.');
    return response.status;
  }
  return {
    prepareCollectionSelection(source: CollectionSelectionSource): CollectionSelectionCreate {
      return { source, commandId: commandId() };
    },
    async createCollectionSelection(command: CollectionSelectionCreate) {
      const response = await request({ type: 'create_collection_selection', command });
      if (!isCollectionResponse(response) || response.type !== 'collection_selection')
        throw new RuntimeError('protocol', 'Malformed frozen selection.');
      return response.selection;
    },
    async collectionSelection(id: string) {
      const response = await request({ type: 'collection_selection', id });
      if (!isCollectionResponse(response) || response.type !== 'collection_selection'
        || response.selection.id !== id)
        throw new RuntimeError('protocol', 'Mismatched frozen selection.');
      return response.selection;
    },
    async collectionSelections() {
      const response = await request({ type: 'collection_selections' });
      if (!isCollectionResponse(response) || response.type !== 'collection_selections')
        throw new RuntimeError('protocol', 'Malformed retained selections.');
      return response.selections;
    },
    async collectionSelectionPage(id: string, after: string | null = null) {
      const response = await request({ type: 'collection_selection_page', id, after });
      if (!isCollectionResponse(response) || response.type !== 'collection_selection_page'
        || response.id !== id)
        throw new RuntimeError('protocol', 'Malformed frozen selection page.');
      return response.page;
    },
    async releaseCollectionSelection(id: string) {
      const response = await request({ type: 'release_collection_selection', id });
      if (!isCollectionResponse(response) || response.type !== 'collection_selection_released'
        || response.id !== id)
        throw new RuntimeError('protocol', 'Mismatched selection release.');
    },
    async collection(query: CollectionQuery) {
      const response = await request({ type: 'collection', query });
      if (!isCollectionResponse(response) || response.type !== 'collection')
        throw new RuntimeError('protocol', 'Malformed bounded collection.');
      return response.result;
    },
    prepareCollection(packageId: string): CollectionPreparationCommand {
      return { packageId, commandId: commandId() };
    },
    async prepareCollectionCatalog(command: CollectionPreparationCommand) {
      const status = await control({ type: 'prepare_collection', command }, command.commandId);
      if (status === null || status.command.packageId !== command.packageId)
        throw new RuntimeError('protocol', 'Missing collection preparation receipt.');
      return status;
    },
    collectionPreparationStatus(commandId: string) {
      return control({ type: 'collection_preparation_status', commandId }, commandId);
    },
    currentCollectionPreparation() {
      return control({ type: 'collection_preparation_status', commandId: null }, null);
    },
    cancelCollectionPreparation(commandId: string) {
      return control({ type: 'cancel_collection_preparation', commandId }, commandId);
    },
  };
}
