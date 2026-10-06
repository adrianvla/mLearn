import { COLOR_SCHEMES, UI_TYPES, isOpaqueColorScheme } from '../shared/constants';
import { INITIAL_WINDOW_CUSTOM_COLOR_KEYS, WINDOW_THEME_QUERY_PARAM, parseInitialWindowTheme } from '../shared/windowTheme';

export function applyInitialWindowTheme(search: string, root: HTMLElement, body: HTMLElement): boolean {
  const themeValue = new URLSearchParams(search).get(WINDOW_THEME_QUERY_PARAM);
  const theme = parseInitialWindowTheme(themeValue);
  if (!theme) return false;

  for (const uiType of UI_TYPES) body.classList.remove(`theme-${uiType}`);
  for (const colorScheme of COLOR_SCHEMES) body.classList.remove(`theme-${colorScheme}`);
  body.classList.add(`theme-${theme.uiType}`, `theme-${theme.colorScheme}`);
  body.classList.toggle('reduce-transparency', isOpaqueColorScheme(theme.colorScheme));

  for (const key of INITIAL_WINDOW_CUSTOM_COLOR_KEYS) {
    const value = theme.customColors[key];
    if (value) root.style.setProperty(`--${key}`, value);
    else root.style.removeProperty(`--${key}`);
  }

  return true;
}
