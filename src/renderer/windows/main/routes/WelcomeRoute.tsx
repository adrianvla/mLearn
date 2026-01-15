/**
 * Welcome Route
 * Start menu showing options to watch videos, open reader, or continue recent content
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings } from '../../../context';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import './welcome.css';

interface RecentItem {
  type: 'video' | 'book';
  name: string;
  path: string;
  thumbnail?: string;
  progress: number;
  lastWatched: number;
}

export const WelcomeRoute: Component = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  
  const [recentItems, setRecentItems] = createSignal<RecentItem[]>([]);

  onMount(() => {
    // Load recent items from localStorage
    try {
      const stored = localStorage.getItem('mlearn_recent_items');
      if (stored) {
        setRecentItems(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load recent items:', e);
    }
  });

  const openVideoPlayer = () => {
    navigate('/video');
  };

  const openReader = () => {
    navigate('/reader');
  };

  const openSettings = () => {
    window.mLearnIPC?.send('open-window', { type: 'settings' });
  };

  const openFlashcards = () => {
    window.mLearnIPC?.send('open-window', { type: 'flashcards' });
  };

  const openRecent = (item: RecentItem) => {
    if (item.type === 'video') {
      // Store the path and navigate
      sessionStorage.setItem('mlearn_open_video', item.path);
      navigate('/video');
    } else {
      sessionStorage.setItem('mlearn_open_book', item.path);
      navigate('/reader');
    }
  };

  return (
    <div class="welcome-container">
      <WindowDragRegion />
      
      {/* Header */}
      <header class="welcome-header">
        <div class="welcome-logo">
          <span class="logo-icon">📚</span>
          <h1>mLearn</h1>
        </div>
        <p class="welcome-subtitle">Learn languages through immersion</p>
      </header>

      {/* Main Actions */}
      <section class="welcome-actions">
        <button class="action-card primary" onClick={openVideoPlayer}>
          <span class="action-icon">🎬</span>
          <div class="action-text">
            <h3>Watch Video</h3>
            <p>Open a video file with intelligent subtitles</p>
          </div>
        </button>

        <button class="action-card primary" onClick={openReader}>
          <span class="action-icon">📖</span>
          <div class="action-text">
            <h3>Open Reader</h3>
            <p>Read manga or images with OCR</p>
          </div>
        </button>

        <button class="action-card" onClick={openFlashcards}>
          <span class="action-icon">🃏</span>
          <div class="action-text">
            <h3>Review Flashcards</h3>
            <p>Practice your vocabulary</p>
          </div>
        </button>

        <button class="action-card" onClick={openSettings}>
          <span class="action-icon">⚙️</span>
          <div class="action-text">
            <h3>Settings</h3>
            <p>Customize your experience</p>
          </div>
        </button>
      </section>

      {/* Recent Items */}
      <Show when={recentItems().length > 0}>
        <section class="welcome-recent">
          <h2>Continue Learning</h2>
          <div class="recent-grid">
            <For each={recentItems().slice(0, 4)}>
              {(item) => (
                <button class="recent-card" onClick={() => openRecent(item)}>
                  <div 
                    class="recent-thumbnail"
                    style={{
                      "background-image": item.thumbnail ? `url(${item.thumbnail})` : undefined
                    }}
                  >
                    <span class="recent-type">{item.type === 'video' ? '🎬' : '📖'}</span>
                  </div>
                  <div class="recent-info">
                    <h4>{item.name}</h4>
                    <div class="progress-bar">
                      <div class="progress-fill" style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </section>
      </Show>

      {/* Tips Section */}
      <section class="welcome-tips">
        <div class="tip">
          <span class="tip-icon">💡</span>
          <p>Drag and drop video files anywhere to start watching</p>
        </div>
        <div class="tip">
          <span class="tip-icon">⌨️</span>
          <p>Use keyboard shortcuts for faster navigation</p>
        </div>
      </section>

      {/* Footer */}
      <footer class="welcome-footer">
        <span>Learning {settings.language === 'ja' ? 'Japanese' : 'German'}</span>
        <span>•</span>
        <button class="footer-link" onClick={openSettings}>Change Language</button>
      </footer>
    </div>
  );
};
