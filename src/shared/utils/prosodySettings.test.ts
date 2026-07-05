import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../types';
import { prosodyVisible } from '../prosodySettings';

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
