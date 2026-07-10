import type { PolicySettingKey } from '../../../../shared/managementPolicy';

const ANKI_CONDITIONAL_SETTING_KEYS = [
  'flashcard_deck',
  'flashcards_add_picture',
] as const satisfies readonly PolicySettingKey[];

export function shouldShowAnkiSettings(
  useAnki: boolean,
  isSettingManaged: (key: PolicySettingKey) => boolean,
): boolean {
  return useAnki || ANKI_CONDITIONAL_SETTING_KEYS.some(isSettingManaged);
}
