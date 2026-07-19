import { DEFAULT_SETTINGS, type FlashcardContent, type FlashcardProsody, type GrammarMatchConfig, type GrammarPoint, type GrammarTokenMatcher, type InstallOptions, type LanguageData, type LanguageDataMap, type LanguageFrequencyRow, type LanguageLexemeNormalization, type LanguageOcrRuntimeConfig, type LanguagePythonRequirementComponent, type LanguageReadingNormalizerStep, type LanguageTextNormalizerStep, type LanguageTokenizerRuntimeConfig, type Settings, type Token, type WordFrequencyEntry, type WordFrequencyMap } from './types';
import { createProsodyRawPayloadForPosition } from './prosodyPayload';
import { getReadingExtraCharacters, isTextOnlyInScripts, katakanaToHiragana } from './utils/textUtils';
import { getResolvedScriptProfile, hasLettersInAnyScript, hasLettersInScript, scriptProfileUsesSegmentlessText, normalizeScriptCodes } from './languageScriptProfile';

export interface LanguageLexemeIndex {
  normalizedSurfaceToCanonical: Record<string, string>;
  normalizedSurfaceToVariants: Record<string, string[]>;
  readingToCanonical: Record<string, string>;
  readingToVariants: Record<string, string[]>;
}

export interface LanguageFeatureFlags {
  isLogographic: boolean;
  isRTL: boolean;
  usesLatinScript: boolean;
  textDirection: 'ltr' | 'rtl' | 'auto';
}

export interface LanguageTokenizerCapabilities {
  segmentsText: boolean;
  /** How much downstream features can trust token boundaries. Rough segmentation is not morphology. */
  segmentationQuality: 'none' | 'rough' | 'linguistic';
  providesLemmas: boolean;
  providesPartOfSpeech: boolean;
  providesReadings: boolean;
  providesMorphology: boolean;
  allowsRoughFallback: boolean;
}

export interface ResolvedLanguageFrequencyPayload {
  rows: LanguageFrequencyRow[];
  languageData?: LanguageData | null;
}

const LOGOGRAPHIC_SCRIPTS = ['Han'];
const RTL_SCRIPTS = ['Arab', 'Hebr', 'Syrc', 'Thaa'];
const COMPACT_READING_SCRIPTS = ['Hira', 'Kana', 'Bopo'];
const ROUGH_UNSAFE_TOKENIZER_SCRIPTS = ['Han', 'Hira', 'Kana', 'Bopo', 'Thai', 'Khmr', 'Mymr'];
const ROUGH_TOKENIZER_TYPES = ['unicode-word'] as const;
const TOGGLE_CONTROLLED_INSTALL_COMPONENTS = new Set<LanguagePythonRequirementComponent>(['ocr', 'llm', 'voice']);
const COMPACT_SCRIPT_FONT_SCRIPTS = ['Han', 'Hira', 'Kana', 'Bopo'];
const ARABIC_FONT_SCRIPTS = ['Arab'];
const HEBREW_FONT_SCRIPTS = ['Hebr'];
const KOREAN_FONT_SCRIPTS = ['Hang'];
const THAI_FONT_SCRIPTS = ['Thai'];
const CYRILLIC_FONT_SCRIPTS = ['Cyrl'];

interface ReadingLexemeNormalizationConfig {
  enabled: boolean;
  surfaceScripts: string[];
  surfaceNormalizers: LanguageReadingNormalizerStep[];
  readingScripts: string[];
  readingNormalizer: LanguageLexemeNormalization['readingNormalizer'];
  normalizerPresets: Record<string, LanguageReadingNormalizerStep[]>;
  preserveNonPrimaryReadingScript: boolean;
}

type NormalizerStep = LanguageReadingNormalizerStep;
type RoughTokenizerType = typeof ROUGH_TOKENIZER_TYPES[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveLanguageFrequencyPayload(
  languageData?: LanguageData | null,
): ResolvedLanguageFrequencyPayload {
  const rawFreq = languageData?.freq as unknown;
  if (Array.isArray(rawFreq)) {
    return {
      rows: rawFreq as LanguageFrequencyRow[],
      languageData,
    };
  }

  if (isRecord(rawFreq) && Array.isArray(rawFreq.freq)) {
    const frequencyLevels = isRecord(rawFreq.frequencyLevels)
      ? rawFreq.frequencyLevels as LanguageData['frequencyLevels']
      : undefined;
    return {
      rows: rawFreq.freq as LanguageFrequencyRow[],
      languageData: {
        ...languageData,
        freq: rawFreq.freq as LanguageFrequencyRow[],
        frequencyLevels: frequencyLevels ?? languageData?.frequencyLevels,
      } as LanguageData,
    };
  }

  return {
    rows: [],
    languageData,
  };
}

function isRoughTokenizerType(type: unknown): type is RoughTokenizerType {
  return typeof type === 'string' && ROUGH_TOKENIZER_TYPES.includes(type as RoughTokenizerType);
}

function canonicalizeRoughTokenizerType(type: unknown): 'unicode-word' | undefined {
  return isRoughTokenizerType(type) ? type : undefined;
}

function normalizeTokenizerRuntimeConfig(
  tokenizer: LanguageTokenizerRuntimeConfig,
): LanguageTokenizerRuntimeConfig {
  return {
    ...tokenizer,
    type: canonicalizeRoughTokenizerType(tokenizer.type) ?? tokenizer.type,
    fallback: canonicalizeRoughTokenizerType(tokenizer.fallback) ?? tokenizer.fallback,
  };
}

function usesRoughTokenizerOnUnsafeScripts(
  tokenizer: LanguageTokenizerRuntimeConfig,
  acceptedScripts: string[],
): boolean {
  return tokenizer.allowRoughSegmentationForSegmentlessScripts !== true
    && acceptedScripts.length > 0
    && acceptedScripts.every((script) => ROUGH_UNSAFE_TOKENIZER_SCRIPTS.includes(script));
}

const TEXT_NORMALIZER_NAMES = new Set<string>([
  'none',
  'kana-to-hiragana',
  'lowercase',
  'casefold',
  'strip-diacritics',
  'lowercase-strip-diacritics',
  'unicode-nfc',
  'unicode-nfd',
  'unicode-nfkc',
  'unicode-nfkd',
  'remove-arabic-diacritics',
  'remove-tatweel',
]);

const LEXEME_NORMALIZER_PRESETS: Record<string, LanguageTextNormalizerStep[]> = {
  'arabic-script': [
    'unicode-nfkc',
    'remove-tatweel',
    'remove-arabic-diacritics',
  ],
  'persian-arabic': [
    'unicode-nfkc',
    'remove-tatweel',
    'remove-arabic-diacritics',
    {
      type: 'replace-characters',
      map: {
        'ك': 'ک',
        'ي': 'ی',
        'ى': 'ی',
      },
    },
  ],
};

function getPackageNormalizerPresets(data?: LanguageData | null): Record<string, LanguageReadingNormalizerStep[]> {
  return data?.textProcessing?.normalizerPresets ?? {};
}

function getNormalizerPreset(
  name: string,
  packagePresets: Record<string, LanguageReadingNormalizerStep[]>,
): readonly LanguageReadingNormalizerStep[] | undefined {
  return LEXEME_NORMALIZER_PRESETS[name] ?? packagePresets[name];
}

function expandNormalizerSteps(
  normalizers: LanguageReadingNormalizerStep | readonly LanguageReadingNormalizerStep[] | undefined,
  packagePresets: Record<string, LanguageReadingNormalizerStep[]>,
  seen: ReadonlySet<string> = new Set(),
): LanguageReadingNormalizerStep[] {
  const steps = Array.isArray(normalizers) ? normalizers : normalizers ? [normalizers] : [];
  const expanded: LanguageReadingNormalizerStep[] = [];
  for (const step of steps) {
    if (typeof step === 'string' && !TEXT_NORMALIZER_NAMES.has(step)) {
      const preset = getNormalizerPreset(step, packagePresets);
      if (preset && !seen.has(step)) {
        expanded.push(...expandNormalizerSteps(preset, packagePresets, new Set([...seen, step])));
      } else if (!preset) {
        expanded.push(step as LanguageReadingNormalizerStep);
      }
    } else if (typeof step === 'object' && step.type === 'preset') {
      const preset = getNormalizerPreset(step.name, packagePresets);
      if (preset && !seen.has(step.name)) {
        expanded.push(...expandNormalizerSteps(preset, packagePresets, new Set([...seen, step.name])));
      }
    } else {
      expanded.push(step);
    }
  }
  return expanded;
}

function getReadingLexemeNormalizationConfig(data?: LanguageData | null): ReadingLexemeNormalizationConfig {
  const config = data?.textProcessing?.lexemeNormalization;
  const type = config?.type;
  const normalizerPresets = getPackageNormalizerPresets(data);

  if (type === 'identity') {
    return {
      enabled: false,
      surfaceScripts: [],
      surfaceNormalizers: [],
      readingScripts: [],
      readingNormalizer: 'none',
      normalizerPresets,
      preserveNonPrimaryReadingScript: false,
    };
  }

  if (type === 'reading' || type === 'surface-reading') {
    return {
      enabled: true,
      surfaceScripts: normalizeScriptCodes(config?.surfaceScripts),
      surfaceNormalizers: expandNormalizerSteps(config?.surfaceNormalizers, normalizerPresets),
      readingScripts: normalizeScriptCodes(config?.readingScripts),
      readingNormalizer: config?.readingNormalizer ?? 'none',
      normalizerPresets,
      preserveNonPrimaryReadingScript: config?.preserveNonPrimaryReadingScript ?? false,
    };
  }

  if (type === 'surface' || (config?.surfaceNormalizers?.length ?? 0) > 0) {
    return {
      enabled: true,
      surfaceScripts: normalizeScriptCodes(
        config?.surfaceScripts?.length
          ? config.surfaceScripts
          : getResolvedScriptProfile('', data).acceptedScripts,
      ),
      surfaceNormalizers: expandNormalizerSteps(config?.surfaceNormalizers, normalizerPresets),
      readingScripts: [],
      readingNormalizer: 'none',
      normalizerPresets,
      preserveNonPrimaryReadingScript: false,
    };
  }

  return {
    enabled: false,
    surfaceScripts: [],
    surfaceNormalizers: [],
    readingScripts: [],
    readingNormalizer: 'none',
    normalizerPresets,
    preserveNonPrimaryReadingScript: false,
  };
}

export function usesReadingBasedLexemeNormalization(data?: LanguageData | null): boolean {
  return getReadingLexemeNormalizationConfig(data).enabled;
}

function normalizeLexemeReading(reading: string, config: ReadingLexemeNormalizationConfig): string {
  let normalized = reading.trim();
  for (const step of expandNormalizerSteps(config.readingNormalizer, config.normalizerPresets)) {
    normalized = applyTextNormalizer(normalized, step);
  }
  return normalized;
}

function applyTextNormalizer(value: string, step: NormalizerStep): string {
  if (typeof step === 'string') {
    switch (step) {
      case 'none':
        return value;
      case 'kana-to-hiragana':
        return katakanaToHiragana(value);
      case 'lowercase':
        return value.toLocaleLowerCase();
      case 'casefold':
        return value.toLocaleLowerCase().replace(/ß/g, 'ss');
      case 'strip-diacritics':
        return value.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
      case 'lowercase-strip-diacritics':
        return value.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
      case 'unicode-nfc':
        return value.normalize('NFC');
      case 'unicode-nfd':
        return value.normalize('NFD');
      case 'unicode-nfkc':
        return value.normalize('NFKC');
      case 'unicode-nfkd':
        return value.normalize('NFKD');
      case 'remove-arabic-diacritics':
        return value.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu, '');
      case 'remove-tatweel':
        return value.replace(/\u0640/gu, '');
      default:
        return value;
    }
  }

  if (step.type === 'replace-characters') {
    return Array.from(value).map((char) => step.map[char] ?? char).join('');
  }

  if (step.type === 'replace-prefix') {
    if (!step.from || !value.startsWith(step.from)) return value;
    return `${step.to ?? ''}${value.slice(step.from.length)}`;
  }

  if (step.type === 'replace-suffix') {
    if (!step.from || !value.endsWith(step.from)) return value;
    return `${value.slice(0, -step.from.length)}${step.to ?? ''}`;
  }

  return value;
}

