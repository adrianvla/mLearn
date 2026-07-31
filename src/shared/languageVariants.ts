import { DEFAULT_SETTINGS } from './types';
import type { LanguageData, LanguageDataMap, Settings } from './types';

export const VARIANT_OVERLAY_ALLOWLIST = [
  'name',
  'name_translated',
  'flagEmoji',
  'grammar',
  'conversation.tutorPromptGuidelines',
  'conversation.correctionPromptGuidelines',
  'conversation.mistakeCheckerPromptGuidelines',
  'typography.subtitleFontFamily',
  'typography.contentFontFamily',
  'runtime.ocr.paddleLang',
  'runtime.tts.webSpeechLang',
  'runtime.tts.diagnosticText',
  'runtime.adapter.config',
  'runtime.diagnostics.sampleText',
] as const;

const ALLOWLIST_SET: ReadonlySet<string> = new Set(VARIANT_OVERLAY_ALLOWLIST);

function setDottedPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    const child = node[segment];
    const next: Record<string, unknown> =
      child !== null && typeof child === 'object' && !Array.isArray(child)
        ? { ...(child as Record<string, unknown>) }
        : {};
    node[segment] = next;
    node = next;
  }
  node[segments[segments.length - 1]] = value;
}

export function applyVariantOverlay(data: LanguageData, variantId: string | undefined): LanguageData {
  if (!variantId || !data.variants) {
    return data;
  }
  const variant = data.variants[variantId];
  if (!variant) {
    return data;
  }
  const result = { ...data } as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(variant.overrides)) {
    if (!ALLOWLIST_SET.has(path)) {
      throw new Error(`Variant override path not in VARIANT_OVERLAY_ALLOWLIST: ${path}`);
    }
    setDottedPath(result, path, value);
  }
  return result as unknown as LanguageData;
}

type VariantSettings = Partial<Pick<Settings, 'languageVariants'>>;

export function resolveActiveVariantId(settings: VariantSettings, lang: string): string | undefined {
  const variants = settings.languageVariants ?? DEFAULT_SETTINGS.languageVariants;
  return variants[lang] ?? undefined;
}

export function resolveEffectiveLanguageData(
  data: LanguageData,
  settings: VariantSettings,
  lang: string,
): LanguageData {
  return applyVariantOverlay(data, resolveActiveVariantId(settings, lang));
}

export function canonicalLanguage(lang: string, data: LanguageDataMap | undefined): string {
  if (!data) {
    return lang;
  }
  for (const [code, languageData] of Object.entries(data)) {
    if (code !== lang && languageData.legacyCodes?.includes(lang)) {
      return code;
    }
  }
  return lang;
}
