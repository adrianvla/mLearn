import type { MaterialContent, Response, SourceAnchor } from '@mlearn/contracts';
import { isWatchResponse } from './watchProtocol';
import { isDocumentWindow } from './documentProtocol';
import { isOcrPage } from './ocrProtocol';

const encoder = new TextEncoder();
export const encodedBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max = 512, required = true): value is string {
  return typeof value === 'string' && (!required || value.length > 0) && encoder.encode(value).length <= max;
}
function uint(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
}
function list(value: unknown, max: number, guard: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length <= max && value.every(guard);
}
const nullable = (value: unknown, guard: (value: unknown) => boolean) => value === null || guard(value);
const strings = (value: unknown, max: number, bytes: number) => list(value, max, item => text(item, bytes, false));
function sense(value: unknown) {
  return object(value) && text(value.heading, 32768, false) && strings(value.labels, 32, 32768)
    && strings(value.definitions, 128, 32768) && Array.isArray(value.definitions) && value.definitions.length > 0
    && strings(value.notes, 32, 32768);
}
export function isSourceAnchor(value: unknown): value is SourceAnchor {
  if (!object(value) || !text(value.sourceId) || !text(value.contentRevision) || !text(value.packageId)
    || !text(value.packageVersion) || !text(value.text, 32768, false) || !object(value.locator)) return false;
  const locator = value.locator;
  if (locator.kind === 'document' || locator.kind === 'image') {
    const bytes = encoder.encode(value.text);
    const location = locator.kind === 'document'
      ? text(locator.parserRevision) && text(locator.resource) && text(locator.blockId)
      : text(locator.resourceId) && nullable(locator.pageIndex, uint) && uint(locator.ocrRevision)
        && locator.ocrRevision > 0 && text(locator.regionId);
    return location
      && uint(locator.contextStart) && uint(locator.selectionStart) && uint(locator.selectionEnd)
      && locator.selectionStart < locator.selectionEnd && locator.selectionEnd <= bytes.length
      && locator.contextStart + locator.selectionEnd <= 4294967295
      && [locator.selectionStart, locator.selectionEnd].every(offset =>
        offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80);
  }
  const frameWithoutText = value.text === '' && locator.cueIndex === null
    && locator.selectionStart === 0 && locator.selectionEnd === 0;
  if (locator.kind !== 'video' || !nullable(locator.subtitleRevision, text) || !nullable(locator.cueIndex, uint)
    || !uint(locator.selectionStart) || !uint(locator.selectionEnd)
    || !frameWithoutText && locator.selectionStart >= locator.selectionEnd
    || !uint(locator.positionMs) || typeof locator.subtitleOffsetMs !== 'number' || !Number.isInteger(locator.subtitleOffsetMs)
    || Math.abs(locator.subtitleOffsetMs) > 86400000 || typeof locator.playbackRate !== 'number'
    || !Number.isFinite(locator.playbackRate) || locator.playbackRate < 0.5 || locator.playbackRate > 2) return false;
  const bytes = encoder.encode(value.text);
  return locator.selectionEnd <= bytes.length && [locator.selectionStart, locator.selectionEnd].every(
    offset => offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80);
}
function attachment(value: unknown) {
  if (!object(value) || !text(value.mediaId)) return false;
  if (value.audioBinding !== undefined && value.audioBinding !== null
    && (!object(value.audioBinding) || !text(value.audioBinding.packageId)
      || !nullable(value.audioBinding.targetId, text) || !text(value.audioBinding.phrase, 2048)
      || value.audioBinding.phrase.trim().length === 0)) return false;
  const segment = value.segment;
  return segment === null || object(segment) && text(segment.sourceId) && text(segment.contentRevision)
    && uint(segment.startMs) && uint(segment.endMs) && segment.startMs <= segment.endMs;
}
export function isMaterialContent(value: unknown): value is MaterialContent {
  return object(value) && text(value.packageId) && nullable(value.targetId, text) && nullable(value.packageRevision, text)
    && nullable(value.sense, sense)
    && text(value.phrase, 2048, false) && text(value.reading, 2048, false)
    && text(value.meaning, 32768, false) && text(value.context, 32768, false) && text(value.notes, 32768, false)
    && strings(value.examples, 16, 4096) && nullable(value.source, isSourceAnchor)
    && list(value.attachments, 8, attachment)
    && value.attachments.every(item => object(item) && (item.audioBinding === undefined || item.audioBinding === null
      || object(item.audioBinding) && item.audioBinding.packageId === value.packageId
        && item.audioBinding.targetId === value.targetId && item.audioBinding.phrase === value.phrase))
    && new Set(value.attachments.map(item => object(item) ? item.mediaId : null)).size === value.attachments.length
    && (value.phrase.trim().length > 0 || value.attachments.length > 0) && encodedBytes(value) <= 65536;
}
function media(value: unknown) {
  return object(value) && text(value.id) && typeof value.kind === 'string' && ['image', 'audio', 'video'].includes(value.kind)
    && text(value.name, 2048) && text(value.mimeType, 256) && typeof value.byteLength === 'number'
    && Number.isSafeInteger(value.byteLength) && value.byteLength > 0;
}
function material(value: unknown) {
  if (!object(value) || !text(value.id) || !uint(value.revision) || value.revision < 1
    || typeof value.excluded !== 'boolean' || !isMaterialContent(value.content) || !list(value.media, 8, media)) return false;
  const assets = value.media;
  const ids = assets.map(item => object(item) ? item.id : null);
  return new Set(ids).size === ids.length && ids.length === value.content.attachments.length
    && value.content.attachments.every(item => ids.includes(item.mediaId)
      && (item.audioBinding == null || assets.some(asset => object(asset) && asset.id === item.mediaId && asset.kind === 'audio'))
      && (item.segment === null || item.segment.startMs < item.segment.endMs
        || assets.some(asset => object(asset) && asset.id === item.mediaId && asset.kind === 'image')));
}
function target(value: unknown) { return object(value) && text(value.packageId) && text(value.targetId); }
function eligibility(value: unknown) {
  if (!object(value) || !target(value.target) || !object(value.availability)) return false;
  switch (value.availability.state) {
    case 'eligible': case 'excluded': return true;
    case 'existing': return text(value.availability.materialId) && typeof value.availability.excluded === 'boolean';
    default: return false;
  }
}
export type MaterialResponse = Extract<Response, { type: 'materials' | 'material' | 'material_written' | 'material_captured'
  | 'material_eligibility' | 'capture_exclusion_changed' | 'material_source' | 'document_material_source' | 'image_material_source' }>;
