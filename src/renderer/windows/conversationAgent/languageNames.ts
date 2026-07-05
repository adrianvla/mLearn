import type { LanguageData } from '../../../shared/types';
import { getLanguagePromptName } from '../../../shared/languageFeatures';
import { getLocalizedLanguageName } from '../../utils/languageDisplayName';

type TranslateFn = (key: string) => string;

export function getConversationDisplayLanguageName(
  languageCode: string,
  languageData: LanguageData | null | undefined,
  t: TranslateFn,
  displayLocale = '',
): string {
  return getLocalizedLanguageName(languageCode, languageData, t, '', displayLocale);
}

export function getConversationPromptLanguageName(
  languageCode: string,
  languageData: LanguageData | null | undefined,
): string {
  return getLanguagePromptName(languageCode, languageData);
}