function normalizeLexemeSurface(surface: string, config: ReadingLexemeNormalizationConfig): string {
  return config.surfaceNormalizers.reduce((current, step) => applyTextNormalizer(current, step), surface.trim());
}

function getDictionaryLookupNormalizers(data?: LanguageData | null): NormalizerStep[] {
  const lookup = data?.runtime?.nlp?.dictionary?.lookup;
  const packagePresets = getPackageNormalizerPresets(data);
  if (!Array.isArray(lookup?.normalizers)) {
    return getReadingLexemeNormalizationConfig(data).surfaceNormalizers;
  }
  return expandNormalizerSteps(lookup.normalizers, packagePresets);
}

export function getDictionaryLookupCandidates(word: string, data?: LanguageData | null): string[] {
  const raw = word.trim();
  if (!raw) return [];

  const candidates: string[] = [];
  const add = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  add(raw);

  const normalizers = getDictionaryLookupNormalizers(data);
  if (data?.runtime?.nlp?.dictionary?.lookup?.normalizerMode === 'branching') {
    let frontier = [raw];
    for (const step of normalizers) {
      const nextFrontier = [...frontier];
      for (const value of frontier) {
        const normalized = applyTextNormalizer(value, step);
        if (normalized && !nextFrontier.includes(normalized)) {
          nextFrontier.push(normalized);
        }
        add(normalized);
      }
      frontier = nextFrontier;
    }
    return candidates;
  }

  let current = raw;
  for (const step of normalizers) {
    current = applyTextNormalizer(current, step);
    add(current);
  }

  return candidates;
}

function getSurfaceNormalizedLexeme(word: string, config: ReadingLexemeNormalizationConfig): string | null {
  if (config.surfaceNormalizers.length === 0 || !isSurfaceLexeme(word, config)) return null;
  const normalized = normalizeLexemeSurface(word, config);
  return normalized || null;
}

function normalizePartOfSpeechLabel(label: string, caseSensitive: boolean): string {
  const normalized = label.trim();
  return caseSensitive ? normalized : normalized.toLocaleLowerCase();
}

function listIncludesPartOfSpeech(labels: readonly string[], pos: string, caseSensitive: boolean): boolean {
  const normalizedPos = normalizePartOfSpeechLabel(pos, caseSensitive);
  return labels.some((label) => normalizePartOfSpeechLabel(label, caseSensitive) === normalizedPos);
}

function partOfSpeechStartsWithSegment(label: string, segment: string): boolean {
  if (label === segment) return true;
  if (!label.startsWith(segment)) return false;

  const next = label[segment.length];
  return next === '-' || next === ':' || next === '/' || next === '_' || next === ' ' || next === '・';
}

function lookupPartOfSpeechColor(
  pos: string,
  codes: Record<string, string> | undefined,
  data?: LanguageData | null,
): string | undefined {
  if (!codes) return undefined;

  const exact = codes[pos];
  if (exact !== undefined) return exact;

  const canonical = getCanonicalPartOfSpeech(pos, data);
  const canonicalExact = codes[canonical];
  if (canonicalExact !== undefined) return canonicalExact;

  const caseSensitive = data?.textProcessing?.partOfSpeech?.caseSensitive === true;
  if (caseSensitive) return undefined;

  const normalizedPos = normalizePartOfSpeechLabel(pos, false);
  const normalizedCanonical = normalizePartOfSpeechLabel(canonical, false);
  for (const [key, color] of Object.entries(codes)) {
    const normalizedKey = normalizePartOfSpeechLabel(key, false);
    if (
      normalizedKey === normalizedPos
      || normalizedKey === normalizedCanonical
      || partOfSpeechStartsWithSegment(normalizedPos, normalizedKey)
      || partOfSpeechStartsWithSegment(normalizedCanonical, normalizedKey)
    ) {
      return color;
    }
  }

  return undefined;
}

function getConfiguredTranslatablePartOfSpeechTypes(data?: LanguageData | null): string[] | undefined {
  const configured = data?.textProcessing?.partOfSpeech?.translatable;
  if (Array.isArray(configured)) return configured;
  return undefined;
}

export function getCanonicalPartOfSpeech(pos: string, data?: LanguageData | null): string {
  const caseSensitive = data?.textProcessing?.partOfSpeech?.caseSensitive === true;
  const aliases = data?.textProcessing?.partOfSpeech?.aliases ?? {};
  const trimmed = pos.trim();
  if (!trimmed) return trimmed;

  const exact = aliases[trimmed];
  if (exact !== undefined) return exact;
  if (caseSensitive) return trimmed;

  const normalizedPos = normalizePartOfSpeechLabel(trimmed, false);
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (normalizePartOfSpeechLabel(alias, false) === normalizedPos) return canonical;
  }
  return trimmed;
}

export function getTranslatablePartOfSpeechTypes(data?: LanguageData | null): string[] {
  return getConfiguredTranslatablePartOfSpeechTypes(data) ?? [];
}

export function isTranslatablePartOfSpeech(pos: string, data?: LanguageData | null): boolean {
  const caseSensitive = data?.textProcessing?.partOfSpeech?.caseSensitive === true;
  const canonical = getCanonicalPartOfSpeech(pos, data);
  const ignored = data?.textProcessing?.partOfSpeech?.ignored ?? [];
  if (
    listIncludesPartOfSpeech(ignored, pos, caseSensitive)
    || listIncludesPartOfSpeech(ignored, canonical, caseSensitive)
  ) {
    return false;
  }

  const translatable = getConfiguredTranslatablePartOfSpeechTypes(data);
  if (translatable === undefined) return true;
  return listIncludesPartOfSpeech(translatable, pos, caseSensitive)
    || listIncludesPartOfSpeech(translatable, canonical, caseSensitive);
}

