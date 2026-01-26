/**
 * RecentCard Component
 * Card for displaying recently watched/read content
 * Used in WelcomeRoute for "Continue Learning" section
 */

import { Component } from 'solid-js';
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
        <div class="progress-bar">
          <div 
            class="progress-fill" 
            style={{ width: `${Math.min(100, Math.max(0, props.item.progress))}%` }} 
          />
        </div>
      </div>
    </button>
  );
};

export default RecentCard;
