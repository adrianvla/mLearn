import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../types';
import { prosodyVisible } from '../prosodySettings';
import { applyProsodyScaffoldStance, prosodyScaffoldStance, scaffoldStance, type ScaffoldStance } from '../scaffoldPreferences';

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

describe('scaffold stance (learner intent, not policy algorithms)', () => {
  it('reads as a soft preference: the learner only says whether they want colors', () => {
    expect(prosodyScaffoldStance(makeSettings())).toBe('prefer');
    expect(prosodyScaffoldStance(makeSettings({ coloredProsodyEnabled: false }))).toBe('avoid');
  });

  it('applies the preference without touching policy-owned fade fields', () => {
    expect(applyProsodyScaffoldStance('prefer')).toEqual({ coloredProsodyEnabled: true });
    expect(applyProsodyScaffoldStance('avoid')).toEqual({ coloredProsodyEnabled: false });
  });

  it('policy-owned fading defaults to adaptive without a user-facing knob', () => {
    expect(DEFAULT_SETTINGS.coloredProsodyStatusLimit).toBe('learning');
    expect(DEFAULT_SETTINGS.coloredProsodyEaseMixEnabled).toBe(true);
  });

  it('resolves unknown package scaffolds as adaptive — safe and inert', () => {
    expect(scaffoldStance(makeSettings(), 'x-acme::tone-ladder')).toBe<ScaffoldStance>('adaptive');
    expect(scaffoldStance(makeSettings(), 'reading')).toBe<ScaffoldStance>('require');
    expect(scaffoldStance(makeSettings(), 'prosody')).toBe<ScaffoldStance>('prefer');
  });
});
