/**
 * Reader Status Bar Component
 * Bottom status bar with OCR controls and progress
 */

import { Component, Show, Accessor, createMemo } from 'solid-js';
import './ReaderStatusBar.css';

interface ReaderStatusBarProps {
  bookTitle: Accessor<string>;
  progressString: Accessor<string>;
  ocrStatus: Accessor<string>;
  ocrProgress: Accessor<number>;
  isProcessingOcr: Accessor<boolean>;
  hasOcrResult: Accessor<boolean>;
  hasPages: Accessor<boolean>;
  isTokenizing?: Accessor<boolean>;
  isTranslating?: Accessor<boolean>;
  onRunOcr: () => void;
}

export const ReaderStatusBar: Component<ReaderStatusBarProps> = (props) => {
  // Show progress when there's any OCR activity (progress > 0 and < 100)
  const showProgress = () => {
    const progress = props.ocrProgress();
    return progress > 0 && progress < 100;
  };

  // Combined status that shows all activities
  const displayStatus = createMemo(() => {
    const statuses: string[] = [];
    
    // OCR status first (primary)
    const ocrStat = props.ocrStatus();
    if (ocrStat && ocrStat !== 'Ready') {
      statuses.push(ocrStat);
    }
    
    // Tokenization status
    if (props.isTokenizing?.()) {
      statuses.push('Tokenizing...');
    }
    
    // Translation status
    if (props.isTranslating?.()) {
      statuses.push('Translating...');
    }
    
    return statuses.length > 0 ? statuses.join(' | ') : 'Ready';
  });

  return (
    <footer class="reader-status glass">
      <span class="book-title">{props.bookTitle()}</span>
      <span class="progress">{props.progressString()}</span>
      <div class="ocr-section">
        <Show when={showProgress()}>
          <div class="ocr-progress-container">
            <div class="ocr-progress">
              <div class="bar" style={{ width: `${props.ocrProgress()}%` }} />
            </div>
            <span class="ocr-progress-text">{Math.round(props.ocrProgress())}%</span>
          </div>
        </Show>
        <span class={`ocr-status ${displayStatus() !== 'Ready' ? 'active' : ''}`}>
          {displayStatus()}
        </span>
      </div>
    </footer>
  );
};

export default ReaderStatusBar;