export function isTranslatableToken(
  token: Pick<Token, 'word'> & Partial<Pick<Token, 'surface' | 'actual_word' | 'type' | 'partOfSpeech'>>,
  data?: LanguageData | null,
): boolean {
  const text = token.actual_word ?? token.surface ?? token.word ?? '';
  if (!text.trim()) return false;

  const capabilities = getTokenizerCapabilities(data);
  if (!capabilities.providesPartOfSpeech) {
    return true;
  }

  return isTranslatablePartOfSpeech(token.partOfSpeech ?? token.type ?? '', data);
}

export function getPartOfSpeechColor(
  pos: string,
  colourCodes: Record<string, string> | undefined,
  data?: LanguageData | null,
): string | undefined {
  if (!pos.trim()) return undefined;

  return lookupPartOfSpeechColor(pos, colourCodes, data)
    ?? lookupPartOfSpeechColor(pos, data?.textProcessing?.partOfSpeech?.colors, data);
}

function compareGrammarValue(actual: string, expected: string, caseSensitive: boolean): boolean {
  return caseSensitive
    ? actual === expected
    : actual.toLocaleLowerCase() === expected.toLocaleLowerCase();
}

function getGrammarTokenFieldValue(token: Token, matcher: GrammarTokenMatcher): string {
  switch (matcher.field ?? 'word') {
    case 'surface':
      return token.surface ?? token.word ?? '';
    case 'actual_word':
    case 'lemma':
      return token.actual_word ?? token.word ?? '';
    case 'reading':
      return token.reading ?? '';
    case 'type':
      return token.type ?? '';
    case 'partOfSpeech':
      return token.partOfSpeech ?? token.type ?? '';
    case 'word':
    default:
      return token.word ?? '';
  }
}

function grammarMatcherCanUseTokenizerField(
  matcher: GrammarTokenMatcher,
  capabilities: LanguageTokenizerCapabilities,
): boolean {
  if (!capabilities.segmentsText) return false;

  const field = matcher.field ?? 'word';
  if ((field === 'actual_word' || field === 'lemma') && !capabilities.providesLemmas) return false;
  if (field === 'reading' && !capabilities.providesReadings) return false;
  if ((field === 'type' || field === 'partOfSpeech' || matcher.canonicalPartOfSpeech) && !capabilities.providesPartOfSpeech) return false;
  if (matcher.features && !capabilities.providesMorphology) return false;

  return true;
}

function tokenFeatureMatches(
  actual: string | string[] | undefined,
  expected: string | string[],
  caseSensitive: boolean,
): boolean {
  if (actual === undefined) return false;
  const actualValues = Array.isArray(actual) ? actual : [actual];
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  return expectedValues.some((expectedValue) => (
    actualValues.some((actualValue) => compareGrammarValue(String(actualValue), String(expectedValue), caseSensitive))
  ));
}

function grammarTokenMatches(token: Token, matcher: GrammarTokenMatcher, data?: LanguageData | null, caseSensitive = false): boolean {
  const effectiveCaseSensitive = matcher.caseSensitive ?? caseSensitive;

  if (matcher.canonicalPartOfSpeech) {
    const pos = token.partOfSpeech ?? token.type ?? '';
    if (!compareGrammarValue(getCanonicalPartOfSpeech(pos, data), matcher.canonicalPartOfSpeech, effectiveCaseSensitive)) {
      return false;
    }
  }

  if (matcher.features) {
    const tokenFeatures = token.features ?? {};
    for (const [featureName, expectedValue] of Object.entries(matcher.features)) {
      if (!tokenFeatureMatches(tokenFeatures[featureName], expectedValue, effectiveCaseSensitive)) {
        return false;
      }
    }
  }

  const value = getGrammarTokenFieldValue(token, matcher);
  if (matcher.equals !== undefined && !compareGrammarValue(value, matcher.equals, effectiveCaseSensitive)) {
    return false;
  }
  if (matcher.oneOf && !matcher.oneOf.some((expected) => compareGrammarValue(value, expected, effectiveCaseSensitive))) {
    return false;
  }
  if (matcher.regex) {
    try {
      const flags = effectiveCaseSensitive ? 'u' : 'iu';
      if (!new RegExp(matcher.regex, flags).test(value)) return false;
    } catch {
      return false;
    }
  }

  return matcher.canonicalPartOfSpeech !== undefined
    || matcher.features !== undefined
    || matcher.equals !== undefined
    || matcher.oneOf !== undefined
    || matcher.regex !== undefined;
}

