import { COLOR_SCHEMES, UI_TYPES } from './constants';
import type { ColorScheme, UiType } from './constants';
import type { CustomColorOverrides, Settings } from './types';

export const WINDOW_THEME_QUERY_PARAM = 'mlearnTheme';

export interface InitialWindowTheme {
  uiType: UiType;
  colorScheme: ColorScheme;
  customColors: Partial<CustomColorOverrides>;
}

export const INITIAL_WINDOW_CUSTOM_COLOR_KEYS = [
  'bg-opaque',
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'bg',
  'bg-intense',
  'border-color',
  'border-color-intense',
] as const satisfies readonly (keyof CustomColorOverrides)[];

const CSS_COLOR = /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+%?)?\s*\))$/i;

export function encodeInitialWindowTheme(
  settings: Pick<Settings, 'uiType' | 'colorScheme' | 'customColors'>,
): string {
  return JSON.stringify({
    uiType: settings.uiType,
    colorScheme: settings.colorScheme,
    customColors: sanitizeCustomColors(settings.customColors),
  });
}

export function parseInitialWindowTheme(value: string | null): InitialWindowTheme | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const candidate = parsed as Record<string, unknown>;
  const uiType = typeof candidate.uiType === 'string' && UI_TYPES.includes(candidate.uiType as UiType)
    ? candidate.uiType as UiType
    : null;
  const colorScheme = typeof candidate.colorScheme === 'string' && COLOR_SCHEMES.includes(candidate.colorScheme as ColorScheme)
    ? candidate.colorScheme as ColorScheme
    : null;
  if (!uiType || !colorScheme) return null;

  return {
    uiType,
    colorScheme,
    customColors: sanitizeCustomColors(candidate.customColors),
  };
}

function sanitizeCustomColors(value: unknown): Partial<CustomColorOverrides> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  const colors: Partial<CustomColorOverrides> = {};
  for (const key of INITIAL_WINDOW_CUSTOM_COLOR_KEYS) {
    const color = candidate[key];
    if (typeof color === 'string' && CSS_COLOR.test(color.trim())) {
      colors[key] = color.trim();
    }
  }
  return colors;
}
