import { describe, expect, it } from 'vitest';
import { encodeInitialWindowTheme, parseInitialWindowTheme } from './windowTheme';

describe('initial native window theme transfer', () => {
  it('round-trips the selected surface, palette and safe custom colors', () => {
    const encoded = encodeInitialWindowTheme({
      uiType: 'glass',
      colorScheme: 'custom',
      customColors: {
        'bg-opaque': '#223344',
        'text-primary': 'rgba(244, 244, 244, 0.95)',
      },
    });

    expect(parseInitialWindowTheme(encoded)).toEqual({
      uiType: 'glass',
      colorScheme: 'custom',
      customColors: {
        'bg-opaque': '#223344',
        'text-primary': 'rgba(244, 244, 244, 0.95)',
      },
    });
  });

  it('drops non-color custom values and rejects an unknown theme identifier', () => {
    const parsed = parseInitialWindowTheme(JSON.stringify({
      uiType: 'flat',
      colorScheme: 'quartz',
      customColors: { 'bg-opaque': 'url(https://example.test)', 'text-primary': '#111' },
    }));
    expect(parsed?.customColors).toEqual({ 'text-primary': '#111' });
    expect(parseInitialWindowTheme(JSON.stringify({ uiType: 'unknown', colorScheme: 'quartz' }))).toBeNull();
  });
});
