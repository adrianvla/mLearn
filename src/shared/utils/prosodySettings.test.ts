import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../types';
import { applyProsodyScaffoldMode, prosodyScaffoldMode, prosodyVisible } from '../prosodySettings';

function makeSettings(overrides: Partial<Settings> & Record<string, unknown> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides } as Settings;
}

describe('prosody settings', () => {
  it('uses the generic prosody visibility setting', () => {
    expect(prosodyVisible(makeSettings({ showProsody: false }))).toBe(false);
    expect(prosodyVisible(makeSettings({ showProsody: true }))).toBe(true);
  });

  it('falls back to the default when prosody visibility is absent', () => {
    expect(prosodyVisible(makeSettings({ showProsody: undefined }))).toBe(true);
  });
});

describe('scaffold mode (Off | Auto | Always)', () => {
  it('derives the mode from the coloring policy fields only', () => {
    expect(prosodyScaffoldMode(makeSettings())).toBe('always'); // defaults: color through known, no fade
    expect(prosodyScaffoldMode(makeSettings({ coloredProsodyEnabled: false }))).toBe('off');
    expect(prosodyScaffoldMode(makeSettings({ coloredProsodyStatusLimit: 'learning', coloredProsodyEaseMixEnabled: true }))).toBe('auto');
    expect(prosodyScaffoldMode(makeSettings({ coloredProsodyEaseMixEnabled: true }))).toBe('auto');
  });

  it('applies exact field mappings per mode without touching showProsody', () => {
    expect(applyProsodyScaffoldMode('off')).toEqual({ coloredProsodyEnabled: false });
    expect(applyProsodyScaffoldMode('always')).toEqual({
      coloredProsodyEnabled: true,
      coloredProsodyStatusLimit: 'known',
      coloredProsodyEaseMixEnabled: false,
    });
    expect(applyProsodyScaffoldMode('auto')).toEqual({
      coloredProsodyEnabled: true,
      coloredProsodyStatusLimit: 'learning',
      coloredProsodyEaseMixEnabled: true,
    });
  });

  it('round-trips: applied modes read back as themselves', () => {
    for (const mode of ['off', 'auto', 'always'] as const) {
      expect(prosodyScaffoldMode(applyProsodyScaffoldMode(mode))).toBe(mode);
    }
  });
});
