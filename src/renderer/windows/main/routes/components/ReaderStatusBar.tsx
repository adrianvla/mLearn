/**
 * Reader Status Bar Component
 * Bottom status bar with OCR status and word hover trigger control
 */

import { Component, Accessor, createMemo } from 'solid-js';
import { useSettings, useLocalization } from '../../../../context';
import { formatKeybindDisplay } from '../../../../components/common';
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

export const ReaderStatusBar: Component<ReaderStatusBarProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();

  /** Get label for hover trigger mode - dynamically includes the configured key for key-hover mode */
  const getHoverTriggerLabel = (mode: WordHoverTriggerMode, key: string): string => {
    switch (mode) {
      case 'hover': return t('mlearn.Reader.StatusBar.TriggerHover');
      case 'long-hover': return t('mlearn.Reader.StatusBar.TriggerLongHover');
      case 'key-hover': return t('mlearn.Reader.StatusBar.TriggerKeyHover', { key });
      default: return mode;
    }
  };

  // Combined status that shows all activities
  const displayStatus = createMemo(() => {
    const statuses: string[] = [];

    // OCR status first (primary)
    const ocrStat = props.ocrStatus();
    if (ocrStat && ocrStat !== t('mlearn.Reader.StatusBar.Ready')) {
      statuses.push(ocrStat);
    }

    // Tokenization status
    if (props.isTokenizing?.()) {
      statuses.push(t('mlearn.Reader.StatusBar.Tokenizing'));
    }

    // Translation status
    if (props.isTranslating?.()) {
      statuses.push(t('mlearn.Reader.StatusBar.Translating'));
    }

    return statuses.length > 0 ? statuses.join(' | ') : t('mlearn.Reader.StatusBar.Ready');
  });

  const currentTriggerMode = () => settings.readerWordHoverTrigger ?? 'hover';
  const currentKey = () => settings.readerWordHoverKey ?? 'Shift';

  const handleTriggerModeChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value as WordHoverTriggerMode;
    updateSettings({ readerWordHoverTrigger: value });
  };

  return (
      <footer class="reader-status panel">
        <span class="book-title">{props.bookTitle()}</span>
        <span class="progress">{props.progressString()}</span>

        {/* Word Hover Trigger Mode Select */}
        <div class="hover-trigger-section">
          <label class="hover-trigger-label">{t('mlearn.Reader.StatusBar.ShowTooltipOn')}</label>
          <select
              class="hover-trigger-select"
              value={currentTriggerMode()}
              onChange={handleTriggerModeChange}
              title={t('mlearn.Reader.StatusBar.TriggerTitle')}
          >
            <option value="hover">{getHoverTriggerLabel('hover', currentKey())}</option>
            <option value="long-hover">{getHoverTriggerLabel('long-hover', currentKey())}</option>
            <option value="key-hover">{getHoverTriggerLabel('key-hover', currentKey())}</option>
          </select>
        </div>

        <span class="magnifier-hint">
          {t('mlearn.Reader.StatusBar.MagnifierHint', {key: formatKeybindDisplay(settings.readerMagnifierHotkey ?? 'z', t)})}
        </span>

        <div class="ocr-section">
        <span class={`ocr-status ${displayStatus() !== t('mlearn.Reader.StatusBar.Ready') ? 'active' : ''}`}>
          {displayStatus()}
        </span>
        </div>
      </footer>
  );
};

export default ReaderStatusBar;
