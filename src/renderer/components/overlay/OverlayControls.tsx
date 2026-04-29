import { Component, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { useLocalization } from '../../context';
import './OverlayControls.css';

export interface OverlayControlsProps {
  /** Current playback time in seconds */
  currentTime: number;
  /** Total video duration in seconds */
  duration: number;
  /** Whether video state sync is active */
  isConnected: boolean;
  /** Whether subtitles are loaded */
  hasSubtitles: boolean;
  /** Current subtitle offset in seconds */
  subtitleOffset: number;
  /** Called when offset changes (value in seconds) */
  onOffsetChange: (offset: number) => void;
  /** Called to open subtitle file picker */
  onLoadSubtitles: () => void;
  /** Called to close the overlay window */
  onClose: () => void;
  /** Time formatter helper */
  formatTime: (seconds: number) => string;
  /** Callback when interactive state changes (Alt key) */
  onInteractiveChange?: (interactive: boolean) => void;
}

export const OverlayControls: Component<OverlayControlsProps> = (props) => {
  const { t } = useLocalization();
  const [isAltHeld, setIsAltHeld] = createSignal(false);
  const [isHovered, setIsHovered] = createSignal(false);

  const isVisible = () => isAltHeld() || isHovered();

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        setIsAltHeld(true);
        props.onInteractiveChange?.(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsAltHeld(false);
        props.onInteractiveChange?.(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  });

  const handleOffsetDecrease = () => {
    props.onOffsetChange(Math.round((props.subtitleOffset - 0.1) * 10) / 10);
  };

  const handleOffsetIncrease = () => {
    props.onOffsetChange(Math.round((props.subtitleOffset + 0.1) * 10) / 10);
  };

  const offsetMs = () => Math.round(props.subtitleOffset * 1000);

  return (
    <div
      class="overlay-controls-container"
      classList={{ interactive: isAltHeld() }}
    >
      <div
        class="overlay-controls-trigger"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-hidden="true"
      />
      <div
        class="overlay-controls-bar"
        classList={{ visible: isVisible() }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role="toolbar"
        aria-label={t('mlearn.Overlay.ControlsAria')}
      >
        <div class="overlay-controls-left">
          <Show
            when={props.hasSubtitles}
            fallback={
              <span class="overlay-status-text overlay-hint">
                {t('mlearn.Overlay.DropSubtitle')}
              </span>
            }
          >
            <span class="overlay-status-text">
              {props.formatTime(props.currentTime)} / {props.formatTime(props.duration)}
            </span>
          </Show>
        </div>

        <div class="overlay-controls-center">
          <div class="overlay-offset-control">
            <button
              type="button"
              class="overlay-offset-btn"
              onClick={handleOffsetDecrease}
              aria-label={t('mlearn.Overlay.DecreaseOffset')}
              title={t('mlearn.Overlay.DecreaseOffset')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <span
              class="overlay-offset-value"
              title={t('mlearn.Overlay.OffsetTooltip')}
            >
              {offsetMs() >= 0 ? '+' : ''}
              {offsetMs()}ms
            </span>
            <button
              type="button"
              class="overlay-offset-btn"
              onClick={handleOffsetIncrease}
              aria-label={t('mlearn.Overlay.IncreaseOffset')}
              title={t('mlearn.Overlay.IncreaseOffset')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
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
            aria-label={
              props.isConnected
                ? t('mlearn.Overlay.SyncActive')
                : t('mlearn.Overlay.SyncInactive')
            }
            role="status"
          />
          <button
            type="button"
            class="overlay-load-btn"
            onClick={props.onLoadSubtitles}
          >
            {t('mlearn.Overlay.LoadSubtitles')}
          </button>
          <button
            type="button"
            class="overlay-close-btn"
            onClick={props.onClose}
            aria-label={t('mlearn.Overlay.Close')}
            title={t('mlearn.Overlay.Close')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