/** Admit nested Material data from unknown before exposing generated Rust types. */
export function isMaterialResponse(value: unknown): value is MaterialResponse {
  if (!object(value)) return false;
  switch (value.type) {
    case 'material': return material(value.material);
    case 'materials': return object(value.page) && list(value.page.items, 24, material) && nullable(value.page.next, text);
    case 'material_written': {
      const result = value.outcome;
      if (!object(result)) return false;
      switch (result.status) {
        case 'saved': return material(result.material) && typeof result.reused === 'boolean'
          && uint(result.committedRevision) && result.committedRevision > 0 && object(result.material)
          && uint(result.material.revision) && result.committedRevision <= result.material.revision;
        case 'duplicate': return list(result.items, 3, material) && result.items.length > 0;
        default: return false;
      }
    }
    case 'material_captured': return list(value.results, 16, item => {
      if (!object(item) || !text(item.commandId, 128)) return false;
      switch (item.state) {
        case 'saved': return text(item.materialId) && uint(item.committedRevision) && item.committedRevision > 0 && typeof item.reused === 'boolean';
        case 'duplicate': return strings(item.materialIds, 3, 512) && Array.isArray(item.materialIds)
          && item.materialIds.length > 0 && item.materialIds.every(id => text(id));
        case 'failed': return text(item.message, 32768);
        default: return false;
      }
    });
    case 'material_eligibility': return list(value.items, 128, eligibility);
    case 'capture_exclusion_changed': return eligibility(value.item);
    case 'material_source': {
      if (!isSourceAnchor(value.anchor) || !isWatchResponse({ type: 'source', window: value.window }) || !object(value.window)
        || !object(value.window.source)) return false;
      const source = value.window.source;
      const anchor = value.anchor;
      const locator = anchor.locator;
      if (locator.kind !== 'video') return false;
      return source.id === anchor.sourceId && source.mediaRevision === anchor.contentRevision
        && source.packageId === anchor.packageId
        && source.positionMs === locator.positionMs && source.subtitleRevision === locator.subtitleRevision
        && source.subtitleOffsetMs === locator.subtitleOffsetMs && source.playbackRate === locator.playbackRate;
    }
    case 'document_material_source': {
      if (!isSourceAnchor(value.anchor) || value.anchor.locator.kind !== 'document' || !isDocumentWindow(value.window)) return false;
      const source = value.window.source;
      const locator = value.anchor.locator;
      return source.id === value.anchor.sourceId && source.contentRevision === value.anchor.contentRevision
        && source.packageId === value.anchor.packageId && source.parserRevision === locator.parserRevision
        && source.position?.resource === locator.resource && source.position.blockId === locator.blockId
        && source.position.offset === locator.contextStart + locator.selectionStart;
    }
    case 'image_material_source': {
      if (!isSourceAnchor(value.anchor) || value.anchor.locator.kind !== 'image'
        || !isDocumentWindow(value.window) || !isOcrPage(value.page)) return false;
      const anchor = value.anchor;
      const locator = value.anchor.locator;
      const source = value.window.source;
      const page = value.page;
      const selected = page.regions.find(region => region.id === locator.regionId);
      if (!selected) return false;
      const bytes = encoder.encode(selected.text);
      const context = encoder.encode(anchor.text);
      const original = bytes.subarray(locator.contextStart, locator.contextStart + context.length);
      return source.id === anchor.sourceId && page.sourceId === anchor.sourceId
        && source.contentRevision === anchor.contentRevision && page.contentRevision === anchor.contentRevision
        && source.packageId === anchor.packageId && page.resourceId === locator.resourceId
        && page.ocrRevision === locator.ocrRevision && original.length === context.length
        && value.window.blocks.some(block => block.page === locator.pageIndex
          && source.position?.resource === block.resource && source.position.blockId === block.id)
        && original.every((byte, index) => byte === context[index]);
    }
    default: return false;
  }
}
