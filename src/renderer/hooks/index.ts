/**
 * Hooks Index
 * Export all custom hooks for the application
 */

// IPC & System
export { useIPC } from './useIPC';

// Media
export { useVideo, useVideoKeyboard } from './useVideo';
export { useSubtitles } from './useSubtitles';
export { useOCR, prepareBlobForOCR } from './useOCR';

// Language & Learning
export { 
  useTranslation, 
  useTokenizer, 
  useDictionary, 
  warmTranslationCache,
  getCachedTranslation
} from './useTranslation';
export { useWordHover, getGlobalHoverManager } from './useWordHover';
export { useMediaStats } from './useMediaStats';

// UI
export { useCursorVisibility } from './useCursorVisibility';

// Collaboration
export { useWatchTogether } from './useWatchTogether';

export { createVirtualizer } from './useVirtualizer';
export type { VirtualItem, VirtualizerOptions, Virtualizer } from './useVirtualizer';
