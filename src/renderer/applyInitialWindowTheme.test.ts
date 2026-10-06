// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { applyInitialWindowTheme } from './applyInitialWindowTheme';

describe('initial window theme bootstrap', () => {
  afterEach(() => {
    document.body.className = '';
    document.documentElement.removeAttribute('style');
  });

  it('applies persisted theme classes and colors before the renderer mounts', () => {
    const value = encodeURIComponent(JSON.stringify({
      uiType: 'glass',
      colorScheme: 'custom',
      customColors: { 'bg-opaque': '#223344', 'text-primary': '#f4f4f4' },
    }));

    expect(applyInitialWindowTheme(`?mlearnTheme=${value}`, document.documentElement, document.body)).toBe(true);
    expect(document.body.classList.contains('theme-glass')).toBe(true);
    expect(document.body.classList.contains('theme-custom')).toBe(true);
    expect(document.body.classList.contains('reduce-transparency')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--bg-opaque')).toBe('#223344');
    expect(document.documentElement.style.getPropertyValue('--text-primary')).toBe('#f4f4f4');
  });

  it('sets the existing opaque-surface state for a reduced-transparency palette', () => {
    const value = encodeURIComponent(JSON.stringify({ uiType: 'flat', colorScheme: 'slate' }));
    applyInitialWindowTheme(`?mlearnTheme=${value}`, document.documentElement, document.body);

    expect(document.body.classList.contains('theme-slate')).toBe(true);
    expect(document.body.classList.contains('reduce-transparency')).toBe(true);
  });

  it('leaves the default renderer surface intact when the bootstrap value is invalid', () => {
    document.body.classList.add('theme-tactile');
    expect(applyInitialWindowTheme('?mlearnTheme=invalid', document.documentElement, document.body)).toBe(false);
    expect(document.body.className).toBe('theme-tactile');
  });
});
