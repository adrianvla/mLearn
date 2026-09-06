import type { LanguageData } from '../types';
import { applyMappingTableNormalizer } from '../languageFeatures';

export interface CanonicalWordKeyDeps {
  /** Synchronous SHA-256 hex hasher (e.g. hashWordSync in the renderer, node:crypto in Electron). */
  hashWord: (word: string) => string;
  /** Installed language metadata, used to gate script conversion. */
  languageData?: LanguageData | null;
  /** Legacy language code → canonical language code, built from installed metadata `legacyCodes`. */
  legacyLanguageCodes?: Record<string, string>;
}

export function declaresScriptConversion(data: LanguageData | null | undefined): boolean {
  if (!data) return false;
  if (data.textProcessing?.lexemeNormalization?.mappingTableAsset) return true;
  return Object.values(data.variants ?? {}).some((variant) => Boolean(variant.scriptConversion?.mappingAsset));
}

export function canonicalKeyHash(language: string, word: string, deps: CanonicalWordKeyDeps): string {
  const canonical = deps.legacyLanguageCodes?.[language] ?? language;
  const normalized = declaresScriptConversion(deps.languageData)
    ? applyMappingTableNormalizer(word, canonical)
    : word;
  return `${canonical}:${deps.hashWord(normalized)}`;
}
