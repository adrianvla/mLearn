/**
 * WelcomeContinueRow
 * Full-width single-item continue-learning row under the welcome feature grid.
 */

import { Component, Show } from 'solid-js';
import { BookIcon, VideoIcon } from '../../../../components/common';
import type { RecentItem } from '../../../../services/thumbnailService';
import './WelcomeContinueRow.css';

export interface WelcomeContinueRowProps {
  /** Most recent item (storage is newest-opened first) */
  item: RecentItem;
  continueLabel: string;
  /** Locally formatted relative/absolute last-opened time */
  lastWatchedLabel: string;
  onContinue: (item: RecentItem) => void;
}

export const WelcomeContinueRow: Component<WelcomeContinueRowProps> = (props) => {
  const typeIcon = () => (props.item.type === 'video' ? <VideoIcon size={20} /> : <BookIcon size={20} />);

  return (
    <div class="welcome-continue">
      <button
        type="button"
        class="welcome-continue-main"
        onClick={() => props.onContinue(props.item)}
        aria-label={`${props.item.name}, ${props.continueLabel}`}
      >
        <span class="welcome-continue-media">
          <Show
            when={props.item.thumbnail}
            fallback={<span class="welcome-continue-fallback" aria-hidden="true">{typeIcon()}</span>}
          >
            <img class="welcome-continue-thumb" src={props.item.thumbnail} alt="" />
          </Show>
        </span>
        <span class="welcome-continue-info">
          <span class="welcome-continue-title">{props.item.name}</span>
          <span class="welcome-continue-meta">{props.lastWatchedLabel}</span>
          <progress class="welcome-continue-progress" max="100" value={props.item.progress} />
        </span>
        <span class="welcome-continue-pct">{Math.round(props.item.progress)}%</span>
      </button>
      <button
        type="button"
        class="welcome-continue-action"
        onClick={() => props.onContinue(props.item)}
      >
        <svg class="welcome-continue-action-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        {props.continueLabel}
      </button>
    </div>
  );
};

export default WelcomeContinueRow;
