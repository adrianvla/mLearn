import type { LanguageData, LanguageScriptProfile, LanguageWordIndexStrategy } from './types';

export type NormalizedScriptCode =
  | 'Arab'
  | 'Armn'
  | 'Beng'
  | 'Bopo'
  | 'Cyrl'
  | 'Deva'
  | 'Ethi'
  | 'Geor'
  | 'Grek'
  | 'Guru'
  | 'Hang'
  | 'Han'
  | 'Hebr'
  | 'Hira'
  | 'Kana'
  | 'Khmr'
  | 'Knda'
  | 'Latn'
  | 'Mlym'
  | 'Mymr'
  | 'Sinh'
  | 'Taml'
  | 'Telu'
  | 'Thai'
  | (string & {});

export interface ResolvedLanguageScriptProfile extends Required<Pick<LanguageScriptProfile, 'acceptedScripts' | 'requiredScripts' | 'wordScriptValidation' | 'allowsRomanization' | 'minWordCodePoints' | 'sttRejectPureScripts' | 'sttNoiseCharacters'>> {
  allowsRomanizedWords: boolean;
  scriptRanges: Record<string, Array<[number, number]>>;
  wordIndexStrategy: Required<LanguageWordIndexStrategy>;
}

const SCRIPT_REGEX: Partial<Record<NormalizedScriptCode, RegExp>> = {
  Arab: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u,
  Armn: /[\u0530-\u058F]/u,
  Beng: /[\u0980-\u09FF]/u,
  Bopo: /[\u3100-\u312F\u31A0-\u31BF]/u,
  Cyrl: /[\u0400-\u04FF\u0500-\u052F]/u,
  Deva: /[\u0900-\u097F]/u,
  Ethi: /[\u1200-\u137F]/u,
  Geor: /[\u10A0-\u10FF\u2D00-\u2D2F]/u,
  Grek: /[\u0370-\u03FF\u1F00-\u1FFF]/u,
  Guru: /[\u0A00-\u0A7F]/u,
  Hang: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/u,
  Han: /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/u,
  Hebr: /[\u0590-\u05FF\uFB1D-\uFB4F]/u,
  Hira: /[\u3040-\u309F]/u,
  Kana: /[\u30A0-\u30FF\u31F0-\u31FF]/u,
  Khmr: /[\u1780-\u17FF]/u,
  Knda: /[\u0C80-\u0CFF]/u,
  Latn: /[\u0041-\u005A\u0061-\u007A\u00C0-\u024F\u1E00-\u1EFF]/u,
  Mlym: /[\u0D00-\u0D7F]/u,
  Mymr: /[\u1000-\u109F]/u,
  Sinh: /[\u0D80-\u0DFF]/u,
  Taml: /[\u0B80-\u0BFF]/u,
  Telu: /[\u0C00-\u0C7F]/u,
  Thai: /[\u0E00-\u0E7F]/u,
};

const dynamicScriptRegexCache = new Map<string, RegExp | null>();

const SCRIPT_ALIASES: Record<string, NormalizedScriptCode[]> = {
  arab: ['Arab'],
  armn: ['Armn'],
  beng: ['Beng'],
  bopo: ['Bopo'],
  cyrl: ['Cyrl'],
  deva: ['Deva'],
  ethi: ['Ethi'],
  geor: ['Geor'],
  grek: ['Grek'],
  guru: ['Guru'],
  hang: ['Hang'],
  han: ['Han'],
  hans: ['Han'],
  hant: ['Han'],
  hebr: ['Hebr'],
  hira: ['Hira'],
  jpan: ['Hira', 'Kana', 'Han'],
  kana: ['Kana'],
  khmr: ['Khmr'],
  knda: ['Knda'],
  kore: ['Hang', 'Han'],
  latn: ['Latn'],
  mlym: ['Mlym'],
  mymr: ['Mymr'],
  sinh: ['Sinh'],
  taml: ['Taml'],
  telu: ['Telu'],
  thai: ['Thai'],
};

const SEGMENTLESS_SCRIPTS = new Set<NormalizedScriptCode>(['Han', 'Hira', 'Kana', 'Bopo', 'Thai', 'Khmr', 'Mymr']);

function scriptsUseSegmentlessText(scripts: readonly string[]): boolean {
  const normalized = normalizeScriptCodes(scripts);
  return normalized.length > 0 && normalized.every((script) => SEGMENTLESS_SCRIPTS.has(script));
}

