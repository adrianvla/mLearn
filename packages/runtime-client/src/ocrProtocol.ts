import type { ImageReaderSettings, OcrPage, OcrProvider, OcrRect, Response } from '@mlearn/contracts';
import { isDocumentPosition } from './documentProtocol';
import { isAnalyzedToken, isKnowledgeProjection } from './watchProtocol';

const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum = 512): value is string =>
  typeof value === 'string' && value.length > 0 && !value.includes('\0')
  && encoder.encode(value).length <= maximum;
const uint = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
const nullableText = (value: unknown, maximum = 512) => value === null || text(value, maximum);
const strings = (value: unknown, maximum: number) =>
  Array.isArray(value) && value.length <= maximum && value.every(item => text(item));
const recognitionText = (value: unknown): value is string =>
  typeof value === 'string' && encoder.encode(value).length <= 32768;

export function isOcrProvider(value: unknown): value is OcrProvider {
  return object(value) && text(value.id) && text(value.label) && text(value.revision)
    && (value.availability === 'ready' || value.availability === 'unavailable')
    && strings(value.languages, 256) && strings(value.scripts, 64)
    && text(value.languageProvenance) && nullableText(value.reason, 4096);
}

export function isOcrRect(value: unknown): value is OcrRect {
  return object(value) && typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0
    && typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0
    && typeof value.width === 'number' && value.width > 0 && value.x + value.width <= 1
    && typeof value.height === 'number' && value.height > 0 && value.y + value.height <= 1;
}

function point(value: unknown) {
  return object(value) && typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y);
}
function quad(value: unknown) {
  return object(value) && point(value.topLeft) && point(value.topRight) && point(value.bottomRight) && point(value.bottomLeft);
}
function candidate(value: unknown) {
  return object(value) && recognitionText(value.text)
    && (value.confidence === null || typeof value.confidence === 'number'
      && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1);
}
function region(value: unknown) {
  return object(value) && text(value.id) && recognitionText(value.text) && quad(value.quad)
    && Array.isArray(value.candidates) && value.candidates.length <= 3 && value.candidates.every(candidate)
    && nullableText(value.language) && nullableText(value.orientation) && nullableText(value.readingOf)
    && (value.contextRegionIds === undefined || strings(value.contextRegionIds, 16));
}

function pageContent(value: Record<string, unknown>) {
  if (!isOcrProvider(value.provider)
    || !uint(value.width) || !value.width || !uint(value.height) || !value.height
    || !(value.crop === null || isOcrRect(value.crop))
    || !Array.isArray(value.regions) || value.regions.length > 512 || !value.regions.every(region)
    || encoder.encode(JSON.stringify(value)).length > 500000) return false;
  const ids = new Set<string>();
  let bytes = 0;
  for (const item of value.regions) {
    if (!object(item) || !text(item.id) || !recognitionText(item.text) || !Array.isArray(item.candidates) || ids.has(item.id)) return false;
    ids.add(item.id);
    bytes += encoder.encode(item.text).length;
    for (const alternative of item.candidates) {
      if (!object(alternative) || !recognitionText(alternative.text)) return false;
      bytes += encoder.encode(alternative.text).length;
    }
  }
  return bytes <= 32768 && value.regions.every(item => object(item)
    && (item.contextRegionIds === undefined || Array.isArray(item.contextRegionIds)
      && new Set(item.contextRegionIds).size === item.contextRegionIds.length
      && item.contextRegionIds.every(id => typeof id === 'string' && ids.has(id))));
}

/** Provider evidence is admitted before it reaches image gestures or lookup. */
export function isOcrPage(value: unknown): value is OcrPage {
  return object(value) && text(value.sourceId) && text(value.contentRevision) && text(value.resourceId)
    && uint(value.ocrRevision) && value.ocrRevision > 0 && pageContent(value);
}

type OcrResponse = Extract<Response, { type: 'ocr_page' }>;
export function isOcrResponse(value: unknown): value is OcrResponse {
  return object(value) && value.type === 'ocr_page' && isOcrPage(value.page);
}

