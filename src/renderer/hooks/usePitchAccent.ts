/**
 * Pitch Accent Hook
 * Re-exports pitch accent utilities from pitchAccent.ts for convenience
 */

import { 
  getPitchAccentInfo, 
  buildPitchAccentHtml, 
  getPitchAccentName,
  type PitchAccentInfo,
  type BuildPitchAccentHtmlOptions 
} from '../utils/pitchAccent';

// Re-export for backwards compatibility
export { getPitchAccentInfo, buildPitchAccentHtml, getPitchAccentName };
export type { PitchAccentInfo };

/** @deprecated Use BuildPitchAccentHtmlOptions from pitchAccent.ts instead */
export type PitchAccentHtmlOptions = BuildPitchAccentHtmlOptions;

/**
 * Hook for pitch accent functionality
 */
export function usePitchAccent() {
  return {
    getPitchAccentInfo,
    buildPitchAccentHtml,
    getPitchAccentName,
  };
}