export function normalizeScriptCodes(scripts: readonly string[] | undefined): NormalizedScriptCode[] {
  if (!scripts) return [];

  const normalized: NormalizedScriptCode[] = [];
  for (const script of scripts) {
    const trimmed = script.trim();
    if (!trimmed) continue;

    const aliases = SCRIPT_ALIASES[trimmed.toLowerCase()];
    if (aliases) {
      for (const alias of aliases) {
        if (!normalized.includes(alias)) normalized.push(alias);
      }
      continue;
    }

    const canonical = /^[A-Za-z]{4}$/.test(trimmed)
      ? `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1).toLowerCase()}`
      : trimmed;
    if (!normalized.includes(canonical)) {
      normalized.push(canonical);
    }
  }
  return normalized;
}

function getScriptRegex(script: NormalizedScriptCode): RegExp | null {
  const staticRegex = SCRIPT_REGEX[script];
  if (staticRegex) return staticRegex;

  const cached = dynamicScriptRegexCache.get(script);
  if (cached !== undefined) return cached;

  if (!/^[A-Za-z_]+$/.test(script)) {
    dynamicScriptRegexCache.set(script, null);
    return null;
  }

  try {
    const regex = new RegExp(`\\p{Script=${script}}`, 'u');
    dynamicScriptRegexCache.set(script, regex);
    return regex;
  } catch {
    dynamicScriptRegexCache.set(script, null);
    return null;
  }
}

function normalizeScriptRanges(scriptRanges: LanguageScriptProfile['scriptRanges'] | undefined): Record<string, Array<[number, number]>> {
  if (!scriptRanges) return {};
  const normalizedRanges: Record<string, Array<[number, number]>> = {};
  for (const [script, ranges] of Object.entries(scriptRanges)) {
    const parsedRanges = ranges.filter(([start, end]) => (
      Number.isInteger(start)
      && Number.isInteger(end)
      && start >= 0
      && end <= 0x10FFFF
      && start <= end
    ));
    if (parsedRanges.length === 0) continue;
    for (const normalizedScript of normalizeScriptCodes([script])) {
      normalizedRanges[normalizedScript] = parsedRanges;
    }
  }
  return normalizedRanges;
}

function hasLettersInCustomScriptRange(
  text: string,
  script: NormalizedScriptCode,
  scriptRanges: Record<string, Array<[number, number]>> | undefined,
): boolean {
  const ranges = scriptRanges?.[script];
  if (!ranges?.length) return false;
  return Array.from(text).some((char) => {
    if (!/\p{L}/u.test(char)) return false;
    const codePoint = char.codePointAt(0);
    return codePoint !== undefined && ranges.some(([start, end]) => start <= codePoint && codePoint <= end);
  });
}

export function hasLettersInScript(
  text: string,
  script: string,
  scriptRanges?: Record<string, Array<[number, number]>>,
): boolean {
  const normalized = normalizeScriptCodes([script]);
  return normalized.some((code) => hasLettersInCustomScriptRange(text, code, scriptRanges) || getScriptRegex(code)?.test(text));
}

export function hasLettersInAnyScript(
  text: string,
  scripts: readonly string[],
  scriptRanges?: Record<string, Array<[number, number]>>,
): boolean {
  return normalizeScriptCodes(scripts).some((script) => hasLettersInScript(text, script, scriptRanges));
}

export function hasLettersInSegmentlessScript(text: string): boolean {
  return Array.from(SEGMENTLESS_SCRIPTS).some((script) => getScriptRegex(script)?.test(text));
}

export function hasOnlyLettersInScripts(
  text: string,
  scripts: readonly string[],
  scriptRanges?: Record<string, Array<[number, number]>>,
): boolean {
  const normalized = normalizeScriptCodes(scripts);
  if (!text || normalized.length === 0) return false;

  let sawLetter = false;
  for (const char of text) {
    if (!/\p{L}/u.test(char)) continue;
    sawLetter = true;
    if (!hasLettersInAnyScript(char, normalized, scriptRanges)) {
      return false;
    }
  }

  return sawLetter;
}

export function getLocaleScriptCodes(language: string): NormalizedScriptCode[] {
  try {
    const locale = new Intl.Locale(language).maximize();
    return normalizeScriptCodes(locale.script ? [locale.script] : []);
  } catch {
    return [];
  }
}