export function isImageReaderSettings(value: unknown): value is ImageReaderSettings {
  return object(value) && typeof value.fit === 'string' && ['contain', 'width', 'height'].includes(value.fit)
    && (value.direction === 'ltr' || value.direction === 'rtl')
    && ['paired', 'firstPageSingle', 'collate', 'showOverlay', 'showAnnotations'].every(key => typeof value[key] === 'boolean');
}
function analyzedRegion(value: unknown) {
  if (!object(value) || !text(value.regionId) || !recognitionText(value.text)
    || !Array.isArray(value.tokens) || value.tokens.length > 4096 || !value.tokens.every(isAnalyzedToken)) return false;
  const bytes = encoder.encode(value.text);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let cursor = 0;
  for (const token of value.tokens) {
    if (token.start !== cursor || token.end > bytes.length
      || [token.start, token.end].some(offset => offset < bytes.length && (bytes[offset] & 0xc0) === 0x80)
      || decoder.decode(bytes.subarray(token.start, token.end)) !== token.text) return false;
    cursor = token.end;
  }
  return cursor === bytes.length;
}
function request(value: unknown) {
  return object(value) && text(value.requestId) && text(value.sourceId) && text(value.contentRevision)
    && text(value.resourceId) && text(value.providerId) && strings(value.recognitionLanguages, 32)
    && (value.crop === null || isOcrRect(value.crop));
}
function correction(value: unknown) {
  return object(value) && text(value.commandId, 128) && text(value.sourceId) && text(value.contentRevision)
    && text(value.resourceId) && uint(value.expectedRevision) && region(value.region);
}
type ImageResponse = Extract<Response, { type: 'image_page' | 'image_reader_settings'
  | 'ocr_page' | 'ocr_cached' | 'ocr_analysis' | 'ocr_evidence' | 'ocr_recovery' }>;
export function isImageResponse(value: unknown): value is ImageResponse {
  if (!object(value) || encoder.encode(JSON.stringify(value)).length > 500000) return false;
  switch (value.type) {
    case 'ocr_page': return isOcrPage(value.page);
    case 'ocr_cached': return value.page === null || isOcrPage(value.page);
    case 'ocr_recovery': {
      const recovery = value.recovery;
      return object(recovery) && (recovery.state === 'unknown' || recovery.state === 'pending'
        || recovery.state === 'cancelled' || recovery.state === 'completed' && isOcrPage(recovery.page));
    }
    case 'image_page': {
      const page = value.page;
      return object(page) && text(page.sourceId) && text(page.contentRevision) && text(page.resourceId)
        && uint(page.pageIndex) && isDocumentPosition(page.position);
    }
    case 'image_reader_settings': return text(value.sourceId) && isImageReaderSettings(value.settings);
    case 'ocr_analysis': {
      const batch = value.batch;
      if (!object(batch) || !['sourceId', 'contentRevision', 'resourceId', 'packageId', 'packageVersion', 'packageRevision']
        .every(key => text(batch[key])) || !uint(batch.ocrRevision) || !batch.ocrRevision
        || !Array.isArray(batch.regions) || batch.regions.length > 16 || !batch.regions.every(analyzedRegion)
        || !Array.isArray(batch.knowledge) || batch.knowledge.length > 256 || !batch.knowledge.every(isKnowledgeProjection)
        || !Array.isArray(batch.annotations) || batch.annotations.length > 4096) return false;
      let bytes = 0;
      for (const item of batch.regions) {
        if (!object(item) || !recognitionText(item.text)) return false;
        bytes += encoder.encode(item.text).length;
      }
      return bytes <= 4096 && batch.annotations.every(item => object(item)
        && text(item.regionId) && uint(item.tokenStart) && text(item.status));
    }
    case 'ocr_evidence': {
      const evidence = value.evidence;
      return object(evidence) && text(evidence.sourceId) && text(evidence.resourceId) && uint(evidence.ocrRevision)
        && (evidence.parentRevision === null || uint(evidence.parentRevision))
        && (evidence.request === null || request(evidence.request))
        && (evidence.result === null || object(evidence.result) && text(evidence.result.requestId) && pageContent(evidence.result))
        && (evidence.correction === null || correction(evidence.correction))
        && (evidence.package === null || object(evidence.package) && text(evidence.package.packageId)
          && text(evidence.package.packageVersion) && text(evidence.package.packageRevision));
    }
    default: return false;
  }
}
