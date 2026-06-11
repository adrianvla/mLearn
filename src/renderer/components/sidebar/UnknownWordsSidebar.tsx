import { Component, For, Show, Accessor, createEffect, createMemo, createSignal, JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Token, TranslationEntry, TranslationResponse } from '../../../shared/types';
import { Btn, CollapsibleStickyHeader, PillBtn, PillLabel, PitchAccentOverlay, Select } from '../common';
import { ResourcePill, WordStatusPill } from '../common/Smart';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { getCachedTranslation, useTranslation } from '../../hooks/useTranslation';
import {
  extractPitchAccentFromTranslationData,
  extractReadingFromEntries,
} from '../subtitle/wordHoverHelpers';
import { fetchAnkiWordsCache, findAnkiWordMatchInCache, isAnkiCacheFetched } from '../../services/ankiWordsCache';
import { getWordFormCandidates } from '../../utils/wordForms';
import { normalizeReading, containsKanji, isAllKana } from '../../../shared/utils/textUtils';
import './UnknownWordsSidebar.css';

export function hasDictionaryEntry(translation: TranslationResponse | null | undefined): boolean {
  if (!translation?.data) return false;
  for (const entry of translation.data) {
    if (entry && 'definitions' in entry) {
      const defs = (entry as TranslationEntry).definitions;
      if (Array.isArray(defs) ? defs.length > 0 : Boolean(defs)) return true;
    }
  }
  return false;
}

export interface SidebarWordEntry {
  key: string;
  word: string;
  token: Token;
  contextPhrase: string;
}

export interface SortOption {
  value: string;
  label: string;
}

export interface UnknownWordsSidebarProps {
  words: Accessor<SidebarWordEntry[]>;
  addingWordKeys: Accessor<Set<string>>;
  isAddingAll: Accessor<boolean>;
  failedWordSet?: Accessor<ReadonlySet<string>>;
  failedEmptyMessage?: string;
  onAddWord: (entry: SidebarWordEntry) => void | Promise<void>;
  onIgnoreWord: (entry: SidebarWordEntry) => void | Promise<void>;
  onWordHover?: (entry: SidebarWordEntry) => void;
  onWordLeave?: () => void;
  sortOptions: Accessor<SortOption[]>;
  defaultSort: string;
  emptyMessage: string;
  class?: string;
  onAddAllClick: (addableEntries: SidebarWordEntry[], dictionaryFoundAddable: SidebarWordEntry[]) => void;
  footer?: JSX.Element;
}

type SidebarCategory = 'all' | 'dictionary' | 'failed';

