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

/** Explicit user intent remains exact; only an unconfigured lookup may select an installed UI target. */
export function getDictionaryTargetLanguageForSettings(
  settings: Pick<Settings, 'dictionaryTargetLanguages' | 'language' | 'uiLanguage'>,
  language: string = settings.language,
  installedTargetLanguages: readonly string[] = [],
): string | undefined {
  const configured = (settings.dictionaryTargetLanguages ?? DEFAULT_SETTINGS.dictionaryTargetLanguages)[language];
  if (configured) return configured;
  if (installedTargetLanguages.includes(settings.uiLanguage)) return settings.uiLanguage;
  return undefined;
}

/**
 * The language an LLM prompt should ask for, as a display label.
 *
 * A model can translate into any language, installed dictionary pack or not,
 * so this is a naming question rather than a lookup question: the configured
 * target wins, and the UI locale is the natural fallback. Unconfigured lookups may prefer an installed UI target.
 */
export function getDictionaryPromptTargetForSettings(
  settings: Pick<Settings, 'dictionaryTargetLanguages' | 'language' | 'uiLanguage'>,
  language: string = settings.language,
): string {
  return (settings.dictionaryTargetLanguages ?? DEFAULT_SETTINGS.dictionaryTargetLanguages)[language]
    ?? settings.uiLanguage
    ?? DEFAULT_SETTINGS.uiLanguage;
}
