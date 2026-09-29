/**
 * Hooks Index
 * Export all custom hooks for the application
 */

// Media
export { useVideo, useVideoKeyboard } from './useVideo';
export { useSubtitles } from './useSubtitles';
export { useOCR, prepareBlobForOCR, sendImageForOCR, assertOcrLanguageDataReady, getOcrLanguageDataReadinessError } from './useOCR';

// Language & Learning
export { 
  useTranslation, 
  useTokenizer, 
  useDictionary, 
  warmTranslationCache,
  isTranslationWarming,
  getCachedTranslation
} from './useTranslation';
export { useWordHover, getGlobalHoverManager } from './useWordHover';
export { useMediaStats } from './useMediaStats';

// UI
export { useCursorVisibility } from './useCursorVisibility';
export { useDismiss } from './useDismiss';
export type { DismissOptions } from './useDismiss';

// Collaboration
export { useWatchTogether } from './useWatchTogether';

export { createVirtualizer } from './useVirtualizer';
export type { VirtualItem, VirtualizerOptions, Virtualizer, VirtualizerScrollOptions } from './useVirtualizer';

// Policy (R20 encounter decision pin)
export { useDecisionPin } from './useDecisionPin';
export type { DecisionPin } from './useDecisionPin';