function grammarTokenSequenceMatches(tokens: readonly Token[], match: GrammarMatchConfig, data?: LanguageData | null): boolean {
  const matchers = match.tokens ?? [];
  if (matchers.length === 0 || tokens.length < matchers.length) return false;
  const capabilities = getTokenizerCapabilities(data);
  if (!matchers.every((matcher) => grammarMatcherCanUseTokenizerField(matcher, capabilities))) {
    return false;
  }

  for (let start = 0; start <= tokens.length - matchers.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < matchers.length; offset += 1) {
      if (!grammarTokenMatches(tokens[start + offset], matchers[offset], data, match.caseSensitive ?? false)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }

  return false;
}

function grammarTextMatches(fullText: string, point: GrammarPoint, match?: GrammarMatchConfig): boolean {
  const pattern = match?.text ?? point.pattern;
  if (!pattern) return false;
  if (match?.caseSensitive === true) return fullText.includes(pattern);
  return fullText.toLocaleLowerCase().includes(pattern.toLocaleLowerCase());
}

export function grammarPointMatchesTokens(
  point: GrammarPoint,
  tokens: readonly Token[],
  data?: LanguageData | null,
): boolean {
  if (tokens.length === 0) return false;
  const fullText = tokensToPlainText(tokens, data);
  const matches = Array.isArray(point.match) ? point.match : point.match ? [point.match] : [];
  if (matches.length === 0) return grammarTextMatches(fullText, point);

  return matches.some((match) => {
    if ((match.type ?? 'text') === 'token-sequence') {
      return grammarTokenSequenceMatches(tokens, match, data);
    }
    return grammarTextMatches(fullText, point, match);
  });
}

function isSurfaceLexeme(word: string, config: ReadingLexemeNormalizationConfig): boolean {
  return config.surfaceScripts.length > 0 && hasLettersInAnyScript(word, config.surfaceScripts);
}

function isReadingLexeme(word: string, config: ReadingLexemeNormalizationConfig): boolean {
  return config.readingScripts.length > 0 && hasLettersInAnyScript(word, config.readingScripts);
}

export function getReadingScripts(data?: LanguageData | null): string[] {
  return getReadingLexemeNormalizationConfig(data).readingScripts;
}

export function isReadingScriptText(text: string, data?: LanguageData | null): boolean {
  const normalization = getReadingLexemeNormalizationConfig(data);
  return normalization.readingScripts.length > 0
    && isTextOnlyInScripts(text, normalization.readingScripts, getReadingExtraCharacters(data));
}

export function getReadingJoinSeparator(data?: LanguageData | null): string {
  const configured = data?.textProcessing?.readingAnnotation?.readingSeparator;
  if (typeof configured === 'string') return configured;

  const readingScripts = getReadingLexemeNormalizationConfig(data).readingScripts;
  if (readingScripts.length === 0) return '';
  return readingScripts.every((script) => COMPACT_READING_SCRIPTS.includes(script)) ? '' : ' ';
}

export function tokensToReadingText(
  tokens: readonly Pick<Token, 'reading' | 'word'>[],
  data?: LanguageData | null,
): string {
  if (tokens.length === 0) return '';
  const separator = getReadingJoinSeparator(data);
  return tokens.map((token) => token.reading || token.word).join(separator);
}

export function getTokenJoinSeparator(data?: LanguageData | null): string {
  const configured = data?.textProcessing?.tokenJoinSeparator;
  if (typeof configured === 'string') return configured;
  if (!data) return '';

  if (scriptProfileUsesSegmentlessText(getResolvedScriptProfile('', data))) {
    return '';
  }

  return ' ';
}

export function tokensToPlainText(
  tokens: readonly Pick<Token, 'surface' | 'word'>[],
  data?: LanguageData | null,
): string {
  if (tokens.length === 0) return '';
  const separator = getTokenJoinSeparator(data);
  return tokens
    .map((token) => token.surface ?? token.word ?? '')
    .filter(Boolean)
    .join(separator);
}

export function createEmptyLexemeIndex(): LanguageLexemeIndex {
  return {
    normalizedSurfaceToCanonical: {},
    normalizedSurfaceToVariants: {},
    readingToCanonical: {},
    readingToVariants: {},
  };
}

export function buildLexemeIndex(freq: LanguageFrequencyRow[] | undefined, data?: LanguageData | null): LanguageLexemeIndex {
  const normalization = getReadingLexemeNormalizationConfig(data);
  if (!freq?.length || !normalization.enabled) {
    return createEmptyLexemeIndex();
  }

  const readingToCanonical: Record<string, string> = {};
  const readingToVariants: Record<string, string[]> = {};
  const normalizedSurfaceToCanonical: Record<string, string> = {};
  const normalizedSurfaceToVariants: Record<string, string[]> = {};

  for (const entry of freq) {
    if (!entry || entry.length < 2) continue;
    const [word, reading] = entry;
    if (!isSurfaceLexeme(word, normalization)) continue;

    const normalizedSurface = normalizeLexemeSurface(word, normalization);
    if (normalizedSurface) {
      if (!normalizedSurfaceToCanonical[normalizedSurface]) {
        normalizedSurfaceToCanonical[normalizedSurface] = word;
      }
      const surfaceVariants = normalizedSurfaceToVariants[normalizedSurface] ?? [];
      if (!surfaceVariants.includes(word)) {
        surfaceVariants.push(word);
      }
      normalizedSurfaceToVariants[normalizedSurface] = surfaceVariants;
    }

    if (!reading) continue;

    const normalizedReading = normalizeLexemeReading(reading, normalization);
    if (normalizedReading && !readingToCanonical[normalizedReading]) {
      readingToCanonical[normalizedReading] = word;
    }
    if (normalizedReading) {
      const variants = readingToVariants[normalizedReading] ?? [];
      if (!variants.includes(word)) {
        variants.push(word);
      }
      readingToVariants[normalizedReading] = variants;
    }
  }

  return {
    normalizedSurfaceToCanonical,
    normalizedSurfaceToVariants,
    readingToCanonical,
    readingToVariants,
  };
}

export function getFrequencyForLexeme(
  word: string,
  wordFrequency: WordFrequencyMap,
  lexemeIndex: LanguageLexemeIndex,
  data?: LanguageData | null,
): WordFrequencyEntry | null {
  const direct = wordFrequency[word];
  if (direct) return direct;
  const normalization = getReadingLexemeNormalizationConfig(data);
  if (!normalization.enabled) return null;

  if (isSurfaceLexeme(word, normalization)) {
    const canonicalSurface = lexemeIndex.normalizedSurfaceToCanonical[normalizeLexemeSurface(word, normalization)];
    if (canonicalSurface) return wordFrequency[canonicalSurface] || null;
  }

  if (!isReadingLexeme(word, normalization)) return null;

  const normalizedReading = normalizeLexemeReading(word, normalization);
  const canonical = lexemeIndex.readingToCanonical[normalizedReading];
  return canonical ? wordFrequency[canonical] || null : null;
}

export function getCanonicalLexeme(
  word: string,
  wordFrequency: WordFrequencyMap,
  lexemeIndex: LanguageLexemeIndex,
  data?: LanguageData | null,
): string {
  const normalization = getReadingLexemeNormalizationConfig(data);
  if (!word || !normalization.enabled) return word;
  if (wordFrequency[word]) return word;
  if (isSurfaceLexeme(word, normalization)) {
    const normalizedSurface = normalizeLexemeSurface(word, normalization);
    const canonicalSurface = lexemeIndex.normalizedSurfaceToCanonical[normalizedSurface];
    if (canonicalSurface) return canonicalSurface;
    const normalizedFallback = getSurfaceNormalizedLexeme(word, normalization);
    if (normalizedFallback) return normalizedFallback;
  }
  if (!isReadingLexeme(word, normalization)) return word;

  const normalizedReading = normalizeLexemeReading(word, normalization);
  if (normalization.preserveNonPrimaryReadingScript && normalizedReading !== word) return word;

  return lexemeIndex.readingToCanonical[normalizedReading] || word;
}

export function getLexemeVariants(
  word: string,
  wordFrequency: WordFrequencyMap,
  lexemeIndex: LanguageLexemeIndex,
  data?: LanguageData | null,
): string[] {
  if (!word) return [];

  const variants = new Set<string>();
  variants.add(word);

  const canonical = getCanonicalLexeme(word, wordFrequency, lexemeIndex, data);
  if (canonical) variants.add(canonical);

  const normalization = getReadingLexemeNormalizationConfig(data);
  if (normalization.enabled) {
    if (isSurfaceLexeme(word, normalization)) {
      const normalizedSurface = getSurfaceNormalizedLexeme(word, normalization);
      if (normalizedSurface) {
        variants.add(normalizedSurface);
        for (const variant of lexemeIndex.normalizedSurfaceToVariants[normalizedSurface] ?? []) {
          variants.add(variant);
        }
      }
    }

    const freqEntry = wordFrequency[word] || (canonical ? wordFrequency[canonical] : undefined);
    const reading = freqEntry?.reading;
    if (reading) {
      const normalizedReading = normalizeLexemeReading(reading, normalization);
      for (const variant of lexemeIndex.readingToVariants[normalizedReading] ?? []) {
        variants.add(variant);
      }
    }
  }

  return Array.from(variants);
}

export function getLexemeReadingVariants(reading: string, data?: LanguageData | null): string[] {
  const variants = new Set<string>();
  const raw = reading.trim();
  if (!raw) return [''];

  variants.add(raw);

  const normalization = getReadingLexemeNormalizationConfig(data);
  if (normalization.enabled) {
    const normalized = normalizeLexemeReading(raw, normalization);
    if (normalized) variants.add(normalized);
  }

  return Array.from(variants);
}

export function getLanguageFeatureFlags(language: string, data?: LanguageData | null): LanguageFeatureFlags {
  const textDirection = getLanguageTextDirection(data, language);
  const profile = getResolvedScriptProfile(language, data);
  const scripts = profile.acceptedScripts;
  const isLogographic = scripts.some((script) => LOGOGRAPHIC_SCRIPTS.includes(script));
  const isRTL = textDirection === 'rtl';

  const usesLatinScript = scripts.length > 0
    ? scripts.includes('Latn')
    : !isLogographic && !isRTL;

  return {
    isLogographic,
    isRTL,
    usesLatinScript,
    textDirection,
  };
}

export function getOcrRuntimeConfig(data?: LanguageData | null): LanguageOcrRuntimeConfig {
  const configured = data?.runtime?.ocr;
  if (configured && Object.keys(configured).length > 0) return configured;

  return {};
}

function selectedPythonRequirementComponents(options: InstallOptions): LanguagePythonRequirementComponent[] {
  const components: LanguagePythonRequirementComponent[] = ['core'];
  if (options.includeOCR) components.push('ocr');
  if (options.includeLLM) components.push('llm');
  if (options.includeVoice) components.push('voice');
  return components;
}

function isPythonRequirementComponentSelected(
  component: LanguagePythonRequirementComponent,
  selectedComponents: readonly LanguagePythonRequirementComponent[],
): boolean {
  return selectedComponents.includes(component) || !TOGGLE_CONTROLLED_INSTALL_COMPONENTS.has(component);
}

export function getLanguagePythonRequirementsForInstall(
  langData: LanguageDataMap,
  options: InstallOptions,
): string[] {
  const selectedComponents = selectedPythonRequirementComponents(options);
  const packages = new Set<string>();

  for (const data of Object.values(langData)) {
    const packagesByComponent = data.runtime?.python?.packagesByComponent;
    for (const requirement of data.runtime?.python?.packages ?? []) {
      if (requirement.trim()) packages.add(requirement);
    }
    if (packagesByComponent) {
      for (const [component, componentRequirements] of Object.entries(packagesByComponent)) {
        if (!isPythonRequirementComponentSelected(component as LanguagePythonRequirementComponent, selectedComponents)) {
          continue;
        }
        for (const requirement of componentRequirements ?? []) {
          if (requirement.trim()) packages.add(requirement);
        }
      }
    }
  }

  return Array.from(packages).sort();
}

export function getLanguagePythonImportChecksForInstall(
  langData: LanguageDataMap,
  options: InstallOptions,
): string[] {
  const selectedComponents = selectedPythonRequirementComponents(options);
  const imports = new Set<string>();

  for (const data of Object.values(langData)) {
    const importsByComponent = data.runtime?.python?.importChecksByComponent;
    if (!importsByComponent) continue;

    for (const [component, componentImports] of Object.entries(importsByComponent)) {
      if (!isPythonRequirementComponentSelected(component as LanguagePythonRequirementComponent, selectedComponents)) {
        continue;
      }
      for (const moduleName of componentImports ?? []) {
        if (moduleName.trim()) imports.add(moduleName);
      }
    }
  }

  return Array.from(imports).sort();
}

export function ocrRuntimeSupportsRamSaver(data?: LanguageData | null): boolean {
  const ocrConfig = getOcrRuntimeConfig(data);
  if (typeof ocrConfig.supportsRamSaver === 'boolean') return ocrConfig.supportsRamSaver;
  return false;
}

export function ocrRuntimeSupportsVerticalText(data?: LanguageData | null): boolean {
  const ocrConfig = getOcrRuntimeConfig(data);
  if (typeof ocrConfig.supportsVerticalText === 'boolean') return ocrConfig.supportsVerticalText;
  return false;
}

export function languageSupportsCharacterNamePrefixes(data?: LanguageData | null): boolean {
  if (!data) return false;
  const config = data.textProcessing?.subtitle?.characterNamePrefix;
  return Boolean(config && config.enabled !== false);
}

export function languageSupportsDeferentialRegister(data?: LanguageData | null): boolean {
  return data?.conversation?.register?.hasDeferentialForms === true;
}

export function getCasualRegisterPromptGuidelines(data?: LanguageData | null): string[] {
  const configured = data?.conversation?.register?.casualPromptGuidelines;
  return Array.isArray(configured) ? configured : [];
}

export function getRegisterCorrectionPromptGuidelines(data?: LanguageData | null): string[] {
  const configured = data?.conversation?.register?.correctionPromptGuidelines;
  return Array.isArray(configured) ? configured : [];
}

export function getLanguagePromptName(language: string, data?: LanguageData | null): string {
  const name = data?.name?.trim();
  const translatedName = data?.name_translated?.trim();
  const code = language.trim();
  if (name && translatedName && translatedName !== name) return `${name} (${translatedName})`;
  if (name) return name;
  if (translatedName) return translatedName;
  return code || 'the target language';
}

export function getLanguageProsodyType(data?: LanguageData | null): NonNullable<FlashcardProsody['type']> | undefined {
  const prosodyType = data?.prosody?.type;
  return prosodyType && prosodyType !== 'none' ? prosodyType : undefined;
}

export function languageSupportsProsody(data?: LanguageData | null): boolean {
  return Boolean(getLanguageProsodyType(data));
}

export function getProsodyPositionFromContent(
  content?: Pick<FlashcardContent, 'prosody'> | null,
  _data?: LanguageData | null,
): number | undefined {
  return content?.prosody?.position;
}

export function getProsodyDisplayValueFromProsody(prosody?: FlashcardProsody): string | undefined {
  const display = prosody?.display?.trim();
  if (display) return display;
  return prosody?.position !== undefined ? String(prosody.position) : undefined;
}

export function getProsodyDisplayValueFromContent(
  content?: Pick<FlashcardContent, 'prosody'> | null,
  _data?: LanguageData | null,
): string | undefined {
  return getProsodyDisplayValueFromProsody(content?.prosody);
}

export function getProsodyPositionFromOverride(
  overridePosition: number | null | undefined,
  prosody?: FlashcardProsody,
): number | null {
  if (overridePosition !== null && overridePosition !== undefined) return overridePosition;
  if (!prosody) return null;
  return prosody.position ?? null;
}

export { createProsodyRawPayloadForPosition };

export function createProsodyForPosition(
  prosodyType: NonNullable<FlashcardProsody['type']> | undefined,
  position: number,
  existingProsody?: FlashcardProsody,
  raw?: unknown,
  languageData?: LanguageData | null,
): FlashcardProsody | undefined {
  if (!prosodyType || prosodyType === 'none') return undefined;
  return {
    ...existingProsody,
    type: prosodyType,
    position,
    raw: raw ?? existingProsody?.raw ?? createProsodyRawPayloadForPosition(prosodyType, position, languageData),
  };
}

export function clearProsodyPosition(existingProsody?: FlashcardProsody): FlashcardProsody | undefined {
  if (!existingProsody) return undefined;
  const { position: _position, ...prosodyWithoutPosition } = existingProsody;
  return prosodyWithoutPosition;
}

function normalizeConfiguredLabel(label?: string): string | undefined {
  const trimmed = label?.trim();
  return trimmed ? trimmed : undefined;
}

export function getProsodyPositionLabel(data?: LanguageData | null): string | undefined {
  return normalizeConfiguredLabel(data?.prosody?.positionLabel);
}

export function getProsodyPositionPlaceholder(data?: LanguageData | null): string | undefined {
  return normalizeConfiguredLabel(data?.prosody?.positionPlaceholder);
}

export function getProsodyToggleLabel(data?: LanguageData | null): string | undefined {
  return normalizeConfiguredLabel(data?.prosody?.toggleLabel);
}

export function getProsodyToggleDescription(data?: LanguageData | null): string | undefined {
  return normalizeConfiguredLabel(data?.prosody?.toggleDescription);
}

function partOfSpeechMatchesProsodyExclusion(pos: string, excluded: string, data?: LanguageData | null): boolean {
  const caseSensitive = data?.textProcessing?.partOfSpeech?.caseSensitive === true;
  const rawPos = normalizePartOfSpeechLabel(pos, caseSensitive);
  const canonicalPos = normalizePartOfSpeechLabel(getCanonicalPartOfSpeech(pos, data), caseSensitive);
  const excludedPos = normalizePartOfSpeechLabel(excluded, caseSensitive);
  if (data?.prosody?.particleBoxExcludedPosMatch === 'exact') {
    return rawPos === excludedPos || canonicalPos === excludedPos;
  }
  return rawPos.includes(excludedPos) || canonicalPos.includes(excludedPos);
}

export function prosodyPartOfSpeechCanTakeParticleBox(pos: string, data?: LanguageData | null): boolean {
  if (!pos) return true;
  const excludedPos = data?.prosody?.particleBoxExcludedPos ?? [];
  return !excludedPos.some((excluded) => partOfSpeechMatchesProsodyExclusion(pos, excluded, data));
}

export function shouldIncludeProsodyParticleBoxForContext(
  pos: string | undefined,
  nextPos: string | undefined,
  data?: LanguageData | null,
): boolean {
  if (pos && nextPos) {
    if (!prosodyPartOfSpeechCanTakeParticleBox(pos, data) && !prosodyPartOfSpeechCanTakeParticleBox(nextPos, data)) {
      return false;
    }
  }
  if (pos && !prosodyPartOfSpeechCanTakeParticleBox(pos, data)) return false;
  return true;
}

export function resolveCloudOcrEngine(data?: LanguageData | null, turbo = true): string | undefined {
  const ocrConfig = getOcrRuntimeConfig(data);
  if (ocrConfig.recognitionEngine === 'mangaocr') return 'manga-ocr';
  if (ocrConfig.recognitionEngine === 'rapidocr') return 'rapid';
  if (ocrConfig.recognitionEngine) return ocrConfig.recognitionEngine;
  void turbo;
  return undefined;
}

export function isSettingFixedByLanguage(data: LanguageData | null | undefined, key: keyof Settings): boolean {
  const fixedSettings = getLanguageFixedSettings(data);
  return key in fixedSettings;
}

export function getLanguageFixedSettings(data?: LanguageData | null): Partial<Settings> {
  return data?.settings?.fixed ?? {};
}

export function getTokenizerRuntimeConfig(data?: LanguageData | null): LanguageTokenizerRuntimeConfig {
  const configured = data?.runtime?.nlp?.tokenizer;
  const tokenizerSafetyScripts = getResolvedScriptProfile('', data).acceptedScripts;
  if (configured && Object.keys(configured).length > 0) {
    const normalized = normalizeTokenizerRuntimeConfig(configured);
    if (isRoughTokenizerType(configured.type) && usesRoughTokenizerOnUnsafeScripts(configured, tokenizerSafetyScripts)) {
      return {
        type: 'none',
        required: true,
        fallback: 'none',
      };
    }
    if (isRoughTokenizerType(configured.fallback) && usesRoughTokenizerOnUnsafeScripts(configured, tokenizerSafetyScripts)) {
      return {
        ...normalized,
        fallback: 'none',
      };
    }
    return normalized;
  }

  if (tokenizerSafetyScripts.some((script) => ROUGH_UNSAFE_TOKENIZER_SCRIPTS.includes(script))) {
    return {
      type: 'none',
      required: true,
      fallback: 'none',
    };
  }

  return {
    type: 'none',
    required: true,
    fallback: 'none',
  };
}

export function getTokenizerCacheNamespace(data?: LanguageData | null): string | undefined {
  if (!data) return undefined;
  const version = data.languageData?.version ?? 'no-package-version';
  const tokenizer = data.runtime?.nlp?.tokenizer ?? {};
  return `${version}:${JSON.stringify(tokenizer)}`;
}

export function containsLanguageScript(text: string, language: string, data?: LanguageData | null): boolean {
  const profile = getResolvedScriptProfile(language, data);
  return hasLettersInAnyScript(text, profile.acceptedScripts, profile.scriptRanges);
}

export function tokenizerAllowsFallback(data?: LanguageData | null): boolean {
  const tokenizer = getTokenizerRuntimeConfig(data);
  if (tokenizer.type === 'none') return false;
  if (isRoughTokenizerType(tokenizer.type)) return true;
  if (tokenizer.required === true) return false;
  return isRoughTokenizerType(tokenizer.fallback);
}

function getRoughTokenizerClasses(tokenizer: LanguageTokenizerRuntimeConfig): Set<string> {
  const configured = tokenizer.tokenCharacterClasses;
  if (!Array.isArray(configured)) return new Set(['letter', 'number']);
  return new Set(configured.filter((item) => item === 'letter' || item === 'number' || item === 'mark'));
}

function getRoughTokenizerScripts(data: LanguageData | null | undefined, tokenizer: LanguageTokenizerRuntimeConfig): string[] {
  const configured = normalizeScriptCodes(tokenizer.tokenCharacterScripts);
  if (configured.length > 0) return configured;

  const profileScripts = getResolvedScriptProfile('', data).acceptedScripts;
  if (
    tokenizer.acceptsRomanizedInput === true
    && profileScripts.length > 0
    && !profileScripts.includes('Latn')
  ) {
    return [...profileScripts, 'Latn'];
  }
  return profileScripts;
}

function getRoughExtraTokenCharacters(tokenizer: LanguageTokenizerRuntimeConfig): Set<string> {
  const configured = tokenizer.extraTokenCharacters;
  if (!Array.isArray(configured)) return new Set();
  return new Set(configured.filter((item) => typeof item === 'string' && Array.from(item).length === 1));
}

function getRoughInnerTokenCharacters(tokenizer: LanguageTokenizerRuntimeConfig): Set<string> {
  const configured = tokenizer.innerTokenCharacters;
  if (!Array.isArray(configured)) return new Set();
  return new Set(configured.filter((item) => typeof item === 'string' && Array.from(item).length === 1));
}

function isRoughTokenCharacter(
  char: string,
  classes: Set<string>,
  scripts: readonly string[],
  extraCharacters: Set<string>,
  hasOpenToken: boolean,
  scriptRanges?: Record<string, Array<[number, number]>>,
): boolean {
  if (extraCharacters.has(char)) return true;
  if (/\p{L}/u.test(char)) {
    if (!classes.has('letter')) return false;
    return scripts.length === 0 || hasLettersInAnyScript(char, scripts, scriptRanges);
  }
  if (/\p{N}/u.test(char)) return classes.has('number');
  if (/\p{M}/u.test(char)) return hasOpenToken && classes.has('mark');
  return false;
}

function isRoughInnerTokenCharacter(
  char: string,
  nextChar: string | undefined,
  classes: Set<string>,
  scripts: readonly string[],
  extraCharacters: Set<string>,
  innerCharacters: Set<string>,
  hasOpenToken: boolean,
  scriptRanges?: Record<string, Array<[number, number]>>,
): boolean {
  if (!hasOpenToken || !nextChar || !innerCharacters.has(char)) return false;
  return isRoughTokenCharacter(nextChar, classes, scripts, extraCharacters, false, scriptRanges);
}

function getRoughLemmaNormalizers(data: LanguageData | null | undefined, tokenizer: LanguageTokenizerRuntimeConfig): NormalizerStep[] {
  const packagePresets = getPackageNormalizerPresets(data);
  if (Array.isArray(tokenizer.lemmaNormalizers) && tokenizer.lemmaNormalizers.length > 0) {
    return expandNormalizerSteps(tokenizer.lemmaNormalizers, packagePresets);
  }
  const normalizers = [...getReadingLexemeNormalizationConfig(data).surfaceNormalizers];
  if (tokenizer.lowercaseLemma === true) normalizers.push('lowercase');
  return normalizers;
}

function normalizeRoughLemma(word: string, tokenizer: LanguageTokenizerRuntimeConfig, data?: LanguageData | null): string {
  return getRoughLemmaNormalizers(data, tokenizer).reduce((current, step) => applyTextNormalizer(current, step), word);
}

export function createRoughTokenizerTokens(text: string, data?: LanguageData | null): Token[] {
  const tokenizer = getTokenizerRuntimeConfig(data);
  if (!isRoughTokenizerType(tokenizer.type)) return [];
  const classes = getRoughTokenizerClasses(tokenizer);
  const scripts = getRoughTokenizerScripts(data, tokenizer);
  const scriptRanges = getResolvedScriptProfile('', data).scriptRanges;
  const extraCharacters = getRoughExtraTokenCharacters(tokenizer);
  const innerCharacters = getRoughInnerTokenCharacters(tokenizer);
  const tokens: Token[] = [];
  const current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const word = current.join('');
    current.length = 0;
    tokens.push({
      word,
      actual_word: normalizeRoughLemma(word, tokenizer, data),
      type: 'WORD',
      surface: word,
    });
  };

  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    const nextChar = chars[index + 1];
    if (isRoughTokenCharacter(char, classes, scripts, extraCharacters, current.length > 0, scriptRanges)) {
      current.push(char);
    } else if (isRoughInnerTokenCharacter(char, nextChar, classes, scripts, extraCharacters, innerCharacters, current.length > 0, scriptRanges)) {
      current.push(char);
    } else {
      flush();
    }
  }
  flush();

  return tokens;
}

