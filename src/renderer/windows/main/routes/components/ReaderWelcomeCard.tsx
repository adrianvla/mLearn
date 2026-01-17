/**
 * Reader Welcome Card Component
 * Displayed when no book is loaded
 */

import { Component, Accessor } from 'solid-js';

interface ReaderWelcomeCardProps {
  isDragging: Accessor<boolean>;
}

export const ReaderWelcomeCard: Component<ReaderWelcomeCardProps> = (props) => {
  return (
    <div class={`welcome-card ${props.isDragging() ? 'dragging' : ''}`}>
      <div class="welcome-content">
        <h2>📖 Settle in, Reader</h2>
        <p class="welcome-intro">
          Drag and drop a folder of images or a .pdf file anywhere in this window.
        </p>
        <div class="dropzone">
          Drop files here to import them instantly
        </div>
        <div class="tips-grid">
          <div class="tip">
            <h3>📐 Shape your view</h3>
            <p>Switch between single and double page layouts.</p>
          </div>
          <div class="tip">
            <h3>🔮 OCR magic</h3>
            <p>Trigger OCR to hover words and build flashcards.</p>
          </div>
          <div class="tip">
            <h3>🔖 Progress tracking</h3>
            <p>We track your page progress automatically.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReaderWelcomeCard;
