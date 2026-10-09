import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, type Component } from 'solid-js';
import type { WorldSnapshot } from '../../../../../shared/world';
import { threadContextId } from '../../../../../shared/world';
import { getBridge } from '../../../../../shared/bridges';
import { useLocalization } from '../../../../context';
import { useWindowActivity } from '../../../../hooks/useWindowActivity';
import { useConversationPreviews } from '../../../conversationAgent/useConversationPreviews';
import { Button } from '../../../../components/common';

/** Local journal continuation; browsing this preview never invokes a provider. */
export const WelcomeConversationPreview: Component<{ onOpen: (context?: Record<string, unknown>) => void }> = props => {
  const { t } = useLocalization(), active = useWindowActivity();
  const [world, setWorld] = createSignal<WorldSnapshot | null>(null);
  const [selection, setSelection] = createSignal<{ roomId?: string; threadId?: string }>({});
  const [error, setError] = createSignal('');
  const previews = useConversationPreviews(world);
  let disposed = false, revision = 0, worldDirty = true, previewDirty = false;
  const refresh = async (): Promise<void> => {
    worldDirty = false;
    const request = ++revision;
    try {
      const [snapshot, saved] = await Promise.all([getBridge().world.getWorldState(), getBridge().kvStore.kvGet('conversation-selection')]);
      if (disposed || request !== revision) return;
      const chosen: unknown = saved ? JSON.parse(saved) : {};
      setSelection(chosen && typeof chosen === 'object' && !Array.isArray(chosen) ? chosen as { roomId?: string; threadId?: string } : {});
      setWorld(snapshot); setError('');
    } catch (failure) { if (!disposed && request === revision) setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  createEffect(() => { if (active()) { if (worldDirty) void refresh(); if (previewDirty) { previewDirty = false; previews.refresh(); } } });
  onMount(() => {
    const unsubscribe = getBridge().world.onChanged(notice => {
      if (notice.kind === 'world') { worldDirty = true; if (active()) void refresh(); }
      else if (active()) previews.refresh(notice);
      else previewDirty = true;
    });
    onCleanup(() => { disposed = true; revision++; unsubscribe(); });
  });
  const entries = createMemo(() => {
    const snapshot = world(); if (!snapshot) return [];
    return [...snapshot.rooms.map(room => ({ key: room.id, title: room.title, context: { roomId: room.id } })),
      ...snapshot.threads.filter(thread => thread.state !== 'archived').map(thread => ({ key: `${threadContextId(thread)}/${thread.id}`,
        title: thread.title ?? snapshot.rooms.find(room => room.id === thread.roomId)?.title ?? t('mlearn.ConversationAgent.Details.UntitledThread'),
        context: { roomId: threadContextId(thread), threadId: thread.id } }))];
  });
  const continuation = createMemo(() => {
    const chosen = selection(), available = entries();
    const selectedKey = chosen.threadId ? `${chosen.roomId}/${chosen.threadId}` : chosen.roomId;
    const selected = available.find(entry => entry.key === selectedKey);
    if (selected && previews.previews()[selected.key]) return selected;
    return available.filter(entry => previews.previews()[entry.key]).sort((a, b) => previews.previews()[b.key]!.timestamp - previews.previews()[a.key]!.timestamp)[0];
  });
  const loading = () => !world() || entries().some(entry => previews.isLoading(entry.key));
  return <div class="welcome-conversation-preview">
    <Show when={!error() && !previews.error()} fallback={<div role="alert"><p>{t('mlearn.Home.Summary.ConversationUnavailable')}</p>
      <Button variant="ghost" onClick={() => { void refresh(); previews.refresh(); }}>{t('mlearn.Knowledge.Retry')}</Button></div>}>
      <Show when={continuation()} keyed fallback={<Show when={!loading()} fallback={<p role="status">{t('mlearn.Global.Loading')}</p>}>
        <p>{t('mlearn.Home.Summary.NoConversation')}</p><Button variant="ghost" onClick={() => props.onOpen()}>{t('mlearn.ConversationAgent.NewConversation.Title')}</Button>
      </Show>}>{entry => <><strong class="welcome-conversation-title">{entry.title}</strong>
        <p class="welcome-conversation-message">{previews.previews()[entry.key]?.text}</p>
        <Button variant="ghost" size="sm" onClick={() => props.onOpen(entry.context)}>{t('mlearn.Global.Continue')}</Button></>}</Show>
    </Show>
  </div>;
};
