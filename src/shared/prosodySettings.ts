import { DEFAULT_SETTINGS, type Settings } from './types';

type ProsodyVisibilitySettings = Pick<Settings, 'showProsody'>;

export function prosodyVisible(settings: Partial<ProsodyVisibilitySettings>): boolean {
  return settings.showProsody ?? DEFAULT_SETTINGS.showProsody;
}

type ColoredProsodySurfaceSettings = Pick<Settings, 'coloredProsodyRelevantOnly'>;

export function coloredProsodyAllowedOnSurface(
  settings: Partial<ColoredProsodySurfaceSettings>,
  surface: 'subtitle' | 'other',
): boolean {
  return !(settings.coloredProsodyRelevantOnly ?? DEFAULT_SETTINGS.coloredProsodyRelevantOnly)
    || surface === 'subtitle';
}

// ─── ScaffoldPolicy: Off | Auto | Always ────────────────────────────────────
// The colored-prosody controls encode a LEARNING-POLICY decision (when the
// scaffold may appear) on top of genuine appearance preferences (palette,
// saturation, mix target). The mode view makes that policy explicit:
// Off forbids the scaffold, Auto lets ScaffoldPolicy decide (status limit +
// evidence fade), Always requires it and evidence correctly records the
// scaffold as present.

export type ScaffoldMode = 'off' | 'auto' | 'always';

type ProsodyScaffoldSettings = Pick<
  Settings,
  'coloredProsodyEnabled' | 'coloredProsodyStatusLimit' | 'coloredProsodyEaseMixEnabled'
>;

export function prosodyScaffoldMode(settings: Partial<ProsodyScaffoldSettings>): ScaffoldMode {
  if (!(settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled)) return 'off';
  const limit = settings.coloredProsodyStatusLimit ?? DEFAULT_SETTINGS.coloredProsodyStatusLimit;
  const fades = settings.coloredProsodyEaseMixEnabled ?? DEFAULT_SETTINGS.coloredProsodyEaseMixEnabled;
  // 'known' colors through every status and, without evidence fade, the
  // learner always sees the scaffold — an Always requirement.
  return !fades && limit === 'known' ? 'always' : 'auto';
}

export function applyProsodyScaffoldMode(mode: ScaffoldMode): Partial<Settings> {
  switch (mode) {
    case 'off':
      return { coloredProsodyEnabled: false };
    case 'always':
      return { coloredProsodyEnabled: true, coloredProsodyStatusLimit: 'known', coloredProsodyEaseMixEnabled: false };
    case 'auto':
      // Policy decides: colors stop once a word is known and fade with
      // prosody evidence. The language-level prosody visibility control
      // (showProsody) is independent and is never touched here.
      return { coloredProsodyEnabled: true, coloredProsodyStatusLimit: 'learning', coloredProsodyEaseMixEnabled: true };
  }
}
