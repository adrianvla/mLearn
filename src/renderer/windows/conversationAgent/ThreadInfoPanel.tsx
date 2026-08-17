import { Component, Show } from 'solid-js';
import type { ConversationAgentContext } from '../../../shared/types';
import type { Thread } from '../../../shared/world';
import { MediaStatsTab } from './MediaStatsTab';
import './ThreadInfoPanel.css';

interface ThreadInfoPanelProps {
  thread: Thread | null;
  context: ConversationAgentContext | null;
}

export const ThreadInfoPanel: Component<ThreadInfoPanelProps> = (props) => {
  const mediaRef = () => props.thread?.mediaRef;
  const mediaKey = () => mediaRef()?.mediaHash ?? props.context?.mediaHash ?? null;
  const statsContext = () => {
    const media = mediaRef();
    const context = props.context;
    return media && context ? { ...context, ...media } : context;
  };

  return (
    <div class="ca-thread-info">
      <div class="ca-thread-info-heading">
        <span class="ca-thread-info-label">Thread</span>
        <span class="ca-thread-info-title">{props.thread?.title || 'Untitled thread'}</span>
      </div>
      <Show when={mediaRef()}>
        {(media) => (
          <div class="ca-thread-media-card">
            <span class="ca-thread-media-name">{media().mediaName}</span>
            <span class="ca-thread-media-meta">
              {media().mediaType}{media().assessedLevelName ? ` · ${media().assessedLevelName}` : ''}
            </span>
          </div>
        )}
      </Show>
      <Show when={mediaKey()} keyed fallback={<MediaStatsTab context={statsContext()} />}>
        <MediaStatsTab context={statsContext()} />
      </Show>
    </div>
  );
};
