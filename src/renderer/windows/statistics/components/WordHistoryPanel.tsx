/**
 * Statistics Word History Panel
 * Word-search drill-down: pick a tracked word, see its full knowledge history
 * graph plus a chronological event list (newest last, matching the plan).
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../../context';
import type { CapabilityKey } from '../../../../shared/graph/types';
import { Input, KnowledgeHistoryGraph, KnowledgeHistoryTimeline, Panel, type HistoryEvent } from '../../../components/common';
import { isChartableHistory } from '../../../utils/knowledgeHistory';
import { useKnowledgeHistory } from '../../../hooks/useKnowledgeHistory';
import { useKnowledgeProjection } from '../../../hooks/useKnowledgeProjection';
import './WordHistoryPanel.css';

const MAX_MATCHES = 20;

export const WordHistoryPanel: Component = () => {
  const { store } = useFlashcards();
  const { settings } = useSettings();
  const { t } = useLocalization();

  const [selectedCapability, setCapability] = createSignal<CapabilityKey>();
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

  const { capabilities: availableCapabilities } = useKnowledgeProjection(() => {
    const surface = selectedWord();
    return surface ? { language: settings.language, surface } : undefined;
  });
  const capability = createMemo(() => {
    const selected = selectedCapability();
    const available = availableCapabilities();
    return selected && available.includes(selected) ? selected : available[0];
  });
  const history = useKnowledgeHistory(selectedWord, capability);
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
        <Show when={capability()}>{(activeCapability) => <KnowledgeHistoryGraph
          points={graphData().points}
          archivedPoints={history.archivedPoints()}
          bands={graphData().bands}
          capability={activeCapability()}
          availableCapabilities={availableCapabilities()}
          onCapabilityChange={setCapability}
          mode="full"
          now={Date.now()}
          showChart={isChartableHistory(graphData().points) || (history.archivedPoints()?.length ?? 0) > 0}
        />}</Show>

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
