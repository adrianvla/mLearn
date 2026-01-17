/**
 * Hooks Index
 * Export all custom hooks for the application
 */

// IPC & System
export { useIPC, useIsElectron, useIsTethered, useIPCEvent, useBackendStatus, useDraggableRegion } from './useIPC';

// Media
export { useVideo, useVideoKeyboard, type VideoState } from './useVideo';
export { useSubtitles } from './useSubtitles';
export { useOCR, sendImageForOCR, prepareBlobForOCR, MAX_OCR_AREA } from './useOCR';

// Language & Learning
export { useTranslation, useTokenizer, useDictionary } from './useTranslation';
export { usePitchAccent, getPitchAccentInfo, buildPitchAccentHtml } from './usePitchAccent';
export type { PitchAccentInfo } from '../../shared/types';
export { useWordHover, getGlobalHoverManager, useWordHoverTarget, type HoverData } from './useWordHover';
export { useLLM } from './useLLM';
export { useAnki } from './useAnki';

// UI
export { useCursorVisibility } from './useCursorVisibility';
