import type { PitchAccentInfo } from '../../shared/types';
import { SMALL_KANA } from '../../shared/utils/textUtils';

export type { PitchAccentInfo };

/** @deprecated Use SMALL_KANA from shared/utils/textUtils instead */
export const SMALL_KANA_CHARS = SMALL_KANA;

function buildAccentPattern(accentType: number, reading: string): boolean[] {
  const chars = Array.from(reading || "");
  const count = chars.length;
  const pattern: boolean[] = [];
  for (let i = 0; i < count; i++) {
    switch (accentType) {
      case 0:
        pattern.push(i !== 0);
        break;
      case 1:
        pattern.push(i === 0);
        break;
      case 2:
        pattern.push(i === 1);
        break;
      case 3:
        pattern.push(i !== 0 && i < count - 1);
        break;
      default:
        pattern.push(i !== 0 && i < accentType);
        break;
    }
  }

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

export function getPitchAccentInfo(accentType: number | undefined | null, reading: string): PitchAccentInfo | null {
  if (accentType === undefined || accentType === null) return null;
  if (typeof reading !== "string" || reading.length === 0) return null;
  const pattern = buildAccentPattern(accentType, reading);
  if (pattern.length === 0) return null;
  return {
    accentType,
    pattern,
    particleAccent: accentType === 0,
    length: pattern.length,
  };
}

export interface BuildPitchAccentHtmlOptions {
  includeParticleBox?: boolean;
  particleMarginPercent?: number;
  padTo?: number;
  homogenous?: boolean;
}

export function buildPitchAccentHtml(info: PitchAccentInfo | null, realWordLength?: number, options: BuildPitchAccentHtmlOptions = {}): string {
  if (!info) return "";
  const { pattern, particleAccent } = info;
  const unitCount = info.length ?? pattern.length;
  const includeParticleBox = options.includeParticleBox !== false;
  const marginPercent = options.particleMarginPercent ?? (-100 / Math.max(1, unitCount));
  const padTo = Number.isFinite(options.padTo) ? options.padTo : realWordLength;
  let html = "";

  for (let i = 0; i < unitCount; i++) {
    const top = !!pattern[i];
    const bottom = !top;
    const left = i >= 1 ? pattern[i - 1] !== pattern[i] : false;
    let classString = "box";
    if (bottom) classString += " bottom";
    if (top) classString += " top";
    if (left) classString += " left";
    html += `<div class="${classString}"></div>`;
  }

  if (includeParticleBox) {
    const bottom = !particleAccent;
    const top = particleAccent;
    const prev = unitCount ? pattern[unitCount - 1] : false;
    const left = prev !== particleAccent;
    let classString = `box ${options.homogenous ? '' : 'particle-box'}`;
    if (bottom) classString += " bottom";
    if (top) classString += " top";
    if (left) classString += " left";
    html += `<div class="${classString}" style="margin-right:${marginPercent}%;"></div>`;
  }

  if (padTo && padTo > unitCount) {
    for (let i = unitCount; i < padTo!; i++) {
      html += '<div class="box"></div>';
    }
  }

  return html;
}

/**
 * Get the pitch accent pattern name (heiban, atamadaka, etc.)
 * @param accentType The accent drop position (0 = heiban, 1 = atamadaka, etc.)
 * @param moraCount The number of mora in the word
 * @returns The name of the pitch accent pattern
 */
export function getPitchAccentName(accentType: number | undefined | null, moraCount: number): string {
  if (accentType === undefined || accentType === null || moraCount <= 0) return '';
  
  switch (accentType) {
    case 0:
      return '平板 (Heiban)';
    case 1:
      return '頭高 (Atamadaka)';
    default:
      if (accentType === moraCount) {
        return '尾高 (Odaka)';
      }
      return `中高 (Nakadaka ${accentType})`;
  }
}

