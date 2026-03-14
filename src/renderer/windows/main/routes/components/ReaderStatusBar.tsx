/**
 * Reader Status Bar Component
 * Bottom status bar with OCR status and word hover trigger control
 */

import { Component, Accessor, createMemo, Show } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../../context';
import { StatusBar, formatKeybindDisplay, RangeInput } from '../../../../components/common';
import type { WordHoverTriggerMode } from '../../../../../shared/constants';
import type { OcrProcessingTimes } from '../../../../components/reader';
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
  onOpenConversationAgent: () => void;
  debugOcr?: Accessor<boolean>;
  onToggleDebugOcr?: () => void;
  lastOcrTiming?: Accessor<OcrProcessingTimes | null>;
  paddleOcrScale?: Accessor<number>;
  onPaddleOcrScaleChange?: (value: number) => void;
  zoneDeltaThreshold?: Accessor<number>;
  onZoneDeltaThresholdChange?: (value: number) => void;
}

export const ReaderStatusBar: Component<ReaderStatusBarProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { currentLangData } = useLanguage();

  /** Get label for hover trigger mode - dynamically includes the configured key for key-hover mode */
  const getHoverTriggerLabel = (mode: WordHoverTriggerMode, key: string): string => {
    switch (mode) {
      case 'hover': return t('mlearn.Reader.StatusBar.TriggerHover');
      case 'long-hover': return t('mlearn.Reader.StatusBar.TriggerLongHover');
      case 'key-hover': return t('mlearn.Reader.StatusBar.TriggerKeyHover', { key: formatKeybindDisplay(key, t) });
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
  const currentKey = () => settings.readerWordHoverKey ?? 'shift';

  const handleTriggerModeChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value as WordHoverTriggerMode;
    updateSettings({ readerWordHoverTrigger: value });
  };

  const isTurbo = () => settings.ocrTurboMode ?? true;
  const isFuriganaDetection = () => settings.ocrFuriganaDetection ?? true;
  const hasFurigana = () => currentLangData()?.hasFurigana ?? false;

  const toggleTurbo = () => {
    updateSettings({ ocrTurboMode: !isTurbo() });
  };

  const toggleFuriganaDetection = () => {
    updateSettings({ ocrFuriganaDetection: !isFuriganaDetection() });
  };

  const timingSummary = createMemo(() => {
    const timing = props.lastOcrTiming?.();
    if (!timing) return '';
    const parts: string[] = [];
    if (timing.detection_ms != null) {
      parts.push(`${t('mlearn.Reader.StatusBar.TimingDetection')}: ${timing.detection_engine ?? '?'} ${timing.detection_ms.toFixed(0)}ms`);
    }
    if (timing.recognition_ms != null) {
      parts.push(`${t('mlearn.Reader.StatusBar.TimingRecognition')}: ${timing.recognition_engine ?? '?'} ${timing.recognition_ms.toFixed(0)}ms`);
    }
    if (timing.per_box_ms && timing.per_box_ms.length > 0) {
      const avg = timing.per_box_ms.reduce((a, b) => a + b, 0) / timing.per_box_ms.length;
      parts.push(`${t('mlearn.Reader.StatusBar.TimingPerBox')}: ${avg.toFixed(0)}ms (×${timing.per_box_ms.length})`);
    }
    parts.push(`${t('mlearn.Reader.StatusBar.TimingTotal')}: ${timing.total_ms.toFixed(0)}ms`);
    return parts.join(' | ');
  });

  return (
      <StatusBar class="reader-status">
        <span class="statusbar-text truncate">{props.bookTitle()}</span>
        <span class="statusbar-text">{props.progressString()}</span>

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

        {/* OCR Toggle Labels */}
        <div class="statusbar-toggles">
          <button
            class="statusbar-toggle"
            onClick={props.onOpenConversationAgent}
            title={t('mlearn.Reader.StatusBar.OpenConversationAgentTitle')}
          >
            {t('mlearn.Reader.StatusBar.OpenConversationAgent')}
          </button>
          <Show when={settings.ocrEnabled}>
            <button
              class="statusbar-toggle"
              classList={{ 'active': isTurbo() }}
              onClick={toggleTurbo}
              title={t('mlearn.Settings.Reader.OcrSettings.TurboMode.Description')}
            >
              {isTurbo()
                ? t('mlearn.Reader.StatusBar.TurboModeOn')
                : t('mlearn.Reader.StatusBar.TurboModeOff')}
            </button>
          </Show>
          <Show when={settings.ocrEnabled && hasFurigana()}>
            <button
              class="statusbar-toggle"
              classList={{ 'active': isFuriganaDetection() }}
              onClick={toggleFuriganaDetection}
              title={t('mlearn.Settings.Reader.OcrSettings.FuriganaDetection.Description')}
            >
              {isFuriganaDetection()
                ? t('mlearn.Reader.StatusBar.FuriganaDetectionOn')
                : t('mlearn.Reader.StatusBar.FuriganaDetectionOff')}
            </button>
          </Show>
          <Show when={(settings.devMode || import.meta.env.DEV) && settings.ocrEnabled && props.debugOcr && props.onToggleDebugOcr}>
            <button
              class="statusbar-toggle"
              classList={{ 'active': props.debugOcr!() }}
              onClick={() => props.onToggleDebugOcr!()}
              title={t('mlearn.Reader.StatusBar.DebugOverlayTitle')}
            >
              {props.debugOcr!()
                ? t('mlearn.Reader.StatusBar.DebugOverlayOn')
                : t('mlearn.Reader.StatusBar.DebugOverlayOff')}
            </button>
          </Show>
          <Show when={(settings.devMode || import.meta.env.DEV) && settings.ocrEnabled && !isTurbo() && props.paddleOcrScale && props.onPaddleOcrScaleChange}>
            <div class="paddle-downscale-section" title={t('mlearn.Reader.StatusBar.PaddleDownscaleTitle')}>
              <span class="paddle-downscale-label">
                {t('mlearn.Reader.StatusBar.PaddleDownscaleLabel', { value: String(props.paddleOcrScale!()) })}
              </span>
              <RangeInput
                min={10}
                max={100}
                step={5}
                value={props.paddleOcrScale!()}
                onChange={props.onPaddleOcrScaleChange!}
                class="paddle-downscale-slider"
              />
            </div>
          </Show>
          <Show when={(settings.devMode || import.meta.env.DEV) && settings.ocrEnabled && props.debugOcr?.() && props.zoneDeltaThreshold && props.onZoneDeltaThresholdChange}>
            <div class="paddle-downscale-section" title={t('mlearn.Reader.StatusBar.ZoneDeltaTitle')}>
              <span class="paddle-downscale-label">
                {t('mlearn.Reader.StatusBar.ZoneDeltaLabel', { value: props.zoneDeltaThreshold!().toFixed(0) })}
              </span>
              <RangeInput
                min={1}
                max={300}
                step={1}
                value={props.zoneDeltaThreshold!()}
                onChange={props.onZoneDeltaThresholdChange!}
                class="paddle-downscale-slider"
              />
            </div>
          </Show>
        </div>

        <span class="statusbar-hint">
          {t('mlearn.Reader.StatusBar.MagnifierHint', {key: formatKeybindDisplay(settings.readerMagnifierHotkey ?? 'z', t)})}
        </span>

        <div class="ocr-section">
        <span class={`statusbar-text ${displayStatus() !== t('mlearn.Reader.StatusBar.Ready') ? 'active' : ''}`}>
          {displayStatus()}
        </span>
        <Show when={settings.devMode && timingSummary()}>
          <span class="statusbar-text ocr-timing">{timingSummary()}</span>
        </Show>
        </div>
      </StatusBar>
  );
};

export default ReaderStatusBar;
