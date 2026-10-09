/** Resolve dictionary intent without replacing an explicit unavailable selection. */
import { createMemo, type Accessor } from 'solid-js';
import { useLanguage, useSettings } from '../context';
import { getDictionaryTargetLanguageForSettings, installedDictionaryTargetLanguages } from '../utils/dictionaryTargetLanguage';

/**
 * The explicit dictionary target or an installed implicit target, or
 * `undefined` when the package default should apply.
 */
export function useDictionaryTargetLanguage(language?: Accessor<string> | string): Accessor<string | undefined> {
  const { settings } = useSettings();
  const { languageDataCatalog, currentLanguage } = useLanguage();
  return createMemo(() => {
    const learningLanguage = typeof language === 'function' ? language() : language ?? currentLanguage?.() ?? settings.language;
    return getDictionaryTargetLanguageForSettings(
      settings,
      learningLanguage,
      installedDictionaryTargetLanguages(languageDataCatalog?.() ?? [], learningLanguage),
    );
  });
}
