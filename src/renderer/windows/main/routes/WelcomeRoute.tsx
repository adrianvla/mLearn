/**
 * Welcome Route
 * Start menu showing options to watch videos, open reader, or continue recent content
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings } from '../../../context';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { ActionCard, RecentCard, GlassBtn, type RecentItem } from '../../../components/common';
import './welcome.css';
import AppLogo from "@renderer/components/common/Misc/AppLogo";

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
    // Don't try to open items with no path (legacy items or failed saves)
    if (!item.path || !item.path.trim()) {
      console.warn('[Welcome] Cannot open recent item - no path saved:', item.name);
      // Navigate to the appropriate route without a path - user can then drag/drop
      if (item.type === 'video') {
        navigate('/video');
      } else {
        navigate('/reader');
      }
      return;
    }
    
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
          <AppLogo size={"2.5rem"}/>
          <h1>mLearn</h1>
        </div>
        <p class="welcome-subtitle">Learn languages through immersion</p>
      </header>

      {/* Main Actions */}
      <section class="welcome-actions">
        <ActionCard
          icon="🎬"
          title="Watch Video"
          description="Open a video file with intelligent subtitles"
          onClick={openVideoPlayer}
          primary
        />

        <ActionCard
          icon="📖"
          title="Open Reader"
          description="Read manga or images with OCR"
          onClick={openReader}
          primary
        />

        <ActionCard
          icon="🃏"
          title="Review Flashcards"
          description="Practice your vocabulary"
          onClick={openFlashcards}
        />

        <ActionCard
          icon="⚙️"
          title="Settings"
          description="Customize your experience"
          onClick={openSettings}
        />
      </section>

      {/* Recent Items */}
      <Show when={recentItems().length > 0}>
        <section class="welcome-recent">
          <h2>Continue Learning</h2>
          <div class="recent-grid">
            <For each={recentItems().slice(0, 4)}>
              {(item) => (
                <RecentCard 
                  item={item} 
                  onClick={() => openRecent(item)} 
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      {/* Footer */}
      <footer class="welcome-footer">
        <span>Learning {settings.language === 'ja' ? 'Japanese' : 'German'}</span>
        <span>•</span>
        <GlassBtn variant="ghost" size="sm" onClick={openSettings}>Change Language</GlassBtn>
      </footer>
    </div>
  );
};
