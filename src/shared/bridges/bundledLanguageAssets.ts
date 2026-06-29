type LocaleStrings = Record<string, unknown>;
type JsonModule<T> = T | { default: T };

const bundledLocaleModules = import.meta.glob<() => Promise<JsonModule<LocaleStrings>>>('../../root-of-app/locales/lang.*.json');

function unwrapModule<T>(module: JsonModule<T>): T {
  return (module as { default?: T }).default ?? (module as T);
}

function extractLocaleCode(modulePath: string): string | null {
  const match = modulePath.match(/lang\.([^.]+)\.json$/);
  return match?.[1] ?? null;
}

export function getBundledLocaleCodes(): string[] {
  return Object.keys(bundledLocaleModules)
    .map(extractLocaleCode)
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
