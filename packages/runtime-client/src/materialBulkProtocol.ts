import type { MaterialBulkStart, MaterialBulkStatus, Response } from '@mlearn/contracts';
import { isCollectionSelectionEntry } from './collectionProtocol';
import { encodedBytes } from './materialProtocol';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0
    && new TextEncoder().encode(value).length <= maximum;
}
function uint(value: unknown, maximum = 1000000): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}
function list(value: unknown, maximum: number, guard: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length <= maximum && value.every(guard);
}
function patch(value: unknown): boolean {
  if (!object(value)) return false;
  const fields = [value.phrase, value.reading, value.meaning, value.context, value.notes, value.examples];
  return fields.some(field => field !== null)
    && [value.phrase, value.reading].every(field => field === null || typeof field === 'string'
      && new TextEncoder().encode(field).length <= 2048)
    && [value.meaning, value.context, value.notes].every(field => field === null || typeof field === 'string'
      && new TextEncoder().encode(field).length <= 32768)
    && (value.examples === null || list(value.examples, 16, item => typeof item === 'string'
      && new TextEncoder().encode(item).length <= 4096))
    && encodedBytes(value) <= 65536;
}
function action(value: unknown): boolean {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'add': return typeof value.distinct === 'boolean';
    case 'edit': return patch(value.patch);
    case 'exclude': return typeof value.excluded === 'boolean';
    case 'remove': return true;
    default: return false;
  }
}
export function isMaterialBulkStart(value: unknown): value is MaterialBulkStart {
  return object(value) && text(value.commandId, 128) && text(value.selectionId, 128)
    && action(value.action) && encodedBytes(value) <= 69632;
}
export function isMaterialBulkStatus(value: unknown): value is MaterialBulkStatus {
  if (!object(value) || !isMaterialBulkStart(value.command) || !uint(value.total) || value.total === 0
    || !uint(value.processed) || !uint(value.succeeded) || !uint(value.duplicates) || !uint(value.failed)
    || value.processed > value.total || value.succeeded + value.duplicates + value.failed !== value.processed
    || typeof value.resultsAvailable !== 'boolean'
    || !(value.message === null || text(value.message, 2048))) return false;
  switch (value.phase) {
    case 'running': return value.resultsAvailable;
    case 'failed':
    case 'cancelled':
    case 'interrupted': return true;
    case 'completed': return value.processed === value.total && value.failed === 0;
    default: return false;
  }
}
function item(value: unknown): boolean {
  if (!object(value) || !isCollectionSelectionEntry(value.entry) || !text(value.label, 2048)) return false;
  if (value.outcome === null) return true;
  if (!object(value.outcome)) return false;
  const outcome = value.outcome;
  const entry = value.entry;
  switch (outcome.state) {
    case 'saved':
      return text(outcome.materialId, 512) && uint(outcome.committedRevision, 4294967295)
        && outcome.committedRevision > 0 && typeof outcome.reused === 'boolean'
        && (entry.item.kind === 'target' || entry.item.kind === 'material'
          && outcome.materialId === entry.item.id && typeof entry.materialRevision === 'number'
          && outcome.committedRevision === entry.materialRevision + 1);
    case 'removed':
      return uint(outcome.committedRevision, 4294967295)
        && entry.item.kind === 'material' && outcome.materialId === entry.item.id
        && typeof entry.materialRevision === 'number' && outcome.committedRevision === entry.materialRevision + 1;
    case 'duplicate':
      return entry.item.kind === 'target' && list(outcome.materialIds, 3, id => text(id, 512))
        && outcome.materialIds.length > 0 && new Set(outcome.materialIds).size === outcome.materialIds.length;
    case 'failed': return text(outcome.message, 2048);
    default: return false;
  }
}
type BulkResponse = Extract<Response, { type: 'material_bulk_status' | 'material_bulk_jobs' | 'material_bulk_page' | 'material_bulk_released' }>;
export function isMaterialBulkResponse(value: unknown): value is BulkResponse {
  if (!object(value) || encodedBytes(value) > 524288) return false;
  switch (value.type) {
    case 'material_bulk_released': return text(value.commandId, 128);
    case 'material_bulk_status': return isMaterialBulkStatus(value.status);
    case 'material_bulk_jobs': {
      const jobs = value.jobs;
      if (!Array.isArray(jobs) || jobs.length > 8 || !jobs.every(isMaterialBulkStatus)) return false;
      return jobs.every(job => job.resultsAvailable)
        && new Set(jobs.map(job => job.command.commandId)).size === jobs.length
        && jobs.reduce((total, job) => total + job.total, 0) <= 1000000;
    }
    case 'material_bulk_page': {
      const page = value.page;
      if (!text(value.commandId, 128) || !object(page) || !list(page.items, 24, item)
        || !(page.next === null || text(page.next, 512)) || encodedBytes(page) > 262144) return false;
      const identities = page.items.map(row => {
        if (!object(row) || !object(row.entry) || !object(row.entry.item)) return null;
        return row.entry.item.kind === 'material' ? row.entry.item.id : row.entry.item.targetId;
      });
      return new Set(identities).size === identities.length
        && (page.next === null || page.next === identities.at(-1));
    }
    default: return false;
  }
}