const UnknownWordRow: Component<{
  entry: SidebarWordEntry;
  translation: TranslationResponse | null | undefined;
  ankiCacheReady: Accessor<boolean>;
  isAdding: boolean;
  isIgnored: boolean;
  onAddWord: (entry: SidebarWordEntry) => void | Promise<void>;
  onIgnoreWord: (entry: SidebarWordEntry) => void | Promise<void>;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}> = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const { getFrequency, getLevelName, getLanguageFeatures, getCanonicalForm } = useLanguage();
  const { getCardByWordSync, getComprehensiveWordStatusSync } = useFlashcards();

  const currentFlashcard = createMemo(() => getCardByWordSync(props.entry.word));
  const isTracked = createMemo(() => props.isAdding || currentFlashcard() !== null);
  const currentEase = createMemo(() => currentFlashcard()?.ease);
  const effectiveStatus = createMemo(() => getComprehensiveWordStatusSync(props.entry.word));

  const wordForms = createMemo(() => getWordFormCandidates(props.entry.word, getCanonicalForm));
  const primaryWord = createMemo(() => wordForms()[0] ?? props.entry.word);

  const ankiMatch = createMemo(() => {
    if (!settings.use_anki) return null;
    void props.ankiCacheReady();
    return findAnkiWordMatchInCache(wordForms());
  });

  const isInAnki = createMemo(() => !!ankiMatch());

  const pitchData = createMemo(() => {
    const features = getLanguageFeatures();
    if (!features.supportsPitchAccent || !settings.showPitchAccent || !props.translation?.data) {
      return null;
    }
    const reading = normalizeReading(extractReadingFromEntries(props.translation.data));
    const position = extractPitchAccentFromTranslationData(props.translation);
    if (!reading || reading.length === 0 || position === undefined) {
      return null;
    }
    return { reading, position };
  });

  const effectiveReading = createMemo(() => pitchData()?.reading || props.entry.word);

  const needsFurigana = createMemo(() => {
    const word = props.entry.word;
    const reading = effectiveReading();
    if (!reading || reading === word) return false;
    if (isAllKana(word)) return false;
    return containsKanji(word);
  });

  const levelData = createMemo(() => {
    const freq = getFrequency(props.entry.word);
    if (freq) {
      return { level: freq.raw_level, name: freq.level };
    }
    return null;
  });

  const posLabel = createMemo(() => props.entry.token.partOfSpeech || props.entry.token.type || '');

  const shortMeaning = createMemo(() => {
    const entry = props.translation?.data?.[0];
    if (!entry || !('definitions' in entry)) return '';
    const defs = entry.definitions;
    if (!defs) return '';
    const first = Array.isArray(defs) ? defs[0] : defs;
    if (!first) return '';
    const clean = first.replace(/<[^>]*>/g, '').trim();
    return clean.length > 40 ? clean.slice(0, 40) + '…' : clean;
  });

  return (
    <article
      class="unknown-words-item"
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <div class="unknown-words-item-header">
        <div class="unknown-words-item-word">
          <Show when={pitchData()} fallback={
            <Show when={needsFurigana()} fallback={props.entry.word}>
              <ruby>{props.entry.word}<rt>{effectiveReading()}</rt></ruby>
            </Show>
          }>
            {(pitch) => (
              <Show when={needsFurigana()} fallback={
                <PitchAccentOverlay
                  word={props.entry.word}
                  reading={pitch().reading}
                  pitchPosition={pitch().position}
                  mode="overlay"
                  homogenous={true}
                >
                  {props.entry.word}
                </PitchAccentOverlay>
              }>
                <ruby>
                  {props.entry.word}
                  <rt>
                    <PitchAccentOverlay
                      word={props.entry.word}
                      reading={pitch().reading}
                      pitchPosition={pitch().position}
                      mode="overlay"
                      homogenous={true}
                    >
                      {pitch().reading}
                    </PitchAccentOverlay>
                  </rt>
                </ruby>
              </Show>
            )}
          </Show>
        </div>
        <Show when={shortMeaning()}>
          <span class="unknown-words-item-meaning">{shortMeaning()}</span>
        </Show>
      </div>
      <div class="unknown-words-item-pills">
        <Show when={levelData()}>
          {(level) => (
            <PillLabel level={level().level}>{level().name || getLevelName(level().level)}</PillLabel>
          )}
        </Show>
        <Show when={settings.show_pos && posLabel()}>
          <PillLabel>{posLabel()}</PillLabel>
        </Show>
        <WordStatusPill word={props.entry.word} />
        <PillBtn
          variant="gray"
          label={t('mlearn.Sidebar.Ignore')}
          onClick={() => props.onIgnoreWord(props.entry)}
          disabled={props.isIgnored}
        />
        <ResourcePill
          word={props.entry.word}
          isTracked={isTracked()}
          isAdding={props.isAdding}
          isInAnki={isInAnki()}
          ankiWord={ankiMatch()?.word ?? primaryWord()}
          ease={currentEase()}
          effectiveStatus={effectiveStatus()}
          onAdd={() => props.onAddWord(props.entry)}
        />
      </div>
    </article>
  );
};

