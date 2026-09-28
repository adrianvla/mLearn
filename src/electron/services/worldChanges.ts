import type { WorldChangeNotice } from '../../shared/runtimeInspection';
import { getLogger } from '../../shared/utils/logger';
const log = getLogger('worldChanges');
const listeners = new Set<(notice: WorldChangeNotice) => void>();
/** Commit notification only: readers still obtain data through the canonical stores. */
export function publishWorldChange(notice: WorldChangeNotice): void {
  for (const listener of listeners) {
    try { listener(notice); } catch (error) { log.warn('World change subscriber failed', error); }
  }
}
export function subscribeWorldChanges(listener: (notice: WorldChangeNotice) => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
