import type { DocumentCheckpoint, DocumentPosition, Request } from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { isDocumentAppearance, isDocumentPosition, isDocumentResponse } from './documentProtocol';

export function createDocumentClient(request: (command: Request) => Promise<unknown>) {
  const malformed = () => new RuntimeError('protocol', 'Malformed or mismatched document response.');
  async function read(command: Request) {
    const response = await request(command);
    if (!isDocumentResponse(response)) throw malformed();
    return response;
  }
  async function window(command: Request, sourceId: string) {
    const response = await read(command);
    if (response.type !== 'document' || response.window.source.id !== sourceId) throw malformed();
    return response.window;
  }
  return {
    async openDocument(path: string, packageId: string) {
      const response = await read({ type: 'open_document', path, packageId });
      if (response.type !== 'document' || response.window.source.packageId !== packageId) throw malformed();
      return response.window;
    },
    async recentDocuments() {
      const response = await read({ type: 'recent_documents' });
      if (response.type !== 'documents' || new Set(response.sources.map(source => source.id)).size !== response.sources.length) throw malformed();
      return response.sources;
    },
    resumeDocument: (sourceId: string) => window({ type: 'resume_document', sourceId }, sourceId),
    async documentWindow(sourceId: string, position: DocumentPosition | null) {
      const result = await window({ type: 'document_window', sourceId, position }, sourceId);
      if (position && (result.source.parserRevision !== position.parserRevision
        || result.blocks[0]?.resource !== position.resource || result.blocks[0]?.id !== position.blockId)) throw malformed();
      return result;
    },
    async documentContents(sourceId: string, after: number | null = null) {
      const response = await read({ type: 'document_contents', sourceId, after });
      if (response.type !== 'document_contents' || response.page.sourceId !== sourceId
        || response.page.nextOffset !== null && after !== null && response.page.nextOffset <= after) throw malformed();
      return response.page;
    },
    async checkpointDocument(checkpoint: DocumentCheckpoint) {
      if (!isDocumentPosition(checkpoint.position) || !isDocumentAppearance(checkpoint.appearance))
        throw new RuntimeError('invalid_request', 'Invalid Reader position or appearance.');
      const snapshot = structuredClone(checkpoint);
      const result = await window({ type: 'checkpoint_document', checkpoint: snapshot }, snapshot.sourceId);
      const position = result.source.position;
      const appearance = result.source.appearance;
      if (result.source.contentRevision !== snapshot.contentRevision || !position
        || position.parserRevision !== snapshot.position.parserRevision || position.resource !== snapshot.position.resource
        || position.blockId !== snapshot.position.blockId || position.offset !== snapshot.position.offset
        || appearance.writingMode !== snapshot.appearance.writingMode || appearance.font !== snapshot.appearance.font
        || appearance.fontSize !== snapshot.appearance.fontSize || appearance.lineHeight !== snapshot.appearance.lineHeight
        || appearance.letterSpacing !== snapshot.appearance.letterSpacing) throw malformed();
      return result;
    },
    async setDocumentLanguage(sourceId: string, packageId: string) {
      const result = await window({ type: 'set_document_language', sourceId, packageId }, sourceId);
      if (result.source.packageId !== packageId) throw malformed();
      return result;
    },
    async analyzeDocument(sourceId: string, position: DocumentPosition | null) {
      const response = await read({ type: 'analyze_document', sourceId, position });
      if (response.type !== 'document_analysis' || response.batch.sourceId !== sourceId
        || position && response.batch.parserRevision !== position.parserRevision) throw malformed();
      return response.batch;
    },
    async documentResource(sourceId: string, resourceId: string) {
      const response = await read({ type: 'document_resource', sourceId, resourceId });
      if (response.type !== 'document_resource' || response.location.sourceId !== sourceId
        || response.location.resourceId !== resourceId) throw malformed();
      return response.location;
    },
  };
}
