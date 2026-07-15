import { Component, For, Show, Accessor, createEffect, createMemo, createSignal, JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Token, TranslationEntry, TranslationResponse } from '../../../shared/types';
import { Btn, CloseIcon, CollapsibleStickyHeader, IconBtn, PillBtn, PillLabel, Select } from '../common';
import { ProsodyOverlay, WordWithReading } from '../language-specific';
import type { WordWithReadingRenderTextOptions } from '../language-specific/WordWithReading';
import { ResourcePill, WordStatusPill } from '../common/Smart';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { getCachedTranslation, useTranslation } from '../../hooks/useTranslation';
import {
  extractReadingFromEntries,
  resolveProsodyForHover,
} from '../subtitle/wordHoverHelpers';
import { normalizeDictionaryReading } from '../../utils/readingProsody';
import { fetchAnkiWordsCache, findAnkiWordMatchInCache, isAnkiCacheFetched } from '../../services/ankiWordsCache';
import { getWordFormCandidates } from '../../utils/wordForms';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import { getProsodyOverlayTextTarget } from '../../utils/prosodyOverlayTarget';
import { compareFrequencyLevelsForDisplay, getFrequencyLevelVisualRank } from '../../../shared/languageFeatures';
import { prosodyVisible } from '../../../shared/prosodySettings';
import './UnknownWordsSidebar.css';

