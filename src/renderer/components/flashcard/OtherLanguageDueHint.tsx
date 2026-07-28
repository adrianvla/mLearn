import { createMemo, For, Show } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { Button } from '../common';
import { getDueCards } from '../../services/srsAlgorithm';
import { getLocalizedLanguageName } from '../../utils/languageDisplayName';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import './OtherLanguageDueHint.css';

export function OtherLanguageDueHint() {
  const { t } = useLocalization();
  const { store, refreshQueue } = useFlashcards();
  const { settings, updateSetting } = useSettings();
  const { langData } = useLanguage();

  const otherLanguageDue = createMemo(() => {
    const lang = settings.language;
    const hour = settings.newDayHour ?? DEFAULT_SETTINGS.newDayHour!;
    const dueCounts = new Map<string, number>();
    for (const card of getDueCards(store.flashcards, hour)) {
      if (!card.language || card.language === lang) continue;
      dueCounts.set(card.language, (dueCounts.get(card.language) ?? 0) + 1);
    }
    return [...dueCounts.entries()].sort((a, b) => b[1] - a[1]);
  });

  const handleSwitchToLanguage = (lang: string) => {
    updateSetting('language', lang);
    refreshQueue();
  };

  return (
    <Show when={otherLanguageDue().length > 0}>
      <div class="flashcard-other-languages">
        <For each={otherLanguageDue()}>
          {([lang, count]) => (
            <div class="flashcard-other-language">
              <span class="flashcard-other-language-text">
                {t('mlearn.Flashcards.Review.OtherLanguageDue', {
                  count,
                  language: getLocalizedLanguageName(lang, langData[lang], (k) => t(k), lang),
                })}
              </span>
              <Button buttonType="default" variant="ghost" size="xs" onClick={() => handleSwitchToLanguage(lang)}>
                {t('mlearn.Flashcards.Review.SwitchToLanguage')}
              </Button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
