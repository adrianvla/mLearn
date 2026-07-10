import { describe, expect, it } from 'vitest';
import type { PolicySettingKey } from '../../../../shared/managementPolicy';
import { shouldShowAnkiSettings } from './managedSettingVisibility';

describe('managed Anki child visibility', () => {
  it.each(['flashcard_deck', 'flashcards_add_picture'] as const)(
    'shows the Anki section when %s is independently managed',
    (managedKey) => {
      expect(shouldShowAnkiSettings(false, (key: PolicySettingKey) => key === managedKey)).toBe(true);
    },
  );

  it('keeps the section hidden when Anki is off and no child is managed', () => {
    expect(shouldShowAnkiSettings(false, () => false)).toBe(false);
  });
});
