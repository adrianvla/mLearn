/**
 * About Tab
 */

import { Component, createSignal, onMount } from 'solid-js';

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
    // TODO: Open licenses window
    console.log('Open licenses');
  };

  return (
    <div class="tab-content">
      <div class="about-logo">📚</div>
      
      <div class="about-version">
        <h2>mLearn</h2>
        <span>Version {version()}</span>
      </div>

      <div class="setting-group">
        <p style={{ 
          color: "rgba(255,255,255,0.7)", 
          "line-height": "1.7",
          "text-align": "center"
        }}>
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

      <div class="setting-group" style={{ "margin-top": "30px" }}>
        <h3 style={{ "margin-bottom": "16px" }}>Features</h3>
        <ul style={{ 
          color: "rgba(255,255,255,0.7)", 
          "line-height": "1.8",
          "padding-left": "20px"
        }}>
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

      <div class="setting-group">
        <h3 style={{ "margin-bottom": "16px" }}>Keyboard Shortcuts</h3>
        <div style={{ display: "grid", gap: "8px" }}>
          <ShortcutRow shortcut="Space" description="Play/Pause video" />
          <ShortcutRow shortcut="←/→" description="Seek 5 seconds" />
          <ShortcutRow shortcut="↑/↓" description="Volume control" />
          <ShortcutRow shortcut="F" description="Toggle fullscreen" />
          <ShortcutRow shortcut="M" description="Mute/Unmute" />
          <ShortcutRow shortcut="1-4" description="Flashcard review grades" />
          <ShortcutRow shortcut="Cmd/Ctrl+Z" description="Undo flashcard action" />
        </div>
      </div>
    </div>
  );
};

const ShortcutRow: Component<{ shortcut: string; description: string }> = (props) => (
  <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
    <span style={{ color: "rgba(255,255,255,0.6)" }}>{props.description}</span>
    <kbd style={{
      padding: "4px 8px",
      background: "rgba(255,255,255,0.1)",
      "border-radius": "4px",
      "font-family": "monospace",
      "font-size": "0.85rem"
    }}>
      {props.shortcut}
    </kbd>
  </div>
);
