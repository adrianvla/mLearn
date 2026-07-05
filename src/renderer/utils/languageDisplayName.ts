import type { LanguageData } from '../../shared/types';

export type TranslateLanguageName = (key: string) => string;

export function getLocalizedLanguageName(
  languageCode: string | null | undefined,
  languageData: LanguageData | null | undefined,
  t: TranslateLanguageName,
  fallback = '',
  displayLocale = '',
): string {
  const code = languageCode?.trim() ?? '';
  if (code) {
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
  }

  return languageData?.name_translated || languageData?.name || code || fallback;
}
