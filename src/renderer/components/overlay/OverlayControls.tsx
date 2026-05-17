import { Component, createSignal, createMemo, Show, onCleanup } from 'solid-js';
import { useLocalization } from '../../context';
import { IconBtn, Panel, SubtitleIcon, FileIcon, ResizeIcon, AutoPositionIcon, BookIcon, ChatIcon, PeopleGroupIcon, TranslateIcon } from '../common';
import { findPreviousSubForSync, findNextSub } from '../subtitle/SubtitleSync';
import './OverlayControls.css';

export interface OverlayControlsProps {
  isConnected: boolean;
  hasSubtitles: boolean;
  showSubtitles: boolean;
  subtitleOffset: number;
  autoPositionEnabled?: boolean;
  showWordSidebar?: boolean;
  showLiveTranslator?: boolean;
  isWatchTogetherActive?: boolean;
  isPlaying?: boolean;
  currentVideoTime?: () => number;
  subtitles?: Array<{ start: number; end: number; text: string }>;
  onOffsetChange: (offset: number) => void;
  onLoadSubtitles: () => void;
  onToggleSubtitles: () => void;
  onClose: () => void;
  onDragStart?: () => void;
  onDragMove?: (deltaX: number, deltaY: number) => void;
  onDragEnd?: () => void;
  onResizeStart?: () => void;
  onResizeMove?: (deltaWidth: number, deltaHeight: number) => void;
  onResizeEnd?: () => void;
  onToggleAutoPosition?: () => void;
  onToggleWordSidebar?: () => void;
  onOpenConversationAgent?: () => void;
  onToggleWatchTogether?: () => void;
  onToggleLiveTranslator?: () => void;
}

