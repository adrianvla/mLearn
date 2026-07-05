import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

export function getDictionaryTargetLanguageForSettings(
  settings: Pick<Settings, 'dictionaryTargetLanguages' | 'language' | 'uiLanguage'>,
  language: string = settings.language,
): string | undefined {
  return (settings.dictionaryTargetLanguages ?? DEFAULT_SETTINGS.dictionaryTargetLanguages)[language]
    ?? settings.uiLanguage;
}
