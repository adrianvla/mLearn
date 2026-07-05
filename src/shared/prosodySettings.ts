import { DEFAULT_SETTINGS, type Settings } from './types';

type ProsodyVisibilitySettings = Pick<Settings, 'showProsody'>;

export function prosodyVisible(settings: Partial<ProsodyVisibilitySettings>): boolean {
  return settings.showProsody ?? DEFAULT_SETTINGS.showProsody;
}
