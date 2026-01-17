/**
 * Reader Welcome Card Component
 * Displayed when no book is loaded
 */

import { Component, Accessor } from 'solid-js';
import './ReaderWelcomeCard.css';

interface ReaderWelcomeCardProps {
  isDragging: Accessor<boolean>;
}

export const ReaderWelcomeCard: Component<ReaderWelcomeCardProps> = (props) => {
  return (
    <div class="reader-welcome">
      <div class={`reader-welcome-card ${props.isDragging() ? 'dragging' : ''}`}>
        <h2>📖 Settle in, Reader</h2>
        <p class="reader-welcome-intro">
          Drag and drop a folder of images or a .pdf file anywhere in this window.
        </p>
        <div class={`reader-welcome-dropzone ${props.isDragging() ? 'dragging' : ''}`}>
          Drop files here to import them instantly
        </div>
        <div class="reader-welcome-grid">
          <div class="reader-welcome-tip">
            <h3>Shape your view</h3>
            <p>Switch between single and double page layouts with the selectors above to match manga spreads or textbook pages.</p>
          </div>
          <div class="reader-welcome-tip">
            <h3>Summon OCR magic</h3>
            <p>Once a page is visible, trigger OCR to hover words, peek at translations, and build flashcards as you read.</p>
          </div>
          <div class="reader-welcome-tip">
            <h3>Never lose your place</h3>
            <p>We will keep your book title and page progress in the header so you always know where to dive back in.</p>
          </div>
        </div>
        <p class="reader-welcome-footer">Drop something in to begin — this welcome screen will make room for your story.</p>
      </div>
    </div>
  );
};

export default ReaderWelcomeCard;