export const OverlayControls: Component<OverlayControlsProps> = (props) => {
  const { t } = useLocalization();
  const [isHovered, setIsHovered] = createSignal(false);

  const isVisible = createMemo(() =>
      isHovered() || !props.hasSubtitles || !props.isConnected || props.isPlaying
  );

  const isDimmed = createMemo(() =>
      Boolean(props.isPlaying) && !isHovered() && props.hasSubtitles && props.isConnected
  );

  const handleOffsetDecrease = () => {
    const videoTime = props.currentVideoTime?.() ?? 0;
    const adjustedTime = videoTime + props.subtitleOffset;
    const sub = findPreviousSubForSync(props.subtitles, adjustedTime);
    if (sub) {
      const newOffset = sub.start - videoTime;
      props.onOffsetChange(isNaN(newOffset) ? 0 : Math.round(newOffset * 100) / 100);
    }
  };

  const handleOffsetIncrease = () => {
    const videoTime = props.currentVideoTime?.() ?? 0;
    const adjustedTime = videoTime + props.subtitleOffset;
    const nextSub = findNextSub(props.subtitles, adjustedTime);
    if (nextSub) {
      const newOffset = nextSub.start - videoTime;
      props.onOffsetChange(isNaN(newOffset) ? 0 : Math.round(newOffset * 100) / 100);
    }
  };

  const [offsetInputValue, setOffsetInputValue] = createSignal(props.subtitleOffset.toFixed(2));

  createMemo(() => {
    setOffsetInputValue(props.subtitleOffset.toFixed(2));
  });

  const handleOffsetInputChange = (value: string) => {
    setOffsetInputValue(value);
  };

  const applyOffsetInputValue = () => {
    const parsed = parseFloat(offsetInputValue());
    if (!isNaN(parsed)) {
      props.onOffsetChange(parsed);
      setOffsetInputValue(parsed.toFixed(2));
    } else {
      setOffsetInputValue(props.subtitleOffset.toFixed(2));
    }
  };

  const handleOffsetInputKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      applyOffsetInputValue();
    }
  };

  const [isWindowDragging, setIsWindowDragging] = createSignal(false);
  const [isWindowResizing, setIsWindowResizing] = createSignal(false);
  let pendingMoveDeltaX = 0;
  let pendingMoveDeltaY = 0;
  let pendingResizeDeltaW = 0;
  let pendingResizeDeltaH = 0;
  let moveRafId: number | null = null;
  let resizeRafId: number | null = null;

  const flushMoveDelta = () => {
    if (pendingMoveDeltaX !== 0 || pendingMoveDeltaY !== 0) {
      props.onDragMove?.(pendingMoveDeltaX, pendingMoveDeltaY);
      pendingMoveDeltaX = 0;
      pendingMoveDeltaY = 0;
    }
    moveRafId = null;
  };

  const flushResizeDelta = () => {
    if (pendingResizeDeltaW !== 0 || pendingResizeDeltaH !== 0) {
      props.onResizeMove?.(pendingResizeDeltaW, pendingResizeDeltaH);
      pendingResizeDeltaW = 0;
      pendingResizeDeltaH = 0;
    }
    resizeRafId = null;
  };

  const handleBarMouseDown = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a, [role="button"]')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setIsWindowDragging(true);
    props.onDragStart?.();
    window.addEventListener('mousemove', handleDragMouseMove);
    window.addEventListener('mouseup', handleDragMouseUp);
  };

  const handleDragMouseMove = (e: MouseEvent) => {
    if (!isWindowDragging()) return;
    pendingMoveDeltaX += e.movementX;
    pendingMoveDeltaY += e.movementY;
    if (moveRafId === null) {
      moveRafId = requestAnimationFrame(flushMoveDelta);
    }
  };

  const handleDragMouseUp = () => {
    if (!isWindowDragging()) return;
    setIsWindowDragging(false);
    if (moveRafId !== null) {
      cancelAnimationFrame(moveRafId);
      moveRafId = null;
    }
    flushMoveDelta();
    props.onDragEnd?.();
    window.removeEventListener('mousemove', handleDragMouseMove);
    window.removeEventListener('mouseup', handleDragMouseUp);
  };

  const handleResizeMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsWindowResizing(true);
    props.onResizeStart?.();
    window.addEventListener('mousemove', handleResizeMouseMove);
    window.addEventListener('mouseup', handleResizeMouseUp);
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (!isWindowResizing()) return;
    pendingResizeDeltaW += e.movementX;
    pendingResizeDeltaH += e.movementY;
    if (resizeRafId === null) {
      resizeRafId = requestAnimationFrame(flushResizeDelta);
    }
  };

  const handleResizeMouseUp = () => {
    if (!isWindowResizing()) return;
    setIsWindowResizing(false);
    if (resizeRafId !== null) {
      cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    flushResizeDelta();
    props.onResizeEnd?.();
    window.removeEventListener('mousemove', handleResizeMouseMove);
    window.removeEventListener('mouseup', handleResizeMouseUp);
  };

  onCleanup(() => {
    window.removeEventListener('mousemove', handleDragMouseMove);
    window.removeEventListener('mouseup', handleDragMouseUp);
    window.removeEventListener('mousemove', handleResizeMouseMove);
    window.removeEventListener('mouseup', handleResizeMouseUp);
    if (moveRafId !== null) {
      cancelAnimationFrame(moveRafId);
      moveRafId = null;
    }
    if (resizeRafId !== null) {
      cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    flushMoveDelta();
    flushResizeDelta();
  });

  return (
      <div
          class="overlay-controls-container"
          classList={{ interactive: isVisible() }}
      >
        <div
            class="overlay-controls-trigger"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            aria-hidden="true"
        />
        <div
            class="overlay-controls-bar"
            classList={{ visible: isVisible(), dimmed: isDimmed() }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onMouseDown={handleBarMouseDown}
            role="toolbar"
            aria-label={t('mlearn.Overlay.ControlsAria')}
        >
          <Panel variant="default" rounded="none" padding="none" border={false}>
            <div class="overlay-controls-inner">
              <div class="overlay-controls-left">
                <div class="overlay-offset-control">
                  <IconBtn
                      variant="ghost"
                      size="xs"
                      onClick={handleOffsetDecrease}
                      aria-label={t('mlearn.Overlay.DecreaseOffset')}
                      title={t('mlearn.Overlay.DecreaseOffset')}
                      icon="chevron"
                      iconRotation={-90}
                  />
                  <input
                      type="text"
                      class="overlay-offset-input"
                      value={offsetInputValue()}
                      onInput={(e) => handleOffsetInputChange(e.currentTarget.value)}
                      onKeyDown={handleOffsetInputKeyDown}
                      onBlur={applyOffsetInputValue}
                      title={t('mlearn.Overlay.OffsetTooltip')}
                  />
                  <IconBtn
                      variant="ghost"
                      size="xs"
                      onClick={handleOffsetIncrease}
                      aria-label={t('mlearn.Overlay.IncreaseOffset')}
                      title={t('mlearn.Overlay.IncreaseOffset')}
                      icon="chevron"
                      iconRotation={90}
                  />
                </div>
              </div>

              <div class="overlay-controls-right">
              <span
                  class="overlay-sync-indicator"
                  classList={{
                    'sync-connected': props.isConnected,
                    'sync-disconnected': !props.isConnected,
                  }}
                  title={
                    props.isConnected
                        ? t('mlearn.Overlay.SyncActive')
                        : t('mlearn.Overlay.SyncInactive')
                  }
                  role="status"
              />

                <IconBtn
                    variant="ghost"
                    size="sm"
                    active={props.showSubtitles ?? true}
                    class={props.showSubtitles === false ? 'inactive' : ''}
                    onClick={props.onToggleSubtitles}
                    aria-label={t('mlearn.Overlay.ToggleSubtitles')}
                    title={t('mlearn.Overlay.ToggleSubtitles')}
                >
                  <SubtitleIcon />
                </IconBtn>

                <IconBtn
                    variant="ghost"
                    size="sm"
                    onClick={props.onLoadSubtitles}
                    aria-label={t('mlearn.Overlay.LoadSubtitles')}
                    title={t('mlearn.Overlay.LoadSubtitles')}
                >
                  <FileIcon />
                </IconBtn>

                <Show when={props.onToggleWatchTogether}>
                  <IconBtn
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onToggleWatchTogether?.()}
                      aria-label={t('mlearn.Overlay.WatchTogether')}
                      title={t('mlearn.Overlay.WatchTogether')}
                      classList={{ active: props.isWatchTogetherActive }}
                  >
                    <PeopleGroupIcon size={16} />
                  </IconBtn>
                </Show>

                <Show when={props.onToggleLiveTranslator}>
                  <IconBtn
                      variant="ghost"
                      size="sm"
                      active={props.showLiveTranslator !== false}
                      class={props.showLiveTranslator === false ? 'inactive' : ''}
                      onClick={() => props.onToggleLiveTranslator?.()}
                      aria-label={t('mlearn.Overlay.ToggleLiveTranslator')}
                      title={t('mlearn.Overlay.ToggleLiveTranslator')}
                  >
                    <TranslateIcon size={16} active={props.showLiveTranslator !== false} />
                  </IconBtn>
                </Show>

                <Show when={props.onToggleWordSidebar}>
                  <IconBtn
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onToggleWordSidebar?.()}
                      aria-label={t('mlearn.Overlay.ToggleWordSidebar')}
                      title={t('mlearn.Overlay.ToggleWordSidebar')}
                      classList={{ active: props.showWordSidebar }}
                  >
                    <BookIcon size={16} />
                  </IconBtn>
                </Show>

                <Show when={props.onOpenConversationAgent}>
                  <IconBtn
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onOpenConversationAgent?.()}
                      aria-label={t('mlearn.Overlay.OpenConversationAgent')}
                      title={t('mlearn.Overlay.OpenConversationAgent')}
                  >
                    <ChatIcon size={16} />
                  </IconBtn>
                </Show>

                <Show when={props.onToggleAutoPosition}>
                  <IconBtn
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onToggleAutoPosition?.()}
                      aria-label={props.autoPositionEnabled ? t('mlearn.Overlay.DisableAutoPosition') : t('mlearn.Overlay.EnableAutoPosition')}
                      title={props.autoPositionEnabled ? t('mlearn.Overlay.DisableAutoPosition') : t('mlearn.Overlay.EnableAutoPosition')}
                  >
                    <AutoPositionIcon enabled={props.autoPositionEnabled ?? true} />
                  </IconBtn>
                </Show>

                <Show when={props.onResizeStart}>
                  <div
                      class="overlay-resize-handle"
                      onMouseDown={handleResizeMouseDown}
                      title={t('mlearn.Overlay.DragToResize')}
                  >
                    <ResizeIcon />
                  </div>
                </Show>

                <IconBtn
                    variant="ghost"
                    size="sm"
                    onClick={props.onClose}
                    aria-label={t('mlearn.Overlay.Close')}
                    title={t('mlearn.Overlay.Close')}
                    icon="cross"
                />
              </div>
            </div>
          </Panel>
        </div>
      </div>
  );
};
