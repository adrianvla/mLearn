import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../../context';
import { openKnowledgeInspector } from '../../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../../services/surfaceKnowledgeInspection';
import { Input } from '../../../components/common';
import './WordSearchPanel.css';

const MAX_MATCHES = 20;

export const WordSearchPanel: Component = () => {
  const { store } = useFlashcards();
  const { settings } = useSettings();
  const { t } = useLocalization();

  const [query, setQuery] = createSignal('');

  // Hashed keys cannot be reversed; the stored word field is the source.
  const encounteredWords = createMemo(() => {
    const lang = settings.language;
    const words = new Set<string>();
    for (const [key, entry] of Object.entries(store.wordKnowledge)) {
      if (key.startsWith(`${lang}:`) && entry.word) words.add(entry.word);
    }
    for (const card of Object.values(store.flashcards)) {
      if (card.language === lang && card.content.type === 'word') words.add(card.content.front);
    }
    return [...words];
  });

  const matches = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return [];
    return encounteredWords().filter((word) => word.toLowerCase().includes(needle)).slice(0, MAX_MATCHES);
  });

  const inspect = (surface: string) => openKnowledgeInspector(surfaceKnowledgeInspection(settings.language, surface));

  return (
    <section class="word-search-panel">
      <h2 class="dashboard-section-title">{t('mlearn.Statistics.Sections.InspectWord')}</h2>

      <div class="word-search-search">
        <Input
          type="text"
          placeholder={t('mlearn.Statistics.Sections.SearchPlaceholder')}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && query().trim()) inspect(query().trim()); }}
          aria-label={t('mlearn.Statistics.Sections.SearchPlaceholder')}
          fullWidth
        />
        <Show when={matches().length > 0}>
          <ul class="word-search-matches">
            <For each={matches()}>
              {(word) => (
                <li>
                  <button type="button" class="word-search-match" onClick={() => inspect(word)}>
                    {word}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

    </section>
  );
};
