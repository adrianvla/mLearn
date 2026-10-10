import { DEFAULT_SETTINGS, type Settings } from './types';

/** Configuration identity, independent of language/package identities. */
export function languageCatalogSourceKey(settings: Partial<Settings>): string {
  return JSON.stringify([
    (settings.languageCatalogUrl ?? DEFAULT_SETTINGS.languageCatalogUrl).trim(),
    (settings.catalogMirrorDomain ?? DEFAULT_SETTINGS.catalogMirrorDomain).trim(),
    settings.devMode ?? DEFAULT_SETTINGS.devMode,
  ]);
}
