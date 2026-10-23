import type { DocumentRecord, ImageReaderSettings, OcrCorrection, OcrPage, OcrProvider, OcrRect, OcrRegion, OcrRequest, Request } from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { isDocumentResponse } from './documentProtocol';
import { isImageResponse, isImageReaderSettings, isOcrRect } from './ocrProtocol';

export function createOcrClient(request: (command: Request) => Promise<unknown>, commandId: () => string) {
  const malformed = () => new RuntimeError('protocol', 'Malformed or mismatched image-source response.');
  async function read(command: Request) {
    const value = await request(command);
    if (!isImageResponse(value)) throw malformed();
    return value;
  }
  return {
    async importImages(paths: string[], title: string, packageId: string) {
      const value = await request({ type: 'import_image_collection', paths: [...paths], title, packageId });
      if (!isDocumentResponse(value) || value.type !== 'document' || value.window.source.format !== 'images'
        || value.window.source.packageId !== packageId) throw malformed();
      return value.window;
    },
    async imagePage(sourceId: string, pageIndex: number) {
      const value = await read({ type: 'image_page', sourceId, pageIndex });
      if (value.type !== 'image_page' || value.page.sourceId !== sourceId || value.page.pageIndex !== pageIndex) throw malformed();
      return value.page;
    },
    async imageReaderSettings(sourceId: string) {
      const value = await read({ type: 'image_reader_settings', sourceId });
      if (value.type !== 'image_reader_settings' || value.sourceId !== sourceId) throw malformed();
      return value.settings;
    },
    async saveImageReaderSettings(sourceId: string, settings: ImageReaderSettings) {
      if (!isImageReaderSettings(settings)) throw new RuntimeError('invalid_request', 'Invalid image view settings.');
      const value = await read({ type: 'save_image_reader_settings', sourceId, settings: { ...settings } });
      if (value.type !== 'image_reader_settings' || value.sourceId !== sourceId) throw malformed();
      return value.settings;
    },
    prepareOcr(source: DocumentRecord, resourceId: string, provider: OcrProvider,
      recognitionLanguages: string[], crop: OcrRect | null): OcrRequest {
      if (provider.availability !== 'ready' || recognitionLanguages.some(language => !provider.languages.includes(language))
        || crop !== null && !isOcrRect(crop))
        throw new RuntimeError('invalid_request', 'Select an available recognition provider and supported language.');
      return { requestId: commandId(), sourceId: source.id, contentRevision: source.contentRevision,
        resourceId, providerId: provider.id, recognitionLanguages: [...recognitionLanguages], crop: crop ? { ...crop } : null };
    },
    async readOcr(sourceId: string, resourceId: string, ocrRevision: number | null = null) {
      const value = await read({ type: 'read_ocr', sourceId, resourceId, ocrRevision });
      if (value.type !== 'ocr_cached' || value.page && (value.page.sourceId !== sourceId || value.page.resourceId !== resourceId
        || ocrRevision !== null && value.page.ocrRevision !== ocrRevision)) throw malformed();
      return value.page;
    },
    async ocrRecovery(action: OcrRequest) {
      const value = await read({ type: 'ocr_recovery', request: structuredClone(action) });
      if (value.type !== 'ocr_recovery' || value.recovery.state === 'completed'
        && (value.recovery.page.sourceId !== action.sourceId || value.recovery.page.resourceId !== action.resourceId
          || value.recovery.page.contentRevision !== action.contentRevision || value.recovery.page.provider.id !== action.providerId))
        throw malformed();
      return value.recovery;
    },
    async ocrEvidence(sourceId: string, resourceId: string, ocrRevision: number) {
      const value = await read({ type: 'ocr_evidence', sourceId, resourceId, ocrRevision });
      if (value.type !== 'ocr_evidence' || value.evidence.sourceId !== sourceId
        || value.evidence.resourceId !== resourceId || value.evidence.ocrRevision !== ocrRevision) throw malformed();
      return value.evidence;
    },
    prepareOcrCorrection(page: OcrPage, region: OcrRegion): OcrCorrection {
      return { commandId: commandId(), sourceId: page.sourceId, contentRevision: page.contentRevision,
        resourceId: page.resourceId, expectedRevision: page.ocrRevision, region: structuredClone(region) };
    },
    async correctOcr(correction: OcrCorrection) {
      const value = await read({ type: 'correct_ocr', correction: structuredClone(correction) });
      if (value.type !== 'ocr_page' || value.page.sourceId !== correction.sourceId
        || value.page.resourceId !== correction.resourceId || value.page.contentRevision !== correction.contentRevision
        || value.page.ocrRevision <= correction.expectedRevision) throw malformed();
      return value.page;
    },
    async postprocessOcr(page: OcrPage) {
      const value = await read({ type: 'postprocess_ocr', sourceId: page.sourceId, resourceId: page.resourceId, ocrRevision: page.ocrRevision });
      if (value.type !== 'ocr_page' || value.page.sourceId !== page.sourceId
        || value.page.resourceId !== page.resourceId || value.page.contentRevision !== page.contentRevision) throw malformed();
      return value.page;
    },
    async analyzeOcr(page: OcrPage, regionIds: string[]) {
      const value = await read({ type: 'analyze_ocr', sourceId: page.sourceId, resourceId: page.resourceId,
        ocrRevision: page.ocrRevision, regionIds: [...regionIds] });
      if (value.type !== 'ocr_analysis' || value.batch.sourceId !== page.sourceId
        || value.batch.resourceId !== page.resourceId || value.batch.ocrRevision !== page.ocrRevision
        || value.batch.contentRevision !== page.contentRevision || value.batch.regions.length !== regionIds.length
        || value.batch.regions.some((item, index) => item.regionId !== regionIds[index]
          || item.text !== page.regions.find(region => region.id === item.regionId)?.text)) throw malformed();
      return value.batch;
    },
  };
}
