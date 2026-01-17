/**
 * Reader Navigation Bar Component
 * Top navigation bar for the reader with controls
 */

import { Component, Show, Accessor } from 'solid-js';

interface ReaderNavProps {
  bookTitle: Accessor<string>;
  progressString: Accessor<string>;
  fitMode: Accessor<string>;
  pageMode: Accessor<string>;
  showOcrOverlay: Accessor<boolean>;
  hasOcrResult: Accessor<boolean>;
  onGoHome: () => void;
  onToggleSidebar: () => void;
  onFitModeChange: (mode: string) => void;
  onPageModeChange: (mode: string) => void;
  onToggleOcrOverlay: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}

export const ReaderNav: Component<ReaderNavProps> = (props) => {
  return (
    <nav class="reader-nav glass">
      <div class="nav-group">
        <button class="nav-btn" onClick={props.onGoHome} title="Back to Home">
          ← Home
        </button>
        <button class="nav-btn sidebar-btn" onClick={props.onToggleSidebar}>
          📑
        </button>
        <span class="book-title-nav">{props.bookTitle()}</span>
      </div>
      
      <div class="nav-group">
        <span class="progress">{props.progressString()}</span>
      </div>
      
      <div class="nav-group">
        <select
          class="glass-select"
          value={props.fitMode()}
          onChange={(e) => props.onFitModeChange(e.currentTarget.value)}
        >
          <option value="fit-height">Fit Height ↕</option>
          <option value="fit-width">Fit Width ↔</option>
        </select>
        
        <select
          class="glass-select"
          value={props.pageMode()}
          onChange={(e) => props.onPageModeChange(e.currentTarget.value)}
        >
          <option value="double">Double Page</option>
          <option value="single">Single Page</option>
        </select>

        <Show when={props.hasOcrResult()}>
          <button
            class={`nav-btn ocr-toggle ${props.showOcrOverlay() ? 'active' : ''}`}
            onClick={props.onToggleOcrOverlay}
            title={props.showOcrOverlay() ? 'Hide OCR Overlay' : 'Show OCR Overlay'}
          >
            👁
          </button>
        </Show>
      </div>
      
      <div class="nav-group nav-arrows">
        <button class="nav-btn" onClick={props.onPrevPage}>◀</button>
        <button class="nav-btn" onClick={props.onNextPage}>▶</button>
      </div>
    </nav>
  );
};

export default ReaderNav;
