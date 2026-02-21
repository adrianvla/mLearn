/**
 * Hooks Index
 * Export all custom hooks for the application
 */

// IPC & System
export { useIPC, useIsElectron, useIsTethered, useIPCEvent, useBackendStatus, useDraggableRegion } from './useIPC';

// Media
export { useVideo, useVideoKeyboard, type VideoState } from './useVideo';
export { useSubtitles } from './useSubtitles';
export { useOCR, sendImageForOCR, prepareBlobForOCR, MAX_OCR_AREA_TURBO, MAX_OCR_AREA_ACCURATE } from './useOCR';

// Language & Learning
export { 
  useTranslation, 
  useTokenizer, 
  useDictionary, 
  warmTranslationCache,
  getCachedTranslation,
  getCachedReading 
} from './useTranslation';
export { usePitchAccent, getPitchAccentInfo, buildPitchAccentHtml } from './usePitchAccent';
export type { PitchAccentInfo } from '../../shared/types';
export { useWordHover, getGlobalHoverManager, useWordHoverTarget, type HoverData } from './useWordHover';
export { useAnki } from './useAnki';
export { useMediaStats } from './useMediaStats';
export { useFlashcardTts } from './useFlashcardTts';

// UI
export { useCursorVisibility } from './useCursorVisibility';

// Collaboration
export { useWatchTogether } from './useWatchTogether';
export type { WatchTogetherMessage } from './useWatchTogether';
