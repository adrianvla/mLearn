import type { CollectionPreparationStatus, Response } from '@mlearn/contracts';
import { encodedBytes, isMaterial } from './materialProtocol';
import { isKnowledgeProjection, isLexicalSummary } from './watchProtocol';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0
    && new TextEncoder().encode(value).length <= maximum;
}
function uint(value: unknown, maximum = 4294967295): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}
function list(value: unknown, maximum: number, guard: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= maximum && value.every(guard);
}
function target(value: unknown): boolean {
  return object(value) && isLexicalSummary(value.summary) && text(value.kind, 512)
    && list(value.capabilities, 32, item => text(item, 512))
    && list(value.scopes, 128, item => text(item, 512))
    && list(value.levels, 256, item => object(item) && text(item.scaleId, 512) && text(item.level, 128))
    && object(value.extensions) && Object.keys(value.extensions).length <= 32
    && Object.keys(value.extensions).every(key => text(key, 512) && key.includes(':'))
    && encodedBytes(value) <= 16384;
}
function item(value: unknown): boolean {
  if (!object(value) || !list(value.knowledge, 32, isKnowledgeProjection)) return false;
  switch (value.kind) {
    case 'target': return target(value.target) && uint(value.materialCount);
    case 'material': return isMaterial(value.material) && (value.target === null || target(value.target));
    default: return false;
  }
}
export function isCollectionPreparationStatus(value: unknown): value is CollectionPreparationStatus {
  if (!object(value) || !object(value.command) || !text(value.command.commandId, 128)
    || !text(value.command.packageId, 128) || !uint(value.processed, 1000000)
    || !(value.message === null || text(value.message, 2048))) return false;
  if (value.total === null) {
    if (value.processed !== 0) return false;
  } else if (!uint(value.total, 1000000) || value.processed > value.total) return false;
  switch (value.phase) {
    case 'preparing':
    case 'cancelling':
    case 'failed':
    case 'cancelled': return true;
    case 'succeeded': return value.total !== null && value.processed === value.total;
    default: return false;
  }
}
export function isCollectionResponse(value: unknown): value is Response {
  if (!object(value)) return false;
  switch (value.type) {
    case 'collection_preparation':
      return value.status === null || isCollectionPreparationStatus(value.status);
    case 'collection': {
      if (!object(value.result)) return false;
      const result = value.result;
      switch (result.state) {
        case 'unavailable': return text(result.message, 2048);
        case 'preparing':
          return uint(result.processed, 1000000) && uint(result.total, 1000000)
            && result.processed <= result.total;
        case 'ready': {
          const page = result.page;
          return object(page) && list(page.items, 24, item) && uint(page.count)
            && Array.isArray(page.items) && page.items.length <= page.count
            && (page.next === null || text(page.next, 8192))
            && (page.packageRevision === null || text(page.packageRevision, 256))
            && uint(page.knowledgeRevision) && uint(page.materialRevision)
            && encodedBytes(page) <= 262144;
        }
        default: return false;
      }
    }
    default: return false;
  }
}