function tokenizerHasDeclaredCapability(
  tokenizer: LanguageTokenizerRuntimeConfig,
  capability: NonNullable<LanguageTokenizerRuntimeConfig['capabilities']>[number],
): boolean | null {
  if (!Array.isArray(tokenizer.capabilities)) return null;
  return tokenizer.capabilities.includes(capability);
}

export function getTokenizerCapabilities(data?: LanguageData | null): LanguageTokenizerCapabilities {
  const tokenizer = getTokenizerRuntimeConfig(data);
  const declared = (capability: NonNullable<LanguageTokenizerRuntimeConfig['capabilities']>[number]) => (
    tokenizerHasDeclaredCapability(tokenizer, capability)
  );
  const declaredSegments = declared('segments');
  const declaredLemmas = declared('lemmas');
  const declaredPartOfSpeech = declared('partOfSpeech');
  const declaredReadings = declared('readings');
  const declaredMorphology = declared('morphology');

  if (isRoughTokenizerType(tokenizer.type)) {
    return {
      segmentsText: true,
      segmentationQuality: 'rough',
      providesLemmas: false,
      providesPartOfSpeech: false,
      providesReadings: false,
      providesMorphology: false,
      allowsRoughFallback: true,
    };
  }

  if (tokenizer.type === 'spacy') {
    const segmentsText = declaredSegments ?? true;
    return {
      segmentsText,
      segmentationQuality: segmentsText ? 'linguistic' : 'none',
      providesLemmas: declaredLemmas ?? true,
      providesPartOfSpeech: declaredPartOfSpeech ?? true,
      providesReadings: declaredReadings ?? false,
      providesMorphology: declaredMorphology ?? true,
      allowsRoughFallback: tokenizerAllowsFallback(data),
    };
  }

  if (tokenizer.type === 'sudachi') {
    const segmentsText = declaredSegments ?? true;
    return {
      segmentsText,
      segmentationQuality: segmentsText ? 'linguistic' : 'none',
      providesLemmas: declaredLemmas ?? true,
      providesPartOfSpeech: declaredPartOfSpeech ?? true,
      providesReadings: declaredReadings ?? true,
      providesMorphology: declaredMorphology ?? false,
      allowsRoughFallback: tokenizerAllowsFallback(data),
    };
  }

  if (tokenizer.type && tokenizer.type !== 'none') {
    const segmentsText = declaredSegments ?? false;
    return {
      segmentsText,
      segmentationQuality: segmentsText ? 'linguistic' : 'none',
      providesLemmas: declaredLemmas ?? false,
      providesPartOfSpeech: declaredPartOfSpeech ?? false,
      providesReadings: declaredReadings ?? false,
      providesMorphology: declaredMorphology ?? false,
      allowsRoughFallback: tokenizerAllowsFallback(data),
    };
  }

  return {
    segmentsText: false,
    segmentationQuality: 'none',
    providesLemmas: false,
    providesPartOfSpeech: false,
    providesReadings: false,
    providesMorphology: declaredMorphology ?? false,
    allowsRoughFallback: false,
  };
}