export function hasDictionaryEntry(translation: TranslationResponse | null | undefined): boolean {
  if (!translation?.data) return false;
  for (const entry of translation.data) {
    if (entry && typeof entry === 'object' && 'definitions' in entry) {
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
  onClose?: () => void;
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
  const { getFrequency, getLevelName, getFreqLevelNames, getCanonicalForm, getWordVariants, currentLangData } = useLanguage();
  const { getCardByWordSync, getComprehensiveWordStatusSync } = useFlashcards();
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));

  const currentFlashcard = createMemo(() => getCardByWordSync(props.entry.word, settings.language));
  const isTracked = createMemo(() => props.isAdding || currentFlashcard() !== null);
  const currentEase = createMemo(() => currentFlashcard()?.ease);
  const effectiveStatus = createMemo(() => getComprehensiveWordStatusSync(props.entry.word, settings.language));

  const wordForms = createMemo(() => (
    getWordFormCandidates(props.entry.word, getCanonicalForm, getWordVariants, {
      languageData: currentLangData(),
    })
  ));
  const primaryWord = createMemo(() => wordForms()[0] ?? props.entry.word);
  const ankiCacheOptions = createMemo(() => ({
    language: settings.language,
    languageData: currentLangData(),
  }));

  const ankiMatch = createMemo(() => {
    if (!settings.use_anki) return null;
    void props.ankiCacheReady();
    return findAnkiWordMatchInCache(wordForms(), ankiCacheOptions());
  });

  const isInAnki = createMemo(() => !!ankiMatch());

  const dictionaryReading = createMemo(() => {
    if (!props.translation?.data) return '';
    return normalizeDictionaryReading(extractReadingFromEntries(props.translation.data), currentLangData());
  });

  const rowProsody = createMemo(() => {
    return resolveProsodyForHover({
      word: props.entry.word,
      reading: dictionaryReading(),
      translationData: props.translation ? { data: props.translation.data } : undefined,
      showProsody: prosodyVisible(settings),
      getCanonicalForm,
      getWordVariants,
      getCachedTranslation,
      language: settings.language,
      languageData: currentLangData(),
      dictionaryTargetLanguage,
      fallbackLabel: t('mlearn.CardEditor.Fields.ProsodyPosition'),
    });
  });
  const renderReadingText = (text: JSX.Element, options: WordWithReadingRenderTextOptions) => {
    const prosody = rowProsody();
    if (!prosody || prosody.renderer !== 'inline-overlay') {
      return <span class={options.class} style={options.style}>{text}</span>;
    }
    const overlayTarget = getProsodyOverlayTextTarget(
      props.entry.word,
      prosody.reading || dictionaryReading() || props.entry.word,
      options,
    );
    return (
      <ProsodyOverlay
        word={overlayTarget.word}
        reading={overlayTarget.reading}
        pos={props.entry.token.partOfSpeech || props.entry.token.type}
        prosodyPosition={prosody.position}
        prosodyType={prosody.type}
        languageData={currentLangData()}
        mode="overlay"
        isReadingScript={options.isReadingScript}
        class={options.slot === 'reading' ? 'prosody-overlay-wrapper--reading' : options.class}
        style={options.style}
      >
        {text}
      </ProsodyOverlay>
    );
  };

  const levelData = createMemo(() => {
    const freq = getFrequency(props.entry.word);
    if (freq) {
      return {
        level: freq.raw_level,
        visualLevel: getFrequencyLevelVisualRank(freq.raw_level, getFreqLevelNames(), currentLangData()),
        name: freq.level,
      };
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
          <WordWithReading
            word={props.entry.word}
            reading={dictionaryReading()}
            renderText={renderReadingText}
          />
        </div>
        <Show when={shortMeaning()}>
          <span class="unknown-words-item-meaning">{shortMeaning()}</span>
        </Show>
      </div>
      <div class="unknown-words-item-pills">
        <Show when={levelData()}>
          {(level) => (
            <PillLabel level={level().level} visualLevel={level().visualLevel}>
              {level().name || getLevelName(level().level)}
            </PillLabel>
          )}
        </Show>
        <Show when={settings.show_pos && posLabel()}>
          <PillLabel>{posLabel()}</PillLabel>
        </Show>
        <Show when={rowProsody()?.renderer === 'label' ? rowProsody() : null}>
          {(prosody) => (
            <PillLabel variant="gray" class="prosody-position-pill">
              <span class="prosody-position-pill__label">{prosody().label}</span>
              <span class="prosody-position-pill__value">{prosody().value}</span>
            </PillLabel>
          )}
        </Show>
        <WordStatusPill word={props.entry.word} language={settings.language} />
        <PillBtn
          variant="gray"
          label={t('mlearn.Sidebar.Ignore')}
          onClick={() => props.onIgnoreWord(props.entry)}
          disabled={props.isIgnored}
        />
        <ResourcePill
          word={props.entry.word}
          language={settings.language}
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
  const { currentLangData, getFrequency, getCanonicalForm, getWordVariants, getReadingVariants } = useLanguage();
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const wordLookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };
  const { translateWord } = useTranslation({
    immediate: true,
    language: settings.language,
    ...wordLookupOptions,
  });
  const [translations, setTranslations] = createStore<Record<string, TranslationResponse | null | undefined>>({});
  const requestedWords = new Set<string>();
  const [sortKey, setSortKey] = createSignal(props.defaultSort);
  const [category, setCategory] = createSignal<SidebarCategory>('all');
  const ankiCacheOptions = createMemo(() => ({
    language: settings.language,
    languageData: currentLangData(),
  }));
  const [ankiCacheReady, setAnkiCacheReady] = createSignal(isAnkiCacheFetched(ankiCacheOptions()));

  createEffect(() => {
    if (!settings.use_anki) {
      setAnkiCacheReady(false);
      return;
    }

    const options = ankiCacheOptions();
    if (isAnkiCacheFetched(options)) {
      setAnkiCacheReady(true);
      return;
    }

    void fetchAnkiWordsCache(options).then(() => {
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
      const cached = getCachedTranslation(entry.word, settings.language, wordLookupOptions);
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
      !props.addingWordKeys().has(entry.key)
      && !hasWordSync(entry.word, settings.language)
      && !isWordIgnoredSync(entry.word, settings.language)
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
        if (!fa && !fb) return 0;
        if (!fa) return 1;
        if (!fb) return -1;
        return compareFrequencyLevelsForDisplay(fa.raw_level, fb.raw_level, currentLangData());
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
            <div class="unknown-words-sidebar-title-actions">
              <Select
                class="unknown-words-sort-select"
                value={sortKey()}
                onChange={(e) => setSortKey(e.currentTarget.value)}
                options={props.sortOptions()}
              />
              <Show when={props.onClose}>
                <IconBtn
                  size="sm"
                  variant="ghost"
                  icon={<CloseIcon size={16} />}
                  aria-label={t('mlearn.Global.Aria.Close')}
                  onClick={() => props.onClose?.()}
                />
              </Show>
            </div>
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
                isIgnored={isWordIgnoredSync(entry.word, settings.language)}
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
