/**
 * Reader Status Bar Component
 * Bottom status bar with OCR status and word hover trigger control
 */

import { Component, Accessor, createMemo } from 'solid-js';
import { useSettings } from '../../../../context';
import type { WordHoverTriggerMode } from '../../../../../shared/constants';
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

/** Labels for hover trigger modes - language agnostic */
const HOVER_TRIGGER_LABELS: Record<WordHoverTriggerMode, string> = {
  'hover': 'Hover',
  'long-hover': 'Long Hover',
  'key-hover': 'Key + Hover',
};

export const ReaderStatusBar: Component<ReaderStatusBarProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  
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
  
  const currentTriggerMode = () => settings.readerWordHoverTrigger ?? 'hover';
  const currentKey = () => settings.readerWordHoverKey ?? 'Shift';
  
  const handleTriggerModeChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value as WordHoverTriggerMode;
    updateSettings({ readerWordHoverTrigger: value });
  };

  return (
    <footer class="reader-status glass">
      <span class="book-title">{props.bookTitle()}</span>
      <span class="progress">{props.progressString()}</span>
      
      {/* Word Hover Trigger Mode Select */}
      <div class="hover-trigger-section">
        <label class="hover-trigger-label">Select:</label>
        <select 
          class="hover-trigger-select"
          value={currentTriggerMode()}
          onChange={handleTriggerModeChange}
          title="How word hover is triggered"
        >
          <option value="hover">{HOVER_TRIGGER_LABELS['hover']}</option>
          <option value="long-hover">{HOVER_TRIGGER_LABELS['long-hover']}</option>
          <option value="key-hover">{`${currentKey()} + Hover`}</option>
        </select>
      </div>
      
      <div class="ocr-section">
        <span class={`ocr-status ${displayStatus() !== 'Ready' ? 'active' : ''}`}>
          {displayStatus()}
        </span>
      </div>
    </footer>
  );
};

export default ReaderStatusBar;
