// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ensureLanguageFontLoaded', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.querySelectorAll('style[data-language-font]').forEach((element) => element.remove());
  });

  it('loads a packaged font data URL once and registers it with the document', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    const { ensureLanguageFontLoaded } = await import('./languageFonts');
    const option = {
      id: 'ponomar',
      name: 'Ponomar',
      fontFamily: 'Ponomar',
      sourceDataUrl: 'data:font/woff2;base64,d29mMg==',
    };

    await Promise.all([ensureLanguageFontLoaded(option), ensureLanguageFontLoaded(option)]);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith('1em "Ponomar"');
    expect(document.head.querySelector('style[data-language-font="ponomar"]')?.textContent)
      .toContain('data:font/woff2;base64,d29mMg==');
  });
});