export function getResolvedScriptProfile(language: string, data?: LanguageData | null): ResolvedLanguageScriptProfile {
  const configuredProfile = data?.textProcessing?.scriptProfile;
  const localeScripts = getLocaleScriptCodes(language);
  const acceptedScripts = normalizeScriptCodes(
    configuredProfile?.acceptedScripts?.length
      ? configuredProfile.acceptedScripts
      : localeScripts
  );
  const requiredScripts = normalizeScriptCodes(
    configuredProfile?.requiredScripts?.length ? configuredProfile.requiredScripts : acceptedScripts
  );
  const allowsRomanization = configuredProfile?.allowsRomanization ?? false;
  const scriptRanges = normalizeScriptRanges(configuredProfile?.scriptRanges);
  const usesSegmentlessText = scriptsUseSegmentlessText(acceptedScripts);
  const sttRejectPureScripts = normalizeScriptCodes(
    configuredProfile?.sttRejectPureScripts?.length
      ? configuredProfile.sttRejectPureScripts
      : []
  );
  const configuredStrategy = data?.textProcessing?.wordIndexStrategy;

  return {
    acceptedScripts,
    requiredScripts,
    scriptRanges,
    wordScriptValidation: configuredProfile?.wordScriptValidation ?? 'contains-required',
    allowsRomanization,
    allowsRomanizedWords: configuredProfile?.allowsRomanization === true,
    minWordCodePoints: configuredProfile?.minWordCodePoints ?? (usesSegmentlessText ? 2 : 1),
    sttRejectPureScripts,
    sttNoiseCharacters: configuredProfile?.sttNoiseCharacters ?? [],
    wordIndexStrategy: {
      type: configuredStrategy?.type ?? (usesSegmentlessText ? 'character-containment' : 'whole-expression'),
    },
  };
}

export function scriptProfileUsesSegmentlessText(profile: Pick<ResolvedLanguageScriptProfile, 'acceptedScripts'>): boolean {
  return scriptsUseSegmentlessText(profile.acceptedScripts);
}

export function languageUsesSegmentlessText(language: string, data?: LanguageData | null): boolean {
  return scriptProfileUsesSegmentlessText(getResolvedScriptProfile(language, data));
}

export function isWordInLanguageProfile(word: string, profile: ResolvedLanguageScriptProfile): boolean {
  if (!word) return false;
  if (/^[\d.,;:%$€£¥₩\-–—\s]+$/.test(word)) return false;
  if (/^[^\p{L}\p{N}]+$/u.test(word)) return false;
  if ([...word].length < profile.minWordCodePoints) return false;
  if (!/\p{L}/u.test(word)) return false;
  if (profile.requiredScripts.length === 0) return true;
  if (profile.wordScriptValidation === 'only-accepted' && !hasOnlyLettersInScripts(word, profile.acceptedScripts, profile.scriptRanges)) {
    return false;
  }
  if (profile.allowsRomanizedWords && hasOnlyLettersInScripts(word, ['Latn'])) {
    return true;
  }

  return hasLettersInAnyScript(word, profile.requiredScripts, profile.scriptRanges);
}

export function isValidSttResultForProfile(text: string, profile: ResolvedLanguageScriptProfile): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if ([...trimmed].length === 1) return false;
  if (profile.sttNoiseCharacters.includes(trimmed)) return false;

  const hasLetters = /\p{L}/u.test(trimmed);
  if (!hasLetters) return true;

  const hasAcceptedScript = profile.acceptedScripts.length === 0 || hasLettersInAnyScript(trimmed, profile.acceptedScripts, profile.scriptRanges);
  const hasLatin = hasLettersInScript(trimmed, 'Latn');

  if (!hasAcceptedScript) {
    return profile.allowsRomanization && hasLatin;
  }

  if (profile.sttRejectPureScripts.length > 0) {
    const hasRejectedScript = hasLettersInAnyScript(trimmed, profile.sttRejectPureScripts, profile.scriptRanges);
    const nonRejectedAcceptedScripts = profile.acceptedScripts.filter((script) => !profile.sttRejectPureScripts.includes(script));
    const hasNonRejectedAcceptedScript = hasLettersInAnyScript(trimmed, nonRejectedAcceptedScripts, profile.scriptRanges);
    if (hasRejectedScript && !hasNonRejectedAcceptedScript && !(profile.allowsRomanization && hasLatin)) {
      const rejectedCount = [...trimmed].filter((char) => hasLettersInAnyScript(char, profile.sttRejectPureScripts, profile.scriptRanges)).length;
      if (rejectedCount <= 3) return false;
    }
  }

  return true;
}

export function getWordIndexText(text: string, language: string, data?: LanguageData | null): string {
  const profile = getResolvedScriptProfile(language, data);
  if (profile.wordIndexStrategy.type === 'whole-expression') {
    return text.trim();
  }

  return Array.from(text)
    .filter((char) => hasLettersInAnyScript(char, profile.acceptedScripts, profile.scriptRanges))
    .join('');
}

export function getLanguageDisplayName(code: string, data?: LanguageData | null, displayLocale = 'en'): string {
  if (!code) return '';
  if (data?.name) return data.name;

  try {
    return new Intl.DisplayNames([displayLocale || 'en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}
