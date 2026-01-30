/**
 * Subtitle Sync Component
 * Allows users to adjust subtitle timing offset
 */

import { Component, createSignal, createEffect, Show } from 'solid-js';
import { useSettings, useLocalization } from '../../context';
import { PanelHeader, NavBtn } from '../common';
import './SubtitleSync.css';

export interface SubtitleSyncProps {
  /** Called when the sync panel is closed */
  onClose?: () => void;
  /** Current video time for backward/forward sync */
  currentVideoTime?: () => number;
  /** Array of subtitles for finding prev/next */
  subtitles?: Array<{ start: number; end: number; text: string }>;
}

export const SubtitleSync: Component<SubtitleSyncProps> = (props) => {
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();
  const [isVisible, setIsVisible] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('0.00');

  // Sync input value with settings
  createEffect(() => {
    setInputValue(settings.subsOffsetTime.toFixed(2));
  });

  // Show the sync panel
  const show = () => {
    setIsVisible(true);
    setInputValue(settings.subsOffsetTime.toFixed(2));
  };

  // Hide the sync panel
  const hide = () => {
    setIsVisible(false);
    props.onClose?.();
  };

  // Find the current subtitle based on adjusted time
  const findCurrentSub = (adjustedTime: number) => {
    const subs = props.subtitles;
    if (!subs || subs.length === 0) return null;
    
    for (let i = 0; i < subs.length; i++) {
      if (adjustedTime >= subs[i].start && adjustedTime <= subs[i].end) {
        return subs[i];
      }
    }
    return null;
  };

  // Find the next subtitle after current time
  const findNextSub = (adjustedTime: number) => {
    const subs = props.subtitles;
    if (!subs || subs.length === 0) return null;
    
    for (let i = 0; i < subs.length; i++) {
      if (subs[i].start > adjustedTime) {
        return subs[i];
      }
    }
    return null;
  };

  // Backward sync - align current subtitle start with video time
  const handleBackward = () => {
    const videoTime = props.currentVideoTime?.() ?? 0;
    const adjustedTime = videoTime + settings.subsOffsetTime;
    const currentSub = findCurrentSub(adjustedTime);
    
    if (currentSub) {
      const newOffset = currentSub.start - videoTime;
      updateSetting('subsOffsetTime', isNaN(newOffset) ? 0 : newOffset);
    }
  };

  // Forward sync - align next subtitle start with video time
  const handleForward = () => {
    const videoTime = props.currentVideoTime?.() ?? 0;
    const adjustedTime = videoTime + settings.subsOffsetTime;
    const nextSub = findNextSub(adjustedTime);
    
    if (nextSub) {
      const newOffset = nextSub.start - videoTime;
      updateSetting('subsOffsetTime', isNaN(newOffset) ? 0 : newOffset);
    }
  };

  // Handle direct input change - only update on blur or Enter key
  const handleInputChange = (value: string) => {
    setInputValue(value);
  };

  // Apply the input value to settings
  const applyInputValue = () => {
    const parsed = parseFloat(inputValue());
    if (!isNaN(parsed)) {
      updateSetting('subsOffsetTime', parsed);
      setInputValue(parsed.toFixed(2));
    } else {
      // Reset to current setting value if invalid
      setInputValue(settings.subsOffsetTime.toFixed(2));
    }
  };

  // Handle Enter key to apply changes
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      applyInputValue();
    }
  };

  // Expose show method globally for IPC command
  if (typeof window !== 'undefined') {
    (window as any).mLearnSubtitleSync = { show, hide, isVisible };
  }

  return (
    <Show when={isVisible()}>
      <div class="sync-subs">
        <PanelHeader onClose={hide} />
        <div class="controls">
          <NavBtn class="backward" onClick={handleBackward} title={t('mlearn.SubtitleSync.PreviousTooltip')}>
            <img src="assets/icons/fast-forward.svg" alt={t('mlearn.SubtitleSync.Backward')} />
          </NavBtn>
          <input
            type="text"
            value={inputValue()}
            onInput={(e) => handleInputChange(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onBlur={applyInputValue}
          />
          <NavBtn class="forward" onClick={handleForward} title={t('mlearn.SubtitleSync.NextTooltip')}>
            <img src="assets/icons/fast-forward.svg" alt={t('mlearn.SubtitleSync.Forward')} />
          </NavBtn>
        </div>
      </div>
    </Show>
  );
};

export default SubtitleSync;
