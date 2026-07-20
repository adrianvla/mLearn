import type { LanguageFontFamilyOption } from '../../shared/types';

const loadedFonts = new Map<string, Promise<void>>();

export function ensureLanguageFontLoaded(option?: LanguageFontFamilyOption): Promise<void> {
  if (!option?.sourceDataUrl || typeof document === 'undefined') {
    return Promise.resolve();
  }
  const key = `${option.fontFamily}\u0000${option.sourceDataUrl}`;
  const existing = loadedFonts.get(key);
  if (existing) return existing;

  const style = document.createElement('style');
  style.dataset.languageFont = option.id;
  style.textContent = `@font-face{font-family:${JSON.stringify(option.fontFamily)};src:url(${JSON.stringify(option.sourceDataUrl)}) format("woff2");font-display:swap;}`;
  document.head.append(style);
  const loading = (document.fonts?.load
    ? document.fonts.load(`1em ${JSON.stringify(option.fontFamily)}`).then(() => undefined)
    : Promise.resolve())
    .catch((error: unknown) => {
      style.remove();
      loadedFonts.delete(key);
      throw error;
    });
  loadedFonts.set(key, loading);
  return loading;
}
