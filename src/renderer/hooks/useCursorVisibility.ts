/**
 * Cursor Visibility Hook
 * Hides cursor and UI elements after inactivity
 * Matches legacy app behavior: fade out after 2s of no mouse movement
 */

import { createSignal, onCleanup, onMount } from 'solid-js';

interface CursorVisibilityOptions {
  /** Time in ms before hiding cursor (default: 2000) */
  hideDelay?: number;
  /** Whether to add body.hide-cursor class (default: true) */
  useBodyClass?: boolean;
  /** Element to watch for mouse movement (default: document) */
  target?: HTMLElement | null;
  /** Whether the feature is enabled (default: true) */
  enabled?: boolean;
}

export function useCursorVisibility(options: CursorVisibilityOptions = {}) {
  const {
    hideDelay = 2000,
    useBodyClass = true,
    target = null,
    enabled = true,
  } = options;

  const [isVisible, setIsVisible] = createSignal(true);
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  const showCursor = () => {
    if (!enabled) return;

    // Clear any pending hide timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    // Show cursor
    setIsVisible(true);
    if (useBodyClass) {
      document.body.classList.remove('hide-cursor');
    }

    // Notify main process to show traffic lights
    try {
      const win = window as any;
      if (win.mlearn?.changeTrafficLights) {
        win.mlearn.changeTrafficLights(true);
      }
    } catch (e) {
      console.error(e);
      // Ignore if not available
    }

    // Schedule hide
    hideTimeout = setTimeout(() => {
      if (!enabled) return;
      setIsVisible(false);
      if (useBodyClass) {
        document.body.classList.add('hide-cursor');
      }

      // Notify main process to hide traffic lights
      try {
        const win = window as any;
        if (win.mlearn?.changeTrafficLights) {
          win.mlearn.changeTrafficLights(false);
        }
      } catch (e) {
        console.error(e);
        // Ignore if not available
      }
    }, hideDelay);
  };

  const hideCursor = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    setIsVisible(false);
    if (useBodyClass) {
      document.body.classList.add('hide-cursor');
    }
  };

  const forceShow = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    setIsVisible(true);
    if (useBodyClass) {
      document.body.classList.remove('hide-cursor');
    }
  };

  onMount(() => {
    if (!enabled) return;

    const targetEl = target || document;
    targetEl.addEventListener('mousemove', showCursor);
    targetEl.addEventListener('mousedown', showCursor);
    targetEl.addEventListener('keydown', showCursor);

    // Initial hide after delay
    showCursor();
  });

  onCleanup(() => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }

    const targetEl = target || document;
    targetEl.removeEventListener('mousemove', showCursor);
    targetEl.removeEventListener('mousedown', showCursor);
    targetEl.removeEventListener('keydown', showCursor);

    // Ensure cursor is visible when component unmounts
    if (useBodyClass) {
      document.body.classList.remove('hide-cursor');
    }
  });

  return {
    /** Whether cursor/controls should be visible */
    isVisible,
    /** Manually show cursor and reset timer */
    showCursor,
    /** Manually hide cursor immediately */
    hideCursor,
    /** Force show cursor without auto-hide */
    forceShow,
  };
}
