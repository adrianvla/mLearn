/**
 * Pitch Accent Hook
 * Provides pitch accent calculation and rendering utilities
 */

import type { PitchAccentInfo } from '../../shared/types';

// Small kana characters that should follow the previous character's pitch
const SMALL_KANA = new Set([
  'ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ',
  'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ',
  'ゎ', 'ゕ', 'ゖ',
]);

/**
 * Build the pitch pattern array from accent type and reading
 */
function buildAccentPattern(accentType: number, reading: string): boolean[] {
  const chars = Array.from(reading);
  const count = chars.length;
  const pattern: boolean[] = [];

  // Generate initial pattern based on accent type
  for (let i = 0; i < count; i++) {
    switch (accentType) {
      case 0: // Heiban (flat)
        pattern.push(i !== 0);
        break;
      case 1: // Atamadaka (head high)
        pattern.push(i === 0);
        break;
      default: // Nakadaka/Odaka
        pattern.push(i !== 0 && i < accentType);
        break;
    }
  }

  // Adjust for small kana (they follow previous character)
  for (let i = 0; i < count - 1; i++) {
    const nextIndex = i + 1;
    if (pattern[nextIndex] === undefined) break;
    if (pattern[i] === pattern[nextIndex]) continue;
    if (!SMALL_KANA.has(chars[nextIndex])) continue;

    const desiredValue = pattern[nextIndex];
    let shiftIndex = nextIndex;
    
    while (shiftIndex < count && SMALL_KANA.has(chars[shiftIndex])) {
      pattern[shiftIndex] = pattern[i];
      shiftIndex++;
    }
    
    if (shiftIndex < count) {
      pattern[shiftIndex] = desiredValue;
      i = shiftIndex - 1;
    }
  }

  return pattern;
}

/**
 * Get pitch accent info for a word
 */
export function getPitchAccentInfo(accentType: number | undefined | null, reading: string): PitchAccentInfo | null {
  if (accentType === undefined || accentType === null) return null;
  if (typeof reading !== 'string' || reading.length <= 1) return null;

  const pattern = buildAccentPattern(accentType, reading);
  if (pattern.length <= 1) return null;

  return {
    accentType,
    pattern,
    particleAccent: accentType === 0,
    length: pattern.length,
  };
}

export interface PitchAccentHtmlOptions {
  includeParticleBox?: boolean;
  particleMarginPercent?: number;
  padTo?: number;
  homogenous?: boolean;
}

/**
 * Build HTML string for pitch accent visualization
 */
export function buildPitchAccentHtml(info: PitchAccentInfo, realWordLength: number, options: PitchAccentHtmlOptions = {}): string {
  if (!info) return '';

  const { pattern, particleAccent } = info;
  const unitCount = info.length;
  const includeParticleBox = options.includeParticleBox !== false;
  const marginPercent = options.particleMarginPercent ?? (-100 / Math.max(1, unitCount));
  const padTo = options.padTo ?? realWordLength;

  let html = '';

  // Generate boxes for each mora
  for (let i = 0; i < unitCount; i++) {
    const top = !!pattern[i];
    const bottom = !top;
    const left = i >= 1 ? pattern[i - 1] !== pattern[i] : false;
    
    const classes = ['box'];
    if (bottom) classes.push('bottom');
    if (top) classes.push('top');
    if (left) classes.push('left');
    
    html += `<div class="${classes.join(' ')}"></div>`;
  }

  // Add particle box
  if (includeParticleBox) {
    const bottom = !particleAccent;
    const top = particleAccent;
    const prev = unitCount ? pattern[unitCount - 1] : false;
    const left = prev !== particleAccent;
    
    const classes = ['box'];
    if (!options.homogenous) classes.push('particle-box');
    if (bottom) classes.push('bottom');
    if (top) classes.push('top');
    if (left) classes.push('left');
    
    const style = options.homogenous ? '' : ` style="margin-right:${marginPercent}%;"`;
    html += `<div class="${classes.join(' ')}"${style}></div>`;
  }

  // Padding boxes
  if (padTo && padTo > unitCount) {
    for (let i = unitCount; i < padTo; i++) {
      html += '<div class="box"></div>';
    }
  }

  return html;
}

/**
 * Hook for pitch accent functionality
 */
export function usePitchAccent() {
  return {
    getPitchAccentInfo,
    buildPitchAccentHtml,
  };
}
