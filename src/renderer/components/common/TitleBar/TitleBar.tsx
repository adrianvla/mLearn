import { Show, createSignal } from 'solid-js';
import { getBridge } from '@shared/bridges';
import './TitleBar.css';

const isMac = navigator.platform.toLowerCase().includes('mac');

export default function TitleBar() {
  if (isMac) return null;

  const bridge = getBridge();
  const [isMaximized, setIsMaximized] = createSignal(false);

  const handleMinimize = () => {
    bridge.window.minimizeWindow();
  };

  const handleMaximize = () => {
    bridge.window.maximizeWindow();
    setIsMaximized((prev) => !prev);
  };

  const handleClose = () => {
    bridge.window.closeWindow();
  };

  return (
    <div class="title-bar">
      <div class="title-bar-drag-region" />
      <div class="title-bar-controls">
        <button
          type="button"
          class="title-bar-btn title-bar-minimize"
          onClick={handleMinimize}
          aria-label="Minimize"
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          class="title-bar-btn title-bar-maximize"
          onClick={handleMaximize}
          aria-label={isMaximized() ? 'Restore' : 'Maximize'}
          title={isMaximized() ? 'Restore' : 'Maximize'}
        >
          <Show
            when={isMaximized()}
            fallback={
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
              </svg>
            }
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
              <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
            </svg>
          </Show>
        </button>
        <button
          type="button"
          class="title-bar-btn title-bar-close"
          onClick={handleClose}
          aria-label="Close"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