export function tokenizerAcceptsRomanizedInput(data?: LanguageData | null): boolean {
  return getTokenizerRuntimeConfig(data).acceptsRomanizedInput === true;
}

export function shouldTokenizeTextForLanguage(text: string, language: string, data?: LanguageData | null): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!/\p{L}/u.test(trimmed)) return false;

  const profile = getResolvedScriptProfile(language, data);
  if (profile.acceptedScripts.length === 0) return true;

  if (hasLettersInAnyScript(trimmed, profile.acceptedScripts, profile.scriptRanges)) return true;

  return hasLettersInScript(trimmed, 'Latn') && tokenizerAcceptsRomanizedInput(data);
}

export function getCharacterStudyScripts(data?: LanguageData | null): string[] {
  if (data?.characterStudy?.enabled === false) return [];
  const configuredScripts = normalizeScriptCodes(data?.characterStudy?.scripts);
  if (configuredScripts.length > 0) return configuredScripts;
  return [];
}

export function extractStudyCharacters(text: string, scripts: readonly string[]): string[] {
  if (!text || scripts.length === 0) return [];
  return Array.from(text.normalize('NFC'))
    .filter((character) => /\p{L}/u.test(character) && hasLettersInAnyScript(character, scripts));
}

export function extractUniqueStudyCharacters(text: string, scripts: readonly string[]): string[] {
  return Array.from(new Set(extractStudyCharacters(text, scripts)));
}

