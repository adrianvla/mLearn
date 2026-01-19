/**
 * About Tab
 */

import { Component, createSignal, onMount } from 'solid-js';
import { TabContent } from '../../../components/common';
import { IPC_CHANNELS } from '../../../../shared/constants';
import './AboutTab.css';

export const AboutTab: Component = () => {
  const [version, setVersion] = createSignal('1.0.0');

  onMount(() => {
    // Get version from IPC
    if (window.mLearnIPC) {
      window.mLearnIPC.send('get-version');
      window.mLearnIPC.on('version', (...args: unknown[]) => {
        if (typeof args[0] === 'string') {
          setVersion(args[0]);
        }
      });
    }
  });

  const openContact = () => {
    window.mLearnIPC?.send('show-contact');
  };

  const openLicenses = () => {
    window.mLearnIPC?.openWindow({
      type: 'licenses',
      options: { width: 900, height: 700 },
    });
  };

  return (
    <TabContent padding="lg" class="about-tab">
      <div class="about-logo">📚</div>
      
      <div class="about-version">
        <h2>mLearn</h2>
        <span>Version {version()}</span>
      </div>

      <div class="about-description">
        <p>
          mLearn is a language learning tool that helps you study
          through immersion. Watch videos, read manga, and learn
          vocabulary naturally with intelligent subtitles and
          spaced repetition.
        </p>
      </div>

      <div class="about-links">
        <button class="about-link" onClick={openContact}>
          🌐 Website
        </button>
        <button class="about-link" onClick={openLicenses}>
          📄 Licenses
        </button>
      </div>

      <div class="about-features">
        <h3>Features</h3>
        <ul>
          <li>Interactive subtitles with hover translations</li>
          <li>OCR reader for manga and images</li>
          <li>Built-in spaced repetition flashcards</li>
          <li>Anki integration</li>
          <li>Pitch accent visualization</li>
          <li>Part-of-speech color coding</li>
          <li>Watch party sync</li>
          <li>Mobile flashcard sync</li>
          <li>HLS streaming support</li>
        </ul>
      </div>

      <div class="about-shortcuts">
        <h3>Keyboard Shortcuts</h3>
        <div class="shortcuts-grid">
          <ShortcutRow shortcut="Space" description="Play/Pause video" />
          <ShortcutRow shortcut="←/→" description="Seek 5 seconds" />
          <ShortcutRow shortcut="↑/↓" description="Volume control" />
          <ShortcutRow shortcut="F" description="Toggle fullscreen" />
          <ShortcutRow shortcut="M" description="Mute/Unmute" />
          <ShortcutRow shortcut="1-4" description="Flashcard review grades" />
          <ShortcutRow shortcut="Cmd/Ctrl+Z" description="Undo flashcard action" />
        </div>
      </div>
    </TabContent>
  );
};

const ShortcutRow: Component<{ shortcut: string; description: string }> = (props) => (
  <div class="shortcut-row">
    <span class="shortcut-description">{props.description}</span>
    <kbd class="shortcut-key">{props.shortcut}</kbd>
  </div>
);
