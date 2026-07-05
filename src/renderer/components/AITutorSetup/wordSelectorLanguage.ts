import type { LanguageData, LanguageDataMap } from '../../../shared/types';

export function resolveWordSelectorLanguageData(
  language: string,
  activeLanguage: string,
  langData: LanguageDataMap,
  activeLanguageData: LanguageData | null,
): LanguageData | null {
  return langData[language] ?? (language === activeLanguage ? activeLanguageData : null);
}
