import type { LanguageData, LanguageDataMap } from '../../shared/types';

export function resolveTtsLanguageData(
  language: string,
  options: {
    explicitLanguageData?: LanguageData | null;
    installedLanguageData: LanguageDataMap;
    activeLanguage: string;
    activeLanguageData: LanguageData | null;
  },
): LanguageData | null {
  if (options.explicitLanguageData !== undefined) return options.explicitLanguageData;
  return options.installedLanguageData[language]
    ?? (language === options.activeLanguage ? options.activeLanguageData : null);
}