export function getCharacterStudyLevelOrder(data?: LanguageData | null): 'ascending' | 'descending' {
  return data?.characterStudy?.levelOrder ?? 'descending';
}

export function shouldShowCharacterStudyLevelDisclaimer(data?: LanguageData | null): boolean {
  return data?.characterStudy?.levelDisclaimer === true;
}

type ReaderPageMode = NonNullable<Settings['readerPageMode']>;
type ReaderSpreadDirectionSetting = NonNullable<Settings['readerSpreadDirection']>;

function resolveLanguageDefaultSetting<T>(
  configured: T | undefined,
  appDefault: T,
  languageDefault: T | undefined,
): T {
  if (languageDefault !== undefined && (configured === undefined || configured === appDefault)) {
    return languageDefault;
  }
  return configured ?? appDefault;
}

export function getReaderPageModeForLanguage(settings: Settings, data?: LanguageData | null): ReaderPageMode {
  return resolveLanguageDefaultSetting(
    settings.readerPageMode,
    DEFAULT_SETTINGS.readerPageMode!,
    data?.reader?.pageMode,
  );
}

export function getReaderSpreadDirectionForLanguage(
  settings: Settings,
  data?: LanguageData | null,
): ReaderSpreadDirectionSetting {
  return resolveLanguageDefaultSetting(
    settings.readerSpreadDirection,
    DEFAULT_SETTINGS.readerSpreadDirection!,
    data?.reader?.spreadDirection,
  );
}

export function getReaderFirstPageSingleForLanguage(settings: Settings, data?: LanguageData | null): boolean {
  return resolveLanguageDefaultSetting(
    settings.readerFirstPageSingle,
    DEFAULT_SETTINGS.readerFirstPageSingle!,
    data?.reader?.firstPageSingle,
  );
}

export function getReaderCollatePagesForLanguage(settings: Settings, data?: LanguageData | null): boolean {
  return resolveLanguageDefaultSetting(
    settings.readerCollatePages,
    DEFAULT_SETTINGS.readerCollatePages!,
    data?.reader?.collatePages,
  );
}

export function getFrequencyLevelDifficulty(data?: LanguageData | null): 'lower-is-harder' | 'higher-is-harder' {
  return data?.frequencyLevels?.difficulty ?? 'lower-is-harder';
}

export function getGrammarLevelDifficulty(data?: LanguageData | null): 'lower-is-harder' | 'higher-is-harder' {
  return data?.grammarLevels?.difficulty ?? getFrequencyLevelDifficulty(data);
}

function formatLevelTemplate(template: string | undefined, level: number): string {
  return (template && template.trim() ? template : 'Level {level}')
    .replace(/\{level\}/g, String(level));
}

export function getFrequencyLevelLabel(
  level: number,
  levelNames?: Record<string | number, string>,
  data?: LanguageData | null,
): string {
  const key = String(level);
  const named = levelNames?.[key] ?? data?.frequencyLevels?.names?.[key];
  if (named) return named;
  if (!Number.isFinite(level) || level < 0 || level === 0) return '';
  return formatLevelTemplate(data?.frequencyLevels?.fallbackLabelTemplate, level);
}

export function isDisplayableFrequencyLevel(
  level: number | null | undefined,
  levelNames?: Record<string | number, string>,
  data?: LanguageData | null,
): level is number {
  if (level === null || level === undefined || !Number.isFinite(level)) return false;
  if (level > 0) return true;
  if (level < 0) return false;

  const key = String(level);
  return Boolean(levelNames?.[key] || data?.frequencyLevels?.names?.[key]);
}

export function getGrammarLevelLabel(
  level: number,
  levelNames?: Record<string | number, string>,
  data?: LanguageData | null,
): string {
  const key = String(level);
  const named = levelNames?.[key] ?? data?.grammarLevels?.names?.[key];
  if (named) return named;
  return formatLevelTemplate(data?.grammarLevels?.fallbackLabelTemplate ?? data?.frequencyLevels?.fallbackLabelTemplate, level);
}

export function getFrequencyLevelDisplayOrder(data?: LanguageData | null): 'ascending' | 'descending' {
  const explicit = data?.frequencyLevels?.displayOrder;
  if (explicit) return explicit;
  return getFrequencyLevelDifficulty(data) === 'lower-is-harder' ? 'descending' : 'ascending';
}

export function getGrammarLevelDisplayOrder(data?: LanguageData | null): 'ascending' | 'descending' {
  const explicit = data?.grammarLevels?.displayOrder;
  if (explicit) return explicit;
  return getGrammarLevelDifficulty(data) === 'lower-is-harder' ? 'descending' : 'ascending';
}

export function compareFrequencyLevelsForDisplay(
  left: number,
  right: number,
  data?: LanguageData | null,
): number {
  return getFrequencyLevelDisplayOrder(data) === 'descending' ? right - left : left - right;
}

export function compareGrammarLevelsForDisplay(
  left: number,
  right: number,
  data?: LanguageData | null,
): number {
  return getGrammarLevelDisplayOrder(data) === 'descending' ? right - left : left - right;
}

export function compareFrequencyLevelsByDifficulty(
  left: number,
  right: number,
  data?: LanguageData | null,
  order: 'easiest-to-hardest' | 'hardest-to-easiest' = 'easiest-to-hardest',
): number {
  const lowerIsHarder = getFrequencyLevelDifficulty(data) === 'lower-is-harder';
  const easiestToHardest = lowerIsHarder ? right - left : left - right;
  return order === 'easiest-to-hardest' ? easiestToHardest : -easiestToHardest;
}

export function compareGrammarLevelsByDifficulty(
  left: number,
  right: number,
  data?: LanguageData | null,
  order: 'easiest-to-hardest' | 'hardest-to-easiest' = 'easiest-to-hardest',
): number {
  const lowerIsHarder = getGrammarLevelDifficulty(data) === 'lower-is-harder';
  const easiestToHardest = lowerIsHarder ? right - left : left - right;
  return order === 'easiest-to-hardest' ? easiestToHardest : -easiestToHardest;
}

export function sortFrequencyLevelsForDisplay(levels: number[], data?: LanguageData | null): number[] {
  return levels
    .filter((level) => Number.isFinite(level))
    .sort((left, right) => compareFrequencyLevelsForDisplay(left, right, data));
}

export function sortGrammarLevelsForDisplay(levels: number[], data?: LanguageData | null): number[] {
  return levels
    .filter((level) => Number.isFinite(level))
    .sort((left, right) => compareGrammarLevelsForDisplay(left, right, data));
}

export function sortFrequencyLevelsByDifficulty(
  levels: number[],
  data?: LanguageData | null,
  order: 'easiest-to-hardest' | 'hardest-to-easiest' = 'easiest-to-hardest',
): number[] {
  return levels
    .filter((level) => Number.isFinite(level))
    .sort((left, right) => compareFrequencyLevelsByDifficulty(left, right, data, order));
}

export function sortGrammarLevelsByDifficulty(
  levels: number[],
  data?: LanguageData | null,
  order: 'easiest-to-hardest' | 'hardest-to-easiest' = 'easiest-to-hardest',
): number[] {
  return levels
    .filter((level) => Number.isFinite(level))
    .sort((left, right) => compareGrammarLevelsByDifficulty(left, right, data, order));
}

export function isFrequencyLevelAtOrEasierThanTarget(
  level: number,
  target: number,
  data?: LanguageData | null,
): boolean {
  if (!Number.isFinite(target)) return true;
  if (target < 0) return true;
  if (target === 0 && !isDisplayableFrequencyLevel(target, undefined, data)) return true;
  if (!isDisplayableFrequencyLevel(level, undefined, data)) return false;
  return getFrequencyLevelDifficulty(data) === 'lower-is-harder'
    ? level >= target
    : level <= target;
}

export function isFrequencyLevelHarderThanTarget(
  level: number,
  target: number,
  data?: LanguageData | null,
): boolean {
  if (!Number.isFinite(target)) return false;
  if (target < 0) return false;
  if (target === 0 && !isDisplayableFrequencyLevel(target, undefined, data)) return false;
  if (!isDisplayableFrequencyLevel(level, undefined, data)) return false;
  return getFrequencyLevelDifficulty(data) === 'lower-is-harder'
    ? level < target
    : level > target;
}

export function selectHarderFrequencyLevel(
  candidate: number,
  current: number | undefined,
  data?: LanguageData | null,
): number {
  if (current === undefined) return candidate;
  return compareFrequencyLevelsByDifficulty(candidate, current, data, 'hardest-to-easiest') < 0
    ? candidate
    : current;
}

