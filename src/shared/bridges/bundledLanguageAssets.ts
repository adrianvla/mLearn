import type { LanguageData, LanguageDataMap } from '../types';

type LocaleStrings = Record<string, unknown>;
type JsonModule<T> = T | { default: T };

const bundledLocaleModules = import.meta.glob<() => Promise<JsonModule<LocaleStrings>>>('../../root-of-app/locales/lang.*.json');
const bundledLanguageModules = import.meta.glob<() => Promise<JsonModule<LanguageData>>>('../../root-of-app/languages/*.json');

function unwrapModule<T>(module: JsonModule<T>): T {
  return (module as { default?: T }).default ?? (module as T);
}

function extractLocaleCode(modulePath: string): string | null {
  const match = modulePath.match(/lang\.([^.]+)\.json$/);
  return match?.[1] ?? null;
}

function extractLanguageCode(modulePath: string): string | null {
  if (modulePath.endsWith('.freq.json')) {
    return null;
  }
  const match = modulePath.match(/\/([^/]+)\.json$/);
  return match?.[1] ?? null;
}

export function getBundledLocaleCodes(): string[] {
  return Object.keys(bundledLocaleModules)
    .map(extractLocaleCode)
    .filter((code): code is string => code !== null)
    .sort();
}

export function getBundledLanguageCodes(): string[] {
  return Object.keys(bundledLanguageModules)
    .map(extractLanguageCode)
    .filter((code): code is string => code !== null)
    .sort();
}

export async function loadBundledLocaleStrings(langCode: string): Promise<LocaleStrings | null> {
  const moduleEntry = Object.entries(bundledLocaleModules)
    .find(([modulePath]) => extractLocaleCode(modulePath) === langCode);

  if (!moduleEntry) {
    return null;
  }

  const loadLocaleModule = moduleEntry[1];
  const localeModule = await loadLocaleModule();
  return unwrapModule(localeModule);
}

export async function loadBundledLanguageData(): Promise<LanguageDataMap> {
  const entries = await Promise.all(
    Object.entries(bundledLanguageModules).map(async ([modulePath, loadModule]) => {
      const code = extractLanguageCode(modulePath);
      if (!code) {
        return null;
      }

      const languageModule = await loadModule();
      return [code, unwrapModule(languageModule)] as const;
    }),
  );

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, LanguageData] => entry !== null));
}
