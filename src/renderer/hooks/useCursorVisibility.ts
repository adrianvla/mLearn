/**
 * Cursor Visibility Hook
 * Hides cursor and UI elements after inactivity
 * Matches legacy app behavior: fade out after 2s of no mouse movement
 */

import { createSignal, onCleanup, onMount, createEffect } from 'solid-js';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.hooks.useCursorVisibility");

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
  const [isEnabled, setIsEnabled] = createSignal(enabled);
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  // Keep signal in sync with prop changes
  createEffect(() => {
    setIsEnabled(enabled);
  });

  const showCursor = () => {
    if (!isEnabled()) return;

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
      if (window.mlearn?.changeTrafficLights) {
        window.mlearn.changeTrafficLights(true);
      }
    } catch (e) {
      log.error("error", e);
      // Ignore if not available
    }

    // Schedule hide
    hideTimeout = setTimeout(() => {
      if (!isEnabled()) return;
      setIsVisible(false);
      if (useBodyClass) {
        document.body.classList.add('hide-cursor');
      }

      // Notify main process to hide traffic lights
      try {
        if (window.mlearn?.changeTrafficLights) {
          window.mlearn.changeTrafficLights(false);
        }
      } catch (e) {
        log.error("error", e);
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

  // React to enabled changes
  createEffect(() => {
    if (!isEnabled()) {
      forceShow();
    } else {
      showCursor();
    }
  });

  onMount(() => {
    if (!isEnabled()) return;

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
