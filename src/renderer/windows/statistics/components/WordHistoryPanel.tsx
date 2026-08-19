/**
 * Statistics Word History Panel
 * Word-search drill-down: pick a tracked word, see its full knowledge history
 * graph plus a chronological event list (newest last, matching the plan).
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../context';
import { getAvailableAspects } from '../../../../shared/types';
import { KNOWLEDGE_SOURCE_DISPLAY_NAMES, type WordStatus } from '../../../../shared/constants';
import type { KnowledgeAspect, KnowledgeEvent, KnowledgeEventKind } from '../../../../shared/knowledgeEvents';
import { Input, KnowledgeHistoryGraph, Panel } from '../../../components/common';
import { useKnowledgeHistory } from '../../../hooks/useKnowledgeHistory';
import './WordHistoryPanel.css';

const KIND_LABEL_KEYS: Record<KnowledgeEventKind, string> = {
  status: 'Status',
  review: 'Review',
  rating: 'Rating',
  rollup: 'Rollup',
};

const STATUS_LABEL_KEYS: Record<WordStatus, string> = {
  unknown: 'Unknown',
  learning: 'Learning',
  known: 'Known',
};

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
  const events = createMemo(() => history.events() ?? []);
  const graphData = createMemo(() => history.replay());

  const sourceLabel = (event: KnowledgeEvent): string => (
    t(`mlearn.Knowledge.History.Source.${KNOWLEDGE_SOURCE_DISPLAY_NAMES[event.source]}`)
  );

  const eventDetail = (event: KnowledgeEvent): string => {
    if (event.fromStatus && event.toStatus) {
      return `${t(`mlearn.WordHover.Status.${STATUS_LABEL_KEYS[event.fromStatus]}`)} → ${t(`mlearn.WordHover.Status.${STATUS_LABEL_KEYS[event.toStatus]}`)}`;
    }
    if (event.toStatus) return t(`mlearn.WordHover.Status.${STATUS_LABEL_KEYS[event.toStatus]}`);
    if (event.rating) return event.rating;
    return '';
  };

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
        />

        <Show
          when={events().length > 0}
          fallback={<p class="word-history-empty">{t('mlearn.Statistics.WordHistory.Empty')}</p>}
        >
          <table class="word-history-table">
            <thead>
              <tr>
                <th class="word-history-time-column">{t('mlearn.Knowledge.History.Table.Time')}</th>
                <th>{t('mlearn.Knowledge.History.Table.Event')}</th>
                <th>{t('mlearn.Knowledge.History.Table.Source')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={events()}>
                {(event) => {
                  const detail = eventDetail(event);
                  return (
                    <tr>
                      <td class="word-history-time-column">{new Date(event.t).toLocaleDateString()}</td>
                      <td>
                        <span class="word-history-kind">
                          {t(`mlearn.Knowledge.History.Kind.${KIND_LABEL_KEYS[event.kind]}`)}
                        </span>
                        <Show when={detail}>
                          <span class="word-history-transition">{detail}</span>
                        </Show>
                      </td>
                      <td class="word-history-source-column">{sourceLabel(event)}</td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
    </Panel>
  );
};
