const SMALL_KANA = new Set([
  'ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ',
  'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ',
  'ゎ', 'ゕ', 'ゖ',
]);

export interface JapanesePitchAccentInfo {
  accentType: number;
  pattern: boolean[];
  particleAccent: boolean;
  length: number;
  moraCharCounts: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPitchPositionFromRecord(record: Record<string, unknown>): number | null {
  if (typeof record.position === 'number') {
    return record.position;
  }

  const pitches = record.pitches;
  if (!Array.isArray(pitches) || pitches.length === 0) {
    return null;
  }

  const firstPitch = pitches[0];
  if (!isRecord(firstPitch)) {
    return null;
  }

  return typeof firstPitch.position === 'number' ? firstPitch.position : null;
}

export function extractJapanesePitchAccentPayloadPosition(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractJapanesePitchAccentPayloadPosition(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const directPitch = getPitchPositionFromRecord(value);
  if (directPitch !== null) {
    return directPitch;
  }

  for (const child of Object.values(value)) {
    const found = extractJapanesePitchAccentPayloadPosition(child);
    if (found !== null) {
      return found;
    }
  }

  return null;
}

export function getJapaneseMoraCount(reading: string): number {
  let count = 0;
  for (const ch of reading) {
    if (!SMALL_KANA.has(ch)) {
      count++;
    }
  }
  return count;
}

export function getJapaneseMoraCharCounts(reading: string): number[] {
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
  const moraCount = getJapaneseMoraCount(reading || "");
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

export function getJapanesePitchAccentInfo(accentType: number | undefined | null, reading: string): JapanesePitchAccentInfo | null {
  if (accentType === undefined || accentType === null) return null;
  if (typeof reading !== "string" || reading.length === 0) return null;
  const moraCount = getJapaneseMoraCount(reading);
  if (!Number.isInteger(accentType) || accentType < 0 || accentType > moraCount) return null;
  const pattern = buildAccentPattern(accentType, reading);
  if (pattern.length === 0) return null;
  return {
    accentType,
    pattern,
    particleAccent: accentType === 0,
    length: pattern.length,
    moraCharCounts: getJapaneseMoraCharCounts(reading),
  };
}

export interface BuildJapanesePitchAccentHtmlOptions {
  includeParticleBox?: boolean;
  particleMarginPercent?: number;
  padTo?: number;
  homogenous?: boolean;
}

export function buildJapanesePitchAccentHtml(info: JapanesePitchAccentInfo | null, realWordLength?: number, options: BuildJapanesePitchAccentHtmlOptions = {}): string {
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

export type JapanesePitchAccentCategory =
  | { type: 'heiban' }
  | { type: 'atamadaka' }
  | { type: 'odaka' }
  | { type: 'nakadaka'; dropAfterMora: number };

/**
 * Classify Japanese pitch-accent drop positions without producing user-facing labels.
 * Localized UI text belongs in renderer surfaces, not in this low-level renderer.
 */
export function getJapanesePitchAccentCategory(
  accentType: number | undefined | null,
  moraCount: number,
): JapanesePitchAccentCategory | null {
  if (
    accentType === undefined
    || accentType === null
    || !Number.isInteger(accentType)
    || accentType < 0
    || accentType > moraCount
    || moraCount <= 0
  ) return null;

  switch (accentType) {
    case 0:
      return { type: 'heiban' };
    case 1:
      return { type: 'atamadaka' };
    default:
      if (accentType === moraCount) {
        return { type: 'odaka' };
      }
      return { type: 'nakadaka', dropAfterMora: accentType };
  }
}

export function getJapanesePitchAccentCategoryForReading(
  accentType: number | undefined | null,
  reading: string,
): JapanesePitchAccentCategory | null {
  if (!reading) return null;
  return getJapanesePitchAccentCategory(accentType, getJapaneseMoraCount(reading));
}

export function getJapanesePitchAccentCategoryLabel(
  category: JapanesePitchAccentCategory | null,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!category) return '';
  switch (category.type) {
    case 'heiban':
      return t('mlearn.JapanesePitchAccent.Heiban');
    case 'atamadaka':
      return t('mlearn.JapanesePitchAccent.Atamadaka');
    case 'odaka':
      return t('mlearn.JapanesePitchAccent.Odaka');
    case 'nakadaka':
      return t('mlearn.JapanesePitchAccent.DropAfterMora', { mora: category.dropAfterMora });
  }
}

export function getJapanesePitchAccentCategoryLabelForReading(
  accentType: number | undefined | null,
  reading: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  return getJapanesePitchAccentCategoryLabel(
    getJapanesePitchAccentCategoryForReading(accentType, reading),
    t,
  );
}
