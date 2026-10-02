import type { KnowledgeEvent } from '../knowledgeEvents';
import { eventCapability } from '../knowledgeEvents';
import { archiveBucketKey, bucketRepresentative, mergeArchives, type KeyArchive } from './historyArchive';

/** Read-time qualification only. An unaddressed historical event belongs to
 * its journal surface; fetching sibling keys must not erase that boundary.
 * Exact-key legacy semantics remain unchanged, including historical cue bridges.
 */
export function scopeSiblingEvent(event: KnowledgeEvent, key: string, queriedKey: string): KnowledgeEvent {
  if (key === queriedKey || event.targetRef) return event;
  const separator = key.indexOf(':');
  const surfaceId = `${key.slice(0, separator)}:surface:${key.slice(separator + 1)}`;
  return { ...event, targetRef: { kind: 'surface', id: surfaceId, capability: eventCapability(event) } };
}

/** Archives use the same address predicate as exact rows. Qualify their
 * legacy buckets before merging sibling archives, without rewriting storage.
 */
export function scopeSiblingArchive(archive: KeyArchive, key: string, queriedKey: string): KeyArchive {
  if (key === queriedKey) return archive;
  const parts = Object.entries(archive.buckets).map(([bucketKey, bucket]) => {
    const event = bucketRepresentative(bucketKey);
    const scopedKey = event ? archiveBucketKey(scopeSiblingEvent(event, key, queriedKey)) : bucketKey;
    return {
      ...archive,
      buckets: { [scopedKey]: bucket },
      archivedEventCount: bucket.rowCount,
      weekPoints: archive.weekPoints.filter(point => point.b === bucketKey).map(point => ({ ...point, b: scopedKey })),
    };
  });
  const merged = mergeArchives(parts);
  return merged ? { ...archive, buckets: merged.buckets, weekPoints: merged.weekPoints } : archive;
}