export function getFrequencyLevelsAtOrEasierThanTarget(
  levelNames: Record<string, string>,
  target: number | null | undefined,
  data?: LanguageData | null,
): number[] {
  if (target === null || target === undefined) return [];
  return sortFrequencyLevelsForDisplay(Object.keys(levelNames).map(Number), data)
    .filter((level) => (
      isDisplayableFrequencyLevel(level, levelNames, data)
      && isFrequencyLevelAtOrEasierThanTarget(level, target, data)
    ));
}

export function getFrequencyLevelVisualRank(
  level: number,
  levelNames: Record<string, string> | undefined,
  data?: LanguageData | null,
  maxVisualRank = 7,
): number {
  const maxRank = Math.max(1, Math.floor(maxVisualRank));
  const declaredLevels = Object.keys(levelNames ?? {})
    .map(Number)
    .filter((candidate) => Number.isFinite(candidate));

  if (declaredLevels.length === 0 || !declaredLevels.includes(level)) {
    return Math.min(Math.max(Math.round(level || 0), 1), maxRank);
  }

  const levelsHardestToEasiest = sortFrequencyLevelsByDifficulty(declaredLevels, data, 'hardest-to-easiest');
  const index = levelsHardestToEasiest.indexOf(level);
  if (index < 0) {
    return Math.min(Math.max(Math.round(level || 0), 1), maxRank);
  }

  if (levelsHardestToEasiest.length === 1) return maxRank;
  if (levelsHardestToEasiest.length <= maxRank) return index + 1;

  return Math.min(
    maxRank,
    Math.max(1, Math.round(1 + (index / (levelsHardestToEasiest.length - 1)) * (maxRank - 1))),
  );
}

export function getGrammarLevelVisualRank(
  level: number,
  levelNames: Record<string, string> | undefined,
  data?: LanguageData | null,
  maxVisualRank = 7,
): number {
  const maxRank = Math.max(1, Math.floor(maxVisualRank));
  const declaredLevels = Object.keys(levelNames ?? {})
    .map(Number)
    .filter((candidate) => Number.isFinite(candidate));

  if (declaredLevels.length === 0 || !declaredLevels.includes(level)) {
    return Math.min(Math.max(Math.round(level || 0), 1), maxRank);
  }

  const levelsHardestToEasiest = sortGrammarLevelsByDifficulty(declaredLevels, data, 'hardest-to-easiest');
  const index = levelsHardestToEasiest.indexOf(level);
  if (index < 0) {
    return Math.min(Math.max(Math.round(level || 0), 1), maxRank);
  }

  if (levelsHardestToEasiest.length === 1) return maxRank;
  if (levelsHardestToEasiest.length <= maxRank) return index + 1;

  return Math.min(
    maxRank,
    Math.max(1, Math.round(1 + (index / (levelsHardestToEasiest.length - 1)) * (maxRank - 1))),
  );
}

export function getLearningLanguageLevelForLanguage(
  settings: Pick<Settings, 'learningLanguageLevel'> & Partial<Pick<Settings, 'learningLanguageLevels'>>,
  language: string | null | undefined,
): number | null {
  if (language) {
    const configured = settings.learningLanguageLevels?.[language];
    if (configured !== undefined) return configured;
    return null;
  }
  return settings.learningLanguageLevel ?? null;
}

export function getReadingAnnotationScripts(data?: LanguageData | null): string[] {
  const config = data?.textProcessing?.readingAnnotation;
  if (config?.type === 'none') return [];

  const configuredScripts = normalizeScriptCodes(config?.annotationScripts);
  if (configuredScripts.length > 0) return configuredScripts;

  return [];
}

export function getReadingAnnotationDisplay(data?: LanguageData | null): 'ruby' | 'inline' | 'replace' {
  const display = data?.textProcessing?.readingAnnotation?.display;
  if (display === 'replace') return 'replace';
  return display === 'inline' ? 'inline' : 'ruby';
}

export function readingUsesDistinctScriptFromWord(
  word: string,
  reading: string | null | undefined,
  data?: LanguageData | null,
): boolean {
  if (!word || !reading || word === reading) return false;

  const lexemeConfig = getReadingLexemeNormalizationConfig(data);
  const scriptRanges = getResolvedScriptProfile('', data).scriptRanges;
  const candidateScripts = Array.from(new Set([
    ...getResolvedScriptProfile('', data).acceptedScripts,
    ...lexemeConfig.surfaceScripts,
    ...lexemeConfig.readingScripts,
    ...getReadingAnnotationScripts(data),
    ...normalizeScriptCodes(data?.textProcessing?.readingAnnotation?.surfaceSuffixScripts),
  ]));
  if (candidateScripts.length < 2) return false;

  const wordScripts = candidateScripts.filter((script) => hasLettersInScript(word, script, scriptRanges));
  const readingScripts = candidateScripts.filter((script) => hasLettersInScript(reading, script, scriptRanges));
  if (wordScripts.length === 0 || readingScripts.length === 0) return false;

  return readingScripts.some((script) => !wordScripts.includes(script))
    || wordScripts.some((script) => !readingScripts.includes(script));
}

export function adjustReadingAnnotationForSurfaceSuffix(
  word: string,
  reading: string,
  data?: LanguageData | null,
): string {
  if (!word || !reading) return reading;

  const suffixScripts = normalizeScriptCodes(data?.textProcessing?.readingAnnotation?.surfaceSuffixScripts);
  if (suffixScripts.length === 0) return reading;

  const wordChars = Array.from(word);
  const readingChars = Array.from(reading);
  if (wordChars.length !== readingChars.length) return reading;

  const lastWordChar = wordChars[wordChars.length - 1];
  const lastReadingChar = readingChars[readingChars.length - 1];
  if (
    lastWordChar &&
    lastReadingChar &&
    lastWordChar !== lastReadingChar &&
    hasLettersInAnyScript(lastWordChar, suffixScripts, getResolvedScriptProfile('', data).scriptRanges)
  ) {
    readingChars[readingChars.length - 1] = lastWordChar;
    return readingChars.join('');
  }

  return reading;
}

export function wordNeedsReadingAnnotation(
  word: string,
  reading: string | null | undefined,
  data?: LanguageData | null,
  options: { force?: boolean } = {},
): boolean {
  if (!reading) return false;
  if (options.force) return reading !== word;
  const annotationScripts = getReadingAnnotationScripts(data);
  if (annotationScripts.length === 0) return false;
  if (reading === word) return false;
  return hasLettersInAnyScript(word, annotationScripts, getResolvedScriptProfile('', data).scriptRanges);
}

function getScriptFontFamily(data: LanguageData | null | undefined, defaultFontFamily: string): string {
  const scripts = getResolvedScriptProfile('', data).acceptedScripts;
  if (scripts.some((script) => ARABIC_FONT_SCRIPTS.includes(script))) {
    return 'var(--font-family-arabic)';
  }
  if (scripts.some((script) => HEBREW_FONT_SCRIPTS.includes(script))) {
    return 'var(--font-family-hebrew)';
  }
  if (scripts.some((script) => COMPACT_SCRIPT_FONT_SCRIPTS.includes(script))) {
    return 'var(--font-family-compact-script)';
  }
  if (scripts.some((script) => KOREAN_FONT_SCRIPTS.includes(script))) {
    return 'var(--font-family-korean)';
  }
  if (scripts.some((script) => THAI_FONT_SCRIPTS.includes(script))) {
    return 'var(--font-family-thai)';
  }
  if (scripts.some((script) => CYRILLIC_FONT_SCRIPTS.includes(script))) {
    return 'var(--font-family-cyrillic)';
  }
  return defaultFontFamily;
}

export function getSubtitleFontFamily(data?: LanguageData | null): string {
  const configured = data?.typography?.subtitleFontFamily?.trim();
  if (configured) return configured;
  return getScriptFontFamily(data, 'var(--font-family-subtitle)');
}

export function getContentFontFamily(data?: LanguageData | null): string {
  const configured = data?.typography?.contentFontFamily?.trim();
  if (configured) return configured;
  return getScriptFontFamily(data, 'var(--font-family-content)');
}

export function getLanguageTextDirection(data?: LanguageData | null, language = ''): 'ltr' | 'rtl' | 'auto' {
  const configured = data?.typography?.textDirection;
  if (configured === 'ltr' || configured === 'rtl' || configured === 'auto') return configured;
  const scripts = getResolvedScriptProfile(language, data).acceptedScripts;
  return scripts.some((script) => RTL_SCRIPTS.includes(script)) ? 'rtl' : 'ltr';
}

export function getLanguageCssDirection(data?: LanguageData | null, language = ''): 'ltr' | 'rtl' | undefined {
  const direction = getLanguageTextDirection(data, language);
  return direction === 'auto' ? undefined : direction;
}
