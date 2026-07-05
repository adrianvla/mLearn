import { getBackend } from '../../shared/backends';
import { createRoughTokenizerTokens, getTokenizerRuntimeConfig, tokenizerAllowsFallback, tokensToReadingText } from '../../shared/languageFeatures';
import type { LanguageData, Settings, Token } from '../../shared/types';
import { getLogger } from '../../shared/utils/logger';
import { tokensToColoredHtml } from './subtitleParsing';
import { hasLettersInSegmentlessScript } from '../../shared/languageScriptProfile';

const log = getLogger('renderer.utils.languageTokenization');

type BackendSettings = Pick<
  Settings,
  'backendMode' | 'backendUrl' | 'cloudAuthAccessToken' | 'cloudAuthToken'
>;

function getConfiguredBackend(settings: BackendSettings) {
  return getBackend({
    mode: settings.backendMode,
    url: settings.backendUrl,
    authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
  });
}

export async function tokenizeTextWithSettings(
  text: string,
  language: string,
  settings: BackendSettings,
): Promise<Token[]> {
  if (!text.trim()) return [];
  return getConfiguredBackend(settings).tokenize(text, language);
}

function colorizeWithRoughTokenizerFallback(params: {
  text: string;
  languageData?: LanguageData | null;
  colourCodes: Record<string, string>;
  targetWord: string;
}): string | null {
  const tokens = safeRoughTokenizerFallbackTokens(params.text, params.languageData);
  if (tokens.length === 0) return null;
  const originalLetters = Array.from(params.text).filter((char) => /\p{L}/u.test(char)).join('');
  const tokenLetters = tokens
    .map((token) => token.surface ?? token.word ?? '')
    .flatMap((text) => Array.from(text))
    .filter((char) => /\p{L}/u.test(char))
    .join('');
  if (originalLetters !== tokenLetters) return null;
  return tokensToColoredHtml(tokens, params.colourCodes, params.targetWord, params.languageData);
}

function safeRoughTokenizerFallbackTokens(text: string, languageData?: LanguageData | null): Token[] {
  if (!tokenizerAllowsFallback(languageData)) return [];
  const tokenizer = getTokenizerRuntimeConfig(languageData);
  if (
    hasLettersInSegmentlessScript(text)
    && tokenizer.allowRoughSegmentationForSegmentlessScripts !== true
  ) {
    return [];
  }
  return createRoughTokenizerTokens(text, languageData);
}

export async function colorizeTokenizedText(params: {
  text: string;
  language: string;
  languageData?: LanguageData | null;
  settings: BackendSettings;
  colourCodes: Record<string, string>;
  targetWord: string;
}): Promise<string> {
  try {
    const tokens = await tokenizeTextWithSettings(params.text, params.language, params.settings);
    return tokens.length > 0
      ? tokensToColoredHtml(tokens, params.colourCodes, params.targetWord, params.languageData)
      : colorizeWithRoughTokenizerFallback(params) ?? params.text;
  } catch (e) {
    log.error('Failed to tokenize generated text:', e);
    return colorizeWithRoughTokenizerFallback(params) ?? params.text;
  }
}

export async function textToReadingText(params: {
  text: string;
  language: string;
  languageData?: LanguageData | null;
  settings: BackendSettings;
}): Promise<string> {
  const roughReadingFallback = (): string | null => {
    const tokens = safeRoughTokenizerFallbackTokens(params.text, params.languageData);
    return tokens.length > 0 ? tokensToReadingText(tokens, params.languageData) : null;
  };

  try {
    const tokens = await tokenizeTextWithSettings(params.text, params.language, params.settings);
    if (tokens.length > 0) return tokensToReadingText(tokens, params.languageData);
    const fallback = roughReadingFallback();
    if (fallback !== null) return fallback;
    throw new Error(`Tokenizer returned no tokens for ${params.language}`);
  } catch (e) {
    log.error('Failed to tokenize text for readings:', e);
    const fallback = roughReadingFallback();
    if (fallback !== null) return fallback;
    throw e;
  }
}
