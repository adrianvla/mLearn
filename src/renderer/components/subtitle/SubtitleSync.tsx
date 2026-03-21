/**
 * Subtitle Sync Component
 * Allows users to adjust subtitle timing offset
 */

import { Component, createSignal, createEffect, Show } from 'solid-js';
import { useSettings, useLocalization } from '../../context';
import { Panel, PanelHeader, IconBtn } from '../common';
import './SubtitleSync.css';

export interface SubtitleSyncProps {
  /** Called when the sync panel is closed */
  onClose?: () => void;
  /** Current video time for backward/forward sync */
  currentVideoTime?: () => number;
  /** Array of subtitles for finding prev/next */
  subtitles?: Array<{ start: number; end: number; text: string }>;
}

type SubEntry = { start: number; end: number; text: string };

/**
 * Finds the subtitle the user is inside, or the last subtitle that ended
 * before the adjusted time (handles gaps between subtitles).
 */
export function findCurrentOrPreviousSub(
  subs: SubEntry[] | undefined,
  adjustedTime: number,
): SubEntry | null {
  if (!subs || subs.length === 0) return null;

  let lastBefore: SubEntry | null = null;

  for (let i = 0; i < subs.length; i++) {
    if (adjustedTime >= subs[i].start && adjustedTime <= subs[i].end) {
      return subs[i];
    }
    if (subs[i].end <= adjustedTime) {
      lastBefore = subs[i];
    }
  }

  return lastBefore;
}

/**
 * Finds the subtitle strictly before the current adjusted position.
 * If inside a subtitle, returns the one before it (not the current one).
 * If in a gap, returns the last subtitle that ended before this time.
 */
export function findPreviousSubForSync(
  subs: SubEntry[] | undefined,
  adjustedTime: number,
): SubEntry | null {
  if (!subs || subs.length === 0) return null;

  let previousSub: SubEntry | null = null;

  for (let i = 0; i < subs.length; i++) {
    if (adjustedTime >= subs[i].start && adjustedTime <= subs[i].end) {
      break;
    }
    if (subs[i].start > adjustedTime) break;
    previousSub = subs[i];
  }

  return previousSub;
}

export function findNextSub(
  subs: SubEntry[] | undefined,
  adjustedTime: number,
): SubEntry | null {
  if (!subs || subs.length === 0) return null;

  for (let i = 0; i < subs.length; i++) {
    if (subs[i].start > adjustedTime) {
      return subs[i];
    }
  }
  return null;
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

  const handleBackward = () => {
    const videoTime = props.currentVideoTime?.() ?? 0;
    const adjustedTime = videoTime + settings.subsOffsetTime;
    const sub = findPreviousSubForSync(props.subtitles, adjustedTime);

    if (sub) {
      const newOffset = sub.start - videoTime;
      updateSetting('subsOffsetTime', isNaN(newOffset) ? 0 : newOffset);
    }
  };

  const handleForward = () => {
    const videoTime = props.currentVideoTime?.() ?? 0;
    const adjustedTime = videoTime + settings.subsOffsetTime;
    const nextSub = findNextSub(props.subtitles, adjustedTime);

    if (nextSub) {
      const newOffset = nextSub.start - videoTime;
      updateSetting('subsOffsetTime', isNaN(newOffset) ? 0 : newOffset);
    }
  };

  // Handle direct input change
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
        <Panel
            class="subtitle-sync"
            variant="default"
            rounded="lg"
            padding="none"
            border={false}
        >
          <PanelHeader onClose={hide} />
          <div class="subtitle-sync-controls">
            <IconBtn
                class="subtitle-sync-btn backward"
                onClick={handleBackward}
                title={t('mlearn.SubtitleSync.PreviousTooltip')}
                icon="fast-forward"
            />
            <input
                type="text"
                class="subtitle-sync-input"
                value={inputValue()}
                onInput={(e) => handleInputChange(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onBlur={applyInputValue}
            />
            <IconBtn
                class="subtitle-sync-btn"
                onClick={handleForward}
                title={t('mlearn.SubtitleSync.NextTooltip')}
                icon="fast-forward"
            />
          </div>
        </Panel>
      </Show>
  );
};

export default SubtitleSync;