export const UnknownWordsSidebar: Component<UnknownWordsSidebarProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { hasWordSync, isWordIgnoredSync } = useFlashcards();
  const { getFrequency } = useLanguage();
  const { translateWord } = useTranslation({ immediate: true, language: settings.language });
  const [translations, setTranslations] = createStore<Record<string, TranslationResponse | null | undefined>>({});
  const requestedWords = new Set<string>();
  const [sortKey, setSortKey] = createSignal(props.defaultSort);
  const [category, setCategory] = createSignal<SidebarCategory>('all');
  const [ankiCacheReady, setAnkiCacheReady] = createSignal(isAnkiCacheFetched());

  createEffect(() => {
    if (!settings.use_anki) {
      setAnkiCacheReady(false);
      return;
    }

    if (isAnkiCacheFetched()) {
      setAnkiCacheReady(true);
      return;
    }

    void fetchAnkiWordsCache().then(() => {
      setAnkiCacheReady(true);
    });
  });

  createEffect(() => {
    if (!props.failedWordSet && category() === 'failed') {
      setCategory('all');
    }
  });

  createEffect(() => {
    for (const entry of props.words()) {
      if (translations[entry.word] !== undefined || requestedWords.has(entry.word)) continue;
      const cached = getCachedTranslation(entry.word, settings.language);
      if (cached) {
        setTranslations(entry.word, cached);
        continue;
      }
      requestedWords.add(entry.word);
      void translateWord(entry.word)
        .then((translation) => setTranslations(entry.word, translation))
        .catch(() => setTranslations(entry.word, null));
    }
  });

  const addableEntries = createMemo(() =>
    props.words().filter((entry) =>
      !props.addingWordKeys().has(entry.key) && !hasWordSync(entry.word) && !isWordIgnoredSync(entry.word)
    )
  );

  const dictionaryFoundWords = createMemo(() =>
    props.words().filter((entry) => hasDictionaryEntry(translations[entry.word]))
  );

  const dictionaryFoundAddable = createMemo(() =>
    addableEntries().filter((entry) => hasDictionaryEntry(translations[entry.word]))
  );

  const failedCategoryWords = createMemo(() => {
    const failedWords = props.failedWordSet?.();
    if (!failedWords) {
      return [] as SidebarWordEntry[];
    }

    return props.words().filter((entry) => failedWords.has(entry.word));
  });

  const filteredWords = createMemo(() => {
    if (category() === 'dictionary') {
      return dictionaryFoundWords();
    }

    if (category() === 'failed') {
      return failedCategoryWords();
    }

    return props.words();
  });

  const visibleAddableEntries = createMemo(() => {
    if (category() === 'dictionary') {
      return dictionaryFoundAddable();
    }

    if (category() === 'failed') {
      const failedWords = props.failedWordSet?.();
      if (!failedWords) {
        return [] as SidebarWordEntry[];
      }
      return addableEntries().filter((entry) => failedWords.has(entry.word));
    }

    return addableEntries();
  });

  const visibleDictionaryFoundAddable = createMemo(() =>
    visibleAddableEntries().filter((entry) => hasDictionaryEntry(translations[entry.word]))
  );

  const sortedBase = createMemo(() => {
    const base = filteredWords();
    const key = sortKey();
    if (key === props.defaultSort) return base;
    const sorted = [...base];
    if (key === 'level') {
      sorted.sort((a, b) => {
        const fa = getFrequency(a.word);
        const fb = getFrequency(b.word);
        return (fb?.raw_level ?? -1) - (fa?.raw_level ?? -1);
      });
    } else if (key === 'word') {
      sorted.sort((a, b) => a.word.localeCompare(b.word));
    }
    return sorted;
  });

  const visibleWords = createMemo(() => sortedBase());
  const emptyStateMessage = createMemo(() =>
    category() === 'failed'
      ? props.failedEmptyMessage ?? props.emptyMessage
      : props.emptyMessage
  );

  let sidebarRef: HTMLElement | undefined;

  return (
    <aside class={`unknown-words-sidebar panel ${props.class || ''}`} ref={sidebarRef}>
      <CollapsibleStickyHeader
        getScrollContainer={() => sidebarRef}
        class="unknown-words-sticky-header"
      >
        <div class="unknown-words-sidebar-header">
          <div class="unknown-words-sidebar-title-row">
            <div class="unknown-words-sidebar-title-col">
              <h2 class="unknown-words-sidebar-title">{t('mlearn.Sidebar.UnknownWords')}</h2>
              <div class="unknown-words-sidebar-count">
                {t('mlearn.Sidebar.WordCount', { count: visibleWords().length })}
              </div>
            </div>
            <Select
              class="unknown-words-sort-select"
              value={sortKey()}
              onChange={(e) => setSortKey(e.currentTarget.value)}
              options={props.sortOptions()}
            />
          </div>
          <div class="unknown-words-sidebar-categories">
            <PillBtn
              size="sm"
              variant={category() === 'all' ? 'blue' : 'gray'}
              label={t('mlearn.AITutorSetup.AllLevels')}
              onClick={() => setCategory('all')}
              aria-pressed={category() === 'all'}
            />
            <PillBtn
              size="sm"
              variant={category() === 'dictionary' ? 'blue' : 'gray'}
              label={t('mlearn.Sidebar.DictionaryOnly')}
              onClick={() => setCategory('dictionary')}
              aria-pressed={category() === 'dictionary'}
            />
            <Show when={props.failedWordSet}>
              <PillBtn
                size="sm"
                variant={category() === 'failed' ? 'blue' : 'gray'}
                label={t('mlearn.ConversationAgent.Stats.FailedWords')}
                onClick={() => setCategory('failed')}
                aria-pressed={category() === 'failed'}
              />
            </Show>
          </div>
          <div class="unknown-words-sidebar-actions">
            <Btn
              size="sm"
              variant="primary"
              label={props.isAddingAll() ? t('mlearn.Sidebar.AddingAll') : t('mlearn.Sidebar.AddAll')}
              onClick={() => props.onAddAllClick(visibleAddableEntries(), visibleDictionaryFoundAddable())}
              disabled={props.isAddingAll() || visibleAddableEntries().length === 0}
            />
          </div>
        </div>
      </CollapsibleStickyHeader>
      <Show
        when={visibleWords().length > 0}
        fallback={<div class="unknown-words-empty">{emptyStateMessage()}</div>}
      >
        <div class="unknown-words-list">
          <For each={visibleWords()}>
            {(entry) => (
              <UnknownWordRow
                entry={entry}
                translation={translations[entry.word]}
                ankiCacheReady={ankiCacheReady}
                isAdding={props.addingWordKeys().has(entry.key)}
                isIgnored={isWordIgnoredSync(entry.word)}
                onAddWord={props.onAddWord}
                onIgnoreWord={props.onIgnoreWord}
                onMouseEnter={props.onWordHover ? () => props.onWordHover!(entry) : undefined}
                onMouseLeave={props.onWordLeave}
              />
            )}
          </For>
        </div>
      </Show>
      {props.footer}
    </aside>
  );
};
