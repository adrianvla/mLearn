/**
 * Reader Status Bar Component
 * Bottom status bar with OCR controls
 */

import { Component, Show, Accessor } from 'solid-js';
import { GlassButton } from '../../../../components/common';

interface ReaderStatusBarProps {
  bookTitle: Accessor<string>;
  progressString: Accessor<string>;
  ocrStatus: Accessor<string>;
  ocrProgress: Accessor<number>;
  isProcessingOcr: Accessor<boolean>;
  hasOcrResult: Accessor<boolean>;
  hasPages: Accessor<boolean>;
  onRunOcr: () => void;
}

export const ReaderStatusBar: Component<ReaderStatusBarProps> = (props) => {
  return (
    <footer class="reader-status glass">
      <span class="book-title">{props.bookTitle()}</span>
      <span class="progress">{props.progressString()}</span>
      <div class="ocr-section">
        <Show when={props.isProcessingOcr()}>
          <div class="ocr-progress">
            <div class="bar" style={{ width: `${props.ocrProgress()}%` }} />
          </div>
        </Show>
        <span class="ocr-status">{props.ocrStatus()}</span>
        <GlassButton
          size="sm"
          onClick={props.onRunOcr}
          disabled={props.isProcessingOcr() || !props.hasPages()}
        >
          {props.hasOcrResult() ? 'Re-run OCR' : 'Run OCR'}
        </GlassButton>
      </div>
    </footer>
  );
};

export default ReaderStatusBar;
