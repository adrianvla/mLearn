import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { threadContextId, type WorldSnapshot } from '../../../shared/world';
import type { WorldChangeNotice } from '../../../shared/runtimeInspection';
import { latestConversationPreview, type ConversationPreviews } from './conversationPreviews';

/** Bounded reads, cached per scope; only committed changes invalidate existing entries. */
export function useConversationPreviews(world: Accessor<WorldSnapshot | null>) {
  const [previews, setPreviews] = createSignal<ConversationPreviews>({});
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal<ReadonlySet<string>>(new Set());
  const loaded = new Set<string>();
  const pending = new Set<string>();
  const inFlight = new Set<string>();
  let disposed = false, active = 0;
  let scopes = new Map<string, { roomId: string; threadId?: string }>();
  const queue = (key: string): void => {
    pending.add(key);
    setLoading(current => current.has(key) ? current : new Set(current).add(key));
  };
  onCleanup(() => { disposed = true; pending.clear(); });
  const drain = (): void => {
    while (!disposed && active < 4 && pending.size) {
      const key = [...pending].find(item => !inFlight.has(item));
      if (!key) break;
      pending.delete(key);
      const scope = scopes.get(key); if (!scope) continue;
      active++; inFlight.add(key);
      const read = scope.threadId ? getBridge().journal.readThread(scope.roomId, scope.threadId) : getBridge().journal.readSeaProjection(scope.roomId);
      void read.then(events => {
        if (!disposed && scopes.has(key)) {
          setPreviews(current => ({ ...current, [key]: latestConversationPreview(events) })); loaded.add(key);
        }
      }).catch(err => { if (!disposed) setError(String(err)); }).finally(() => {
        active--; inFlight.delete(key);
        if (!disposed && !pending.has(key)) setLoading(current => { const next = new Set(current); next.delete(key); return next; });
        drain();
      });
    }
  };
  const refresh = (notice?: WorldChangeNotice): void => {
    if (disposed) return;
    // Entity changes update titles/rosters through world(); journal changes alone
    // invalidate existing message previews. A background job must not reread every chat.
    if (notice?.kind === 'world') return;
    setError('');
    for (const [key, scope] of scopes) {
      if (!notice || (scope.roomId === notice.roomId && (!notice.threadId || scope.threadId === notice.threadId))) queue(key);
    }
    drain();
  };
  createEffect(() => {
    const snapshot = world(); if (!snapshot) return;
    scopes = new Map([
      ...snapshot.rooms.map(room => [room.id, { roomId: room.id }] as const),
      ...snapshot.threads.filter(thread => thread.state !== 'archived').map(thread => {
        const roomId = threadContextId(thread); return [`${roomId}/${thread.id}`, { roomId, threadId: thread.id }] as const;
      }),
    ]);
    for (const key of loaded) if (!scopes.has(key)) loaded.delete(key);
    for (const key of scopes.keys()) if (!loaded.has(key)) queue(key);
    drain();
  });
  return { previews, error, refresh, isLoading: (key: string) => loading().has(key) };
}
