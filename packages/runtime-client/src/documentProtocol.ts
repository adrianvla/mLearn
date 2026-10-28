import type { DocumentAppearance, DocumentPosition, DocumentRecord, DocumentSearchPage, DocumentWindow, Response } from '@mlearn/contracts';
import { isAnalyzedToken, isKnowledgeProjection } from './watchProtocol';
import { isSourceAnchor } from './sourceProtocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max = 512, required = true): value is string {
  return typeof value === 'string' && (!required || value.length > 0 && !value.includes('\0'))
    && encoder.encode(value).length <= max;
}
function uint(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
}
function list(value: unknown, max: number, guard: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length <= max && value.every(guard);
}
function boundary(bytes: Uint8Array, offset: number) {
  return offset <= bytes.length && (offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80);
}
const nullable = (value: unknown, guard: (item: unknown) => boolean) => value === null || guard(value);
export function isDocumentAppearance(value: unknown): value is DocumentAppearance {
  return object(value) && typeof value.writingMode === 'string' && ['auto', 'horizontal', 'vertical'].includes(value.writingMode)
    && typeof value.font === 'string' && ['source', 'serif', 'sans'].includes(value.font)
    && uint(value.fontSize) && value.fontSize >= 12 && value.fontSize <= 48
    && typeof value.lineHeight === 'number' && value.lineHeight >= 1 && value.lineHeight <= 2.5
    && typeof value.letterSpacing === 'number' && value.letterSpacing >= -1 && value.letterSpacing <= 4;
}
export function isDocumentPosition(value: unknown): value is DocumentPosition {
  return object(value) && text(value.parserRevision) && text(value.resource) && text(value.blockId) && uint(value.offset);
}
export function isDocumentRecord(value: unknown): value is DocumentRecord {
  return object(value) && text(value.id) && text(value.title, 4096) && text(value.documentPath, 4096)
    && text(value.contentRevision) && text(value.parserRevision) && text(value.packageId) && text(value.packageVersion)
    && typeof value.format === 'string' && ['text', 'epub', 'pdf', 'images'].includes(value.format) && uint(value.totalBlocks) && value.totalBlocks <= 1024
    && uint(value.totalPages) && value.totalPages <= 1024
    && (value.format === 'pdf' || value.format === 'images' ? value.totalPages > 0 : value.totalPages === 0)
    && nullable(value.position, isDocumentPosition)
    && (value.position === null || isDocumentPosition(value.position) && value.position.parserRevision === value.parserRevision)
    && isDocumentAppearance(value.appearance) && nullable(value.progression, text)
    && list(value.fidelity, 64, item => text(item)) && encoder.encode(JSON.stringify(value)).length <= 65536;
}
function block(value: unknown) {
  if (!object(value) || !text(value.resource) || !text(value.id) || !text(value.kind, 128)
    || !text(value.text, 65536, false) || !nullable(value.page, uint)
    || !nullable(value.writingMode, mode => typeof mode === 'string' && ['horizontal-tb', 'vertical-rl', 'vertical-lr'].includes(mode))
    || !nullable(value.image, image => object(image) && text(image.resourceId) && text(image.alt, 4096, false))) return false;
  const bytes = encoder.encode(value.text);
  return list(value.readings, 4096, reading => object(reading)
    && uint(reading.start) && uint(reading.end) && reading.start < reading.end
    && boundary(bytes, reading.start) && boundary(bytes, reading.end) && text(reading.text, 65536, false));
}
export function isDocumentWindow(value: unknown): value is DocumentWindow {
  if (!object(value) || !isDocumentRecord(value.source) || !list(value.blocks, 8, block)
    || !nullable(value.previous, isDocumentPosition) || !nullable(value.next, isDocumentPosition)
    || encoder.encode(JSON.stringify(value)).length > 500000) return false;
  const source = value.source;
  let payload = 0;
  const ids = new Set<string>();
  for (const item of value.blocks) {
    if (!object(item) || typeof item.text !== 'string' || !Array.isArray(item.readings)) return false;
    const id = JSON.stringify([item.resource, item.id]);
    if (ids.has(id) || (source.format === 'pdf' || source.format === 'images'
      ? !uint(item.page) || item.page >= source.totalPages : item.page !== null)) return false;
    ids.add(id);
    payload += encoder.encode(item.text).length;
    for (const reading of item.readings) {
      if (!object(reading) || typeof reading.text !== 'string') return false;
      payload += encoder.encode(reading.text).length;
    }
  }
  return payload <= 65536 && [value.previous, value.next].every(position =>
    position === null || isDocumentPosition(position) && position.parserRevision === source.parserRevision);
}
function analyzedBlock(value: unknown) {
  if (!object(value) || !text(value.resource) || !text(value.blockId) || !uint(value.start)
    || !text(value.text, 1024, false) || !list(value.tokens, 512, isAnalyzedToken)) return false;
  const bytes = encoder.encode(value.text);
  let cursor = value.start;
  for (const token of value.tokens) {
    if (!isAnalyzedToken(token) || token.start !== cursor || token.end < value.start
      || !boundary(bytes, token.start - value.start) || !boundary(bytes, token.end - value.start)
      || decoder.decode(bytes.subarray(token.start - value.start, token.end - value.start)) !== token.text) return false;
    cursor = token.end;
  }
  return cursor === value.start + bytes.length;
}
function isDocumentSearchPage(value: unknown): value is DocumentSearchPage {
  if (!object(value) || !text(value.sourceId) || !text(value.contentRevision) || !text(value.parserRevision)
    || value.scope !== 'text' && value.scope !== 'recognized_pages' || !text(value.text, 1024)
    || !uint(value.scanned) || !uint(value.total) || value.total > 1024 || value.scanned > value.total
    || !uint(value.unavailable) || value.unavailable > value.scanned || !Array.isArray(value.hits)
    || value.hits.length > 16 || encoder.encode(JSON.stringify(value)).length > 196608) return false;
  const scope = value.scope;
  const parser = value.parserRevision;
  const search = value.text;
  const total = value.total;
  if (!value.hits.every(hit => {
    if (!object(hit) || !isDocumentPosition(hit.position) || hit.position.parserRevision !== parser
      || !isSourceAnchor(hit.anchor) || hit.anchor.sourceId !== value.sourceId
      || hit.anchor.contentRevision !== value.contentRevision) return false;
    const anchor = hit.anchor;
    const locator = anchor.locator;
    const selected = decoder.decode(encoder.encode(anchor.text).subarray(locator.selectionStart, locator.selectionEnd));
    if (selected !== search) return false;
    switch (locator.kind) {
      case 'document': return scope === 'text' && locator.parserRevision === parser
        && hit.position.resource === locator.resource && hit.position.blockId === locator.blockId
        && hit.position.offset === locator.contextStart + locator.selectionStart;
      case 'image': return scope === 'recognized_pages' && locator.pageIndex !== null
        && locator.pageIndex < total && hit.position.offset === 0;
      case 'message': case 'video': return false;
    }
  })) return false;
  if (value.next === null) return value.scanned === total;
  const next = value.next;
  return object(next) && typeof next.identity === 'string' && /^[a-f0-9]{64}$/.test(next.identity)
    && uint(next.index) && next.index === value.scanned && next.index < total
    && uint(next.region) && next.region <= 512 && (scope !== 'text' || next.region === 0)
    && uint(next.offset) && next.offset <= 65536 && next.unavailable === value.unavailable;
}
type DocumentResponse = Extract<Response, { type: 'document' | 'documents' | 'document_contents' | 'document_analysis' | 'document_resource' | 'document_search' }>;
export function isDocumentResponse(value: unknown): value is DocumentResponse {
  if (!object(value)) return false;
  switch (value.type) {
    case 'document': return isDocumentWindow(value.window);
    case 'document_search': return isDocumentSearchPage(value.page);
    case 'documents': return list(value.sources, 16, isDocumentRecord);
    case 'document_contents': {
      const page = value.page;
      return object(page) && text(page.sourceId) && text(page.parserRevision)
        && nullable(page.nextOffset, uint) && list(page.items, 32, item => object(item)
          && text(item.label, 4096) && isDocumentPosition(item.position) && item.position.parserRevision === page.parserRevision);
    }
    case 'document_resource': {
      const item = value.location;
      return object(item) && text(item.sourceId) && text(item.resourceId) && text(item.path, 4096)
        && text(item.mimeType, 128) && uint(item.byteLength) && item.byteLength <= 8388608;
    }
    case 'document_analysis': {
      const batch = value.batch;
      return object(batch) && ['sourceId', 'contentRevision', 'parserRevision', 'packageId', 'packageVersion'].every(key => text(batch[key]))
        && typeof batch.packageRevision === 'string' && /^[a-f0-9]{64}$/.test(batch.packageRevision)
        && list(batch.blocks, 4, analyzedBlock) && list(batch.knowledge, 256, isKnowledgeProjection)
        && list(batch.annotations, 2048, item => object(item) && text(item.resource) && text(item.blockId)
          && uint(item.tokenStart) && text(item.status));
    }
    default: return false;
  }
}
