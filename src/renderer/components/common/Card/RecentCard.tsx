/**
 * RecentCard Component
 * Card for displaying recently watched/read content
 * Used in WelcomeRoute for "Continue Learning" section
 */

import { Component } from 'solid-js';
import { ProgressBar } from '../Feedback/ProgressBar';
import './RecentCard.css';

export interface RecentItem {
  type: 'video' | 'book';
  name: string;
  path: string;
  thumbnail?: string;
  progress: number;
  lastWatched: number;
}

export interface RecentCardProps {
  item: RecentItem;
  onClick?: () => void;
}

/**
 * RecentCard - Displays a recently accessed item with thumbnail and progress
 */
export const RecentCard: Component<RecentCardProps> = (props) => {
  const typeIcon = () => props.item.type === 'video' ? '🎬' : '📖';

  return (
    <button class="recent-card" onClick={props.onClick}>
      <div 
        class="recent-thumbnail"
        style={{
          "background-image": props.item.thumbnail ? `url(${props.item.thumbnail})` : undefined
        }}
      >
        <span class="recent-type">{typeIcon()}</span>
      </div>
      <div class="recent-info">
        <h4>{props.item.name}</h4>
        <ProgressBar
          value={props.item.progress}
          size="md"
          variant="default"
          class="recent-progress"
          rounded={false}
        />
      </div>
    </button>
  );
};

export default RecentCard;
