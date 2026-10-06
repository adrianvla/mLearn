/**
 * Word Hover Hook
 * Manages the single hover element for subtitle words
 * This solves the memory leak issue from the old implementation
 */

import { createSignal, onCleanup } from 'solid-js';
import type { TranslationResponse, Token } from '../../shared/types';

export interface HoverData {
  word: string;
  token: Token | null;
  translation: TranslationResponse | null;
  position: { x: number; y: number };
  anchorRect?: DOMRect;
  element: HTMLElement | null;
  /** Source occurrence that owns this lookup, used for once-per-open admission. */
  lookupWord?: string;
  language?: string;
  trackPassiveHover?: boolean;
  /** Context identity separates repeated forms in different authored encounters. */
  contextIdentity?: string;
}

export interface WordHoverLifecycle {
  /** Called when the owning popup actually closes, not when the pointer leaves its source word. */
  onDismiss?: (data: HoverData) => void;
}

/**
 * Single hover element manager
 * Instead of creating hover elements for each word, we manage one global hover element
 */
export function useWordHover(lifecycle: WordHoverLifecycle = {}) {
  const [hoverData, setHoverData] = createSignal<HoverData | null>(null);
  const [isVisible, setIsVisible] = createSignal(false);

  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  let cleanupTimeout: ReturnType<typeof setTimeout> | null = null;
  let activeHover: HoverData | null = null;
  let dismissed = true;
  let admitted = false;

  const sameOccurrence = (left: HoverData, right: HoverData): boolean => (
    left.element !== null
    && left.element === right.element
    && left.token === right.token
    && left.lookupWord === right.lookupWord
    && left.language === right.language
    && left.trackPassiveHover === right.trackPassiveHover
    && left.contextIdentity === right.contextIdentity
  );

  const dismissActiveHover = () => {
    if (!activeHover || dismissed) return;
    dismissed = true;
    lifecycle.onDismiss?.(activeHover);
  };

  const updateHoverPosition = (data: HoverData): boolean => {
    if (!activeHover || dismissed || !isVisible() || !sameOccurrence(activeHover, data)) return false;
    const next = {
      ...activeHover,
      position: data.position,
      anchorRect: data.anchorRect,
    };
    activeHover = next;
    setHoverData(next);
    return true;
  };

  const showHover = (data: HoverData): boolean => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = null;
    if (cleanupTimeout) clearTimeout(cleanupTimeout);

    const isSameOpen = activeHover !== null && !dismissed && sameOccurrence(activeHover, data);
    if (isSameOpen) {
      activeHover = data;
      setHoverData(data);
      setIsVisible(true);
      return false;
    }

    dismissActiveHover();
    activeHover = data;
    dismissed = false;
    admitted = false;
    setHoverData(data);
    setIsVisible(true);
    return true;
  };

  const hideHover = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout); // Ensure single timer
    
    hoverTimeout = setTimeout(() => {
      hoverTimeout = null;
      setIsVisible(false);
      dismissActiveHover();
      // Delay clearing data for smooth transitions
      cleanupTimeout = setTimeout(() => {
        if (!isVisible()) {
          setHoverData(null);
          activeHover = null;
        }
      }, 200);
    }, 50);
  };

  const cancelHide = () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    if (cleanupTimeout) {
      clearTimeout(cleanupTimeout);
      cleanupTimeout = null;
    }
  };

  // Force hide immediately (e.g., when magnifying glass is activated)
  const forceHide = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    if (cleanupTimeout) clearTimeout(cleanupTimeout);
    hoverTimeout = null;
    cleanupTimeout = null;
    dismissActiveHover();
    activeHover = null;
    setIsVisible(false);
    setHoverData(null);
  };

  const admitVisibleReveal = (onAdmit: (data: HoverData) => void): boolean => {
    if (!activeHover || dismissed || !isVisible() || admitted || activeHover.trackPassiveHover === false) return false;
    admitted = true;
    onAdmit(activeHover);
    return true;
  };

  const isCurrentHover = (data: HoverData): boolean => (
    activeHover !== null && !dismissed && isVisible() && sameOccurrence(activeHover, data)
  );

  onCleanup(() => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    if (cleanupTimeout) clearTimeout(cleanupTimeout);
    dismissActiveHover();
    activeHover = null;
  });

  return {
    hoverData,
    isVisible,
    showHover,
    hideHover,
    cancelHide,
    forceHide,
    updateHoverPosition,
    admitVisibleReveal,
    isCurrentHover,
  };
}

/**
 * Global hover context for cross-component hover management
 */
let globalHoverManager: ReturnType<typeof useWordHover> | null = null;

export function getGlobalHoverManager() {
  if (!globalHoverManager) {
    globalHoverManager = useWordHover();
  }
  return globalHoverManager;
}

export function resetGlobalHoverManager() {
  globalHoverManager = null;
}

/**
 * Hook for individual words to register with global hover
 */
export function useWordHoverTarget(
  wordGetter: () => string,
  tokenGetter: () => Token | null,
  translationGetter: () => TranslationResponse | null
) {
  const manager = getGlobalHoverManager();

  const handleMouseEnter = (e: MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    
    manager.showHover({
      word: wordGetter(),
      token: tokenGetter(),
      translation: translationGetter(),
      position: {
        x: rect.left + rect.width / 2,
        y: rect.top,
      },
      anchorRect: rect,
      element: target,
      lookupWord: wordGetter(),
    });
  };

  const handleMouseLeave = () => {
    manager.hideHover();
  };

  return {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
  };
}
