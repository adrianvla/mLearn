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
