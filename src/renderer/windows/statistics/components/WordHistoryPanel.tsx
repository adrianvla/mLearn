/**
 * Statistics Word History Panel
 * Word-search drill-down: pick a tracked word, see its full knowledge history
 * graph plus a chronological event list (newest last, matching the plan).
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../context';
import { getAvailableAspects } from '../../../../shared/types';
import type { KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import { Input, KnowledgeHistoryGraph, KnowledgeHistoryTimeline, Panel, type HistoryEvent } from '../../../components/common';
import { isChartableHistory } from '../../../utils/knowledgeHistory';
import { useKnowledgeHistory } from '../../../hooks/useKnowledgeHistory';
import './WordHistoryPanel.css';

const MAX_MATCHES = 20;

export const WordHistoryPanel: Component = () => {
  const { store, getAspectStatus } = useFlashcards();
  const { settings } = useSettings();
  const { currentLangData } = useLanguage();
  const { t } = useLocalization();

  const [aspect, setAspect] = createSignal<KnowledgeAspect>('meaning');
  const [query, setQuery] = createSignal('');

  // Hashed keys cannot be reversed; the stored word field is the source.
  const trackedWords = createMemo(() => {
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
    return trackedWords().filter((word) => word.toLowerCase().includes(needle)).slice(0, MAX_MATCHES);
  });

  const selectedWord = createMemo(() => query().trim());

  // Language-level aspects, narrowed per selected word: orthogonal aspects with
  // no record stay hidden (interim applicability rule) — no empty Pronunciation /
  // Orthography tabs for words that never tested them.
  const availableAspects = createMemo(() => {
    const all = getAvailableAspects(currentLangData() ?? undefined);
    const word = selectedWord().trim();
    if (!word) return all;
    return all.filter((aspect) => getAspectStatus(word, aspect, settings.language).untracked !== true);
  });
  const history = useKnowledgeHistory(selectedWord, aspect);
  // Retraction tombstones are undo bookkeeping, not history rows.
  const events = createMemo((): HistoryEvent[] => (history.events() ?? []).filter(
    (event): event is HistoryEvent => event.kind !== 'retraction',
  ));
  const graphData = createMemo(() => history.replay());


  return (
    <Panel variant="default" rounded="lg" padding="lg" class="dashboard-panel word-history-panel">
      <h2 class="dashboard-section-title">{t('mlearn.Statistics.WordHistory.Title')}</h2>

      <div class="word-history-search">
        <Input
          type="text"
          placeholder={t('mlearn.Statistics.WordHistory.SearchPlaceholder')}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          fullWidth
        />
        <Show when={matches().length > 0}>
          <ul class="word-history-matches">
            <For each={matches()}>
              {(word) => (
                <li>
                  <button type="button" class="word-history-match" onClick={() => setQuery(word)}>
                    {word}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <Show
        when={selectedWord()}
        fallback={<p class="word-history-prompt">{t('mlearn.Statistics.WordHistory.Prompt')}</p>}
      >
        <KnowledgeHistoryGraph
          points={graphData().points}
          bands={graphData().bands}
          aspect={aspect()}
          availableAspects={availableAspects()}
          onAspectChange={setAspect}
          mode="full"
          now={Date.now()}
          showChart={isChartableHistory(graphData().points)}
        />

        <Show
          when={events().length > 0}
          fallback={<p class="word-history-empty">{t('mlearn.Statistics.WordHistory.Empty')}</p>}
        >
          <KnowledgeHistoryTimeline events={events()} />
        </Show>
      </Show>
    </Panel>
  );
};
