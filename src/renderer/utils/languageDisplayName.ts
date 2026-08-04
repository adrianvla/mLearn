import type { LanguageData } from '../../shared/types';

export type TranslateLanguageName = (key: string) => string;

/**
 * Resolves a language's display name in the current UI language.
 * Returns '' when no localized form is available (unknown key + no valid BCP-47 match).
 */
function resolveLocalizedName(code: string, t: TranslateLanguageName, displayLocale: string): string {
  const localizedKey = `mlearn.Languages.${code}`;
  const localized = t(localizedKey);
  if (localized !== localizedKey) {
    return localized;
  }

  const locale = displayLocale.trim();
  if (locale) {
    try {
      const displayName = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
      if (displayName && displayName !== code) {
        return displayName;
      }
    } catch {
      // Custom package language identifiers may not be valid BCP-47 tags.
    }
  }

  return '';
}

export function getLocalizedLanguageName(
  languageCode: string | null | undefined,
  languageData: LanguageData | null | undefined,
  t: TranslateLanguageName,
  fallback = '',
  displayLocale = '',
): string {
  const code = languageCode?.trim() ?? '';
  const localized = code ? resolveLocalizedName(code, t, displayLocale) : '';
  if (localized) {
    return localized;
  }

  return languageData?.name_translated || languageData?.name || code || fallback;
}

/** Returns the native (endonym) name of a standard BCP-47 language code, or '' when unavailable. */
export function getNativeLanguageName(code: string): string {
  try {
    const displayName = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return displayName && displayName !== code ? displayName : '';
  } catch {
    return '';
  }
}

/**
 * Returns a language's display name in the current UI language, preferring the English
 * metadata name over the native name when no translation exists (e.g. "Arabic" not "العربية").
 */
export function getDisplayLanguageName(
  languageCode: string | null | undefined,
  languageData: LanguageData | null | undefined,
  t: TranslateLanguageName,
  displayLocale = '',
  fallback = '',
): string {
  const code = languageCode?.trim() ?? '';
  return (
    (code ? resolveLocalizedName(code, t, displayLocale) : '') ||
    languageData?.name ||
    fallback ||
    code
  );
}

/**
 * Returns a language's display name as "Localized (Native)" — e.g. "Japanisch (日本語)".
 * Collapses to just the localized name when both are identical or no native name exists.
 */
export function getBilingualLanguageName(
  languageCode: string | null | undefined,
  languageData: LanguageData | null | undefined,
  t: TranslateLanguageName,
  displayLocale = '',
  fallback = '',
  nativeName?: string,
): string {
  const code = languageCode?.trim() ?? '';
  const localized = getDisplayLanguageName(code, languageData, t, displayLocale, fallback);
  const native = nativeName ?? languageData?.name_translated ?? getNativeLanguageName(code);
  if (!native || native === localized) {
    return localized;
  }
  return `${localized} (${native})`;
}
