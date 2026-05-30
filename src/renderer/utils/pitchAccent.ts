import type { PitchAccentInfo } from '../../shared/types';
import { SMALL_KANA } from '../../shared/utils/textUtils';

export type { PitchAccentInfo };

/** @deprecated Use SMALL_KANA from shared/utils/textUtils instead */
export const SMALL_KANA_CHARS = SMALL_KANA;

export function getMoraCount(reading: string): number {
  let count = 0;
  for (const ch of reading) {
    if (!SMALL_KANA.has(ch)) {
      count++;
    }
  }
  return count;
}

export function getMoraCharCounts(reading: string): number[] {
  const counts: number[] = [];
  for (const ch of reading) {
    if (SMALL_KANA.has(ch)) {
      if (counts.length > 0) {
        counts[counts.length - 1]++;
      } else {
        counts.push(1);
      }
    } else {
      counts.push(1);
    }
  }
  return counts;
}

function buildAccentPattern(accentType: number, reading: string): boolean[] {
  const chars = Array.from(reading || "");
  const moraCount = getMoraCount(reading || "");
  const pattern: boolean[] = [];
  let charIndex = 0;
  for (let moraIndex = 0; moraIndex < moraCount; moraIndex++) {
    while (charIndex < chars.length && SMALL_KANA.has(chars[charIndex])) {
      charIndex++;
    }
    switch (accentType) {
      case 0:
        pattern.push(moraIndex !== 0);
        break;
      case 1:
        pattern.push(moraIndex === 0);
        break;
      case 2:
        pattern.push(moraIndex === 1);
        break;
      case 3:
        pattern.push(moraIndex !== 0 && moraIndex < moraCount - 1);
        break;
      default:
        pattern.push(moraIndex !== 0 && moraIndex < accentType);
        break;
    }
    charIndex++;
    while (charIndex < chars.length && SMALL_KANA.has(chars[charIndex])) {
      charIndex++;
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
    moraCharCounts: getMoraCharCounts(reading),
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
    const charCount = info.moraCharCounts[i] ?? 1;
    const style = charCount !== 1 ? ` style="flex-grow:${charCount}"` : "";
    html += `<div class="${classString}"${style}></div>`;
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

