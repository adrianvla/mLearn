/**
 * WelcomeContinueRow
 * Full-width single-item continue-learning row under the welcome feature grid.
 */

import { Component, Show } from 'solid-js';
import { BookIcon, VideoIcon } from '../../../../components/common';
import type { RecentItem } from '../../../../services/thumbnailService';
import type { RelativeLastOpened } from '../../../../utils/timeFormatting';
import './WelcomeContinueRow.css';

export interface WelcomeContinueRowProps {
  /** Most recent item (storage is newest-opened first) */
  item: RecentItem;
  continueLabel: string;
  /** Localized relative/absolute label and exact-date tooltip */
  lastOpened: RelativeLastOpened | null;
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
          <Show when={props.lastOpened?.label}>
            <span class="welcome-continue-meta" title={props.lastOpened?.title}>{props.lastOpened?.label}</span>
          </Show>
          <progress class="welcome-continue-progress" max="100" value={props.item.progress} />
        </span>
        <span class="welcome-continue-pct">{Math.round(props.item.progress)}%</span>
      </button>
    </div>
  );
};

export default WelcomeContinueRow;
