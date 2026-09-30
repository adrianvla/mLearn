import type { LanguageDataCatalogStatus, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

/**
 * The dictionary target languages actually installed for one learning language.
 *
 * The catalog is the only source that knows what is on disk; a declared-but-
 * uninstalled pack is offered by the settings UI but cannot answer a lookup.
 */
export function installedDictionaryTargetLanguages(
  catalog: readonly LanguageDataCatalogStatus[] | undefined,
  language: string,
): string[] {
  const status = catalog?.find((entry) => entry.language === language);
  return (status?.dictionaryPacks ?? [])
    .filter((pack) => pack.installed)
    .map((pack) => pack.targetLanguage);
}

/**
 * The dictionary target language a lookup should actually use.
 *
 * Only an INSTALLED pack is ever returned. A configured or UI-language target
 * with no pack on disk is dropped, because the backend honors an explicit
 * target literally and answers an uninstalled one with nothing — every
 * definition lookup would come back empty. With no target the backend applies
 * the package's own `defaultTargetLanguage`, which is the correct generic
 * default and never guesses from the UI locale.
 */
export function getDictionaryTargetLanguageForSettings(
  settings: Pick<Settings, 'dictionaryTargetLanguages' | 'language' | 'uiLanguage'>,
  language: string = settings.language,
  installedTargetLanguages: readonly string[] = [],
): string | undefined {
  const configured = (settings.dictionaryTargetLanguages ?? DEFAULT_SETTINGS.dictionaryTargetLanguages)[language];
  const candidates = [configured, settings.uiLanguage];
  for (const candidate of candidates) {
    if (candidate && installedTargetLanguages.includes(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The language an LLM prompt should ask for, as a display label.
 *
 * A model can translate into any language, installed dictionary pack or not,
 * so this is a naming question rather than a lookup question: the configured
 * target wins, and the UI locale is the natural fallback. Only
 * `getDictionaryTargetLanguageForSettings` may gate on what is installed.
 */
export function getDictionaryPromptTargetForSettings(
  settings: Pick<Settings, 'dictionaryTargetLanguages' | 'language' | 'uiLanguage'>,
  language: string = settings.language,
): string {
  return (settings.dictionaryTargetLanguages ?? DEFAULT_SETTINGS.dictionaryTargetLanguages)[language]
    ?? settings.uiLanguage
    ?? DEFAULT_SETTINGS.uiLanguage;
}
