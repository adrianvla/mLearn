/**
 * Word Hover Hook
 * Manages the single hover element for subtitle words
 * This solves the memory leak issue from the old implementation
 */

import { createSignal, onCleanup, onMount } from 'solid-js';
import type { TranslationResponse, Token } from '../../shared/types';

export interface HoverData {
  word: string;
  token: Token | null;
  translation: TranslationResponse | null;
  position: { x: number; y: number };
  element: HTMLElement | null;
}

/**
 * Single hover element manager
 * Instead of creating hover elements for each word, we manage one global hover element
 */
export function useWordHover() {
  const [hoverData, setHoverData] = createSignal<HoverData | null>(null);
  const [isVisible, setIsVisible] = createSignal(false);

  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  const showHover = (data: HoverData) => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
    }
    setHoverData(data);
    setIsVisible(true);
  };

  const hideHover = () => {
    hoverTimeout = setTimeout(() => {
      setIsVisible(false);
      // Delay clearing data for smooth transitions
      setTimeout(() => {
        if (!isVisible()) {
          setHoverData(null);
        }
      }, 200);
    }, 100);
  };

  const cancelHide = () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
  };

  onCleanup(() => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
    }
  });

  return {
    hoverData,
    isVisible,
    showHover,
    hideHover,
    cancelHide,
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
      element: target,
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
