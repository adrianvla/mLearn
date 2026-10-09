/**
 * Dictionary target language resolution.
 *
 * One owner for "which dictionary pack should this lookup read from". The
 * settings UI may offer a pack the user has not installed, and the UI locale
 * is not a dictionary target; resolving either one sends the backend at a
 * database that is not on disk and every definition comes back empty. This
 * hook only ever answers with an INSTALLED pack, leaving the choice to the
 * package's own `defaultTargetLanguage` when none is installed.
 */
import { createMemo, type Accessor } from 'solid-js';
import { useLanguage, useSettings } from '../context';
import { getDictionaryTargetLanguageForSettings, installedDictionaryTargetLanguages } from '../utils/dictionaryTargetLanguage';

/**
 * The installed dictionary target language for a learning language, or
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
