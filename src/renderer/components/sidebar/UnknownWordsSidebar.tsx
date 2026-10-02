import { Component, For, Show, Accessor, createEffect, createMemo, createSignal, JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Token, TranslationEntry, TranslationResponse } from '../../../shared/types';
import { Button, CloseIcon, CollapsibleStickyHeader, PillLabel, Select } from '../common';
import { WordWithReading } from '../language-specific';
import { ResourcePill } from '../common/Smart';
import { resolveCapturedWordEligibility, type CapturedWordIneligibility } from '../../services/wordCaptureEligibility';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { getCachedTranslation, useTranslation } from '../../hooks/useTranslation';
import {
  resolveWordHoverContent,
  resolveProsodyForHover,
} from '../subtitle/wordHoverHelpers';
import { normalizeDictionaryReading } from '../../utils/readingProsody';
import { ankiCacheVersion, findAnkiWordMatchInCache, isAnkiCacheFetched } from '../../services/ankiWordsCache';
import { getWordFormCandidates } from '../../utils/wordForms';
import { useDictionaryTargetLanguage } from '../../hooks/useDictionaryTargetLanguage';
import type { WordProsodyOverlayData, WordRenderTextContext } from '../../utils/wordRenderText';
import { compareFrequencyLevelsForDisplay, getFrequencyLevelVisualRank, getPartOfSpeechColor } from '../../../shared/languageFeatures';
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
  hideEmptyCount?: boolean;
  class?: string;
  onClose?: () => void;
  onPracticeWords?: (entries: SidebarWordEntry[]) => void;
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
  const { getComprehensiveWordStatusWithSourceSync, getAccessStatus, isKnowledgeReady } = useFlashcards();
  const dictionaryTargetLanguage = useDictionaryTargetLanguage();
  const encounteredSurface = () => props.entry.token.surface ?? props.entry.token.word;

  const comprehensiveKnowledge = createMemo(() => (
    getComprehensiveWordStatusWithSourceSync(props.entry.word, settings.language)
  ));
  const wordIsKnown = createMemo(() => isKnowledgeReady() && comprehensiveKnowledge().status === 'known');
  const getWordColor = createMemo((): string | undefined => {
    // Knowledge-derived coloring stays neutral until the projection hydrates
    // (and stays neutral across store re-delivery when the gate reopens).
    if (!isKnowledgeReady()) return undefined;
    if (!settings.enableWordColoring) return undefined;
    if (!settings.colorKnownWords && wordIsKnown()) return undefined;
    if (!settings.do_colour_codes) return undefined;
    const pos = props.entry.token.partOfSpeech || props.entry.token.type;
    if (!pos) return undefined;
    return getPartOfSpeechColor(pos, settings.colour_codes, currentLangData());
  });
  const coloredProsodyCtx: WordRenderTextContext = {
    languageData: currentLangData,
    prosodyPosition: () => rowProsody()?.position ?? null,
    prosodyKnowledge: () => getAccessStatus(props.entry.word, 'prosodic-pattern', settings.language),
    partOfSpeechColor: getWordColor,
    surface: 'other',
    settings: () => settings,
  };

  const wordForms = createMemo(() => (
    getWordFormCandidates(props.entry.word, getCanonicalForm, getWordVariants, {
      languageData: currentLangData(),
      language: settings.language,
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
    return normalizeDictionaryReading(resolveWordHoverContent(
      props.entry.token.reading,
      props.translation ?? undefined,
      undefined,
      currentLangData(),
      { word: props.entry.word, surface: encounteredSurface() },
    ).reading, currentLangData());
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

  const prosodyOverlayData = createMemo<WordProsodyOverlayData | null>(() => {
    const prosody = rowProsody();
    if (!prosody || prosody.renderer !== 'inline-overlay') return null;
    return {
      position: prosody.position,
      type: prosody.type,
      pos: props.entry.token.partOfSpeech || props.entry.token.type,
      surfaceReading: prosody.reading || dictionaryReading() || props.entry.word,
    };
  });

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
        <button type="button" class="unknown-words-item-word"
          aria-label={t('mlearn.Sidebar.InspectWord', { word: props.entry.word })}
          onClick={() => {
            openKnowledgeInspector(surfaceKnowledgeInspection(settings.language, props.entry.word));
          }}>
          <WordWithReading
            word={props.entry.word}
            reading={dictionaryReading()}
            coloredProsody={coloredProsodyCtx}
            prosodyOverlay={prosodyOverlayData()}
          />
        </button>
        <Show when={shortMeaning()}>
          <span class="unknown-words-item-meaning">{shortMeaning()}</span>
        </Show>
      </div>
      <Show when={encounteredSurface() !== props.entry.word}>
        <small class="unknown-words-item-context">{t('mlearn.Sidebar.EncounteredAs', { surface: encounteredSurface() })}</small>
      </Show>
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
      </div>
      <details class="unknown-words-item-management">
        <summary>{t('mlearn.Sidebar.SaveOrExclude')}</summary>
        <div class="unknown-words-item-pills">
          <Button buttonType="pill"
            variant="gray"
            label={t('mlearn.Sidebar.ExcludeFromStudy')}
            onClick={() => props.onIgnoreWord(props.entry)}
            disabled={props.isIgnored}
          />
          <ResourcePill
            word={props.entry.word}
            language={settings.language}
            isAdding={props.isAdding}
            isInAnki={isInAnki()}
            ankiWord={ankiMatch()?.word ?? primaryWord()}
            onAdd={() => props.onAddWord(props.entry)}
          />
        </div>
      </details>
    </article>
  );
};

export const UnknownWordsSidebar: Component<UnknownWordsSidebarProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { getCardByWordSync, getComprehensiveWordStatusWithSourceSync } = useFlashcards();
  const { currentLangData, getFrequency, getCanonicalForm, getWordVariants, getReadingVariants } = useLanguage();
  const dictionaryTargetLanguage = useDictionaryTargetLanguage();
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
  const ankiCacheReady = createMemo(() => {
    ankiCacheVersion();
    return settings.use_anki && isAnkiCacheFetched(ankiCacheOptions());
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

  /**
   * Why each captured word cannot become a card, resolved by the one owner of
   * that rule.
   *
   * The two reasons are kept apart because the sidebar presents them apart: a
   * word that is already a card is not offered, while an excluded word is shown
   * with its add control disabled so the learner can see why it is still here.
   */
  const ineligibilityByWord = createMemo(() => {
    const ineligibility = new Map<string, CapturedWordIneligibility>();
    for (const entry of props.words()) {
      const resolved = resolveCapturedWordEligibility(
        entry.word,
        settings.language,
        Boolean(getCardByWordSync(entry.word, settings.language)),
        getComprehensiveWordStatusWithSourceSync(entry.word, settings.language).excluded === true,
      );
      if (!resolved.eligible && resolved.reason) ineligibility.set(entry.word, resolved.reason);
    }
    return ineligibility;
  });

  const excludedByWord = createMemo(() => {
    const excluded = new Set<string>();
    for (const [word, reason] of ineligibilityByWord()) {
      if (reason === 'excluded') excluded.add(word);
    }
    return excluded;
  });

  const addableEntries = createMemo(() =>
    props.words().filter((entry) =>
      !props.addingWordKeys().has(entry.key)
      && !ineligibilityByWord().has(entry.word)
    )
  );

  const dictionaryFoundWords = createMemo(() =>
    props.words().filter((entry) =>
      !excludedByWord().has(entry.word) && hasDictionaryEntry(translations[entry.word])
    )
  );

  const dictionaryFoundAddable = createMemo(() =>
    addableEntries().filter((entry) => hasDictionaryEntry(translations[entry.word]))
  );

  const failedCategoryWords = createMemo(() => {
    const failedWords = props.failedWordSet?.();
    if (!failedWords) {
      return [] as SidebarWordEntry[];
    }

    return props.words().filter((entry) =>
      !excludedByWord().has(entry.word) && failedWords.has(entry.word)
    );
  });

  const filteredWords = createMemo(() => {
    if (category() === 'dictionary') {
      return dictionaryFoundWords();
    }

    if (category() === 'failed') {
      return failedCategoryWords();
    }

    return props.words().filter((entry) => !excludedByWord().has(entry.word));
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
              <h2 class="unknown-words-sidebar-title">{t('mlearn.Sidebar.Vocabulary')}</h2>
              <Show when={!props.hideEmptyCount || visibleWords().length > 0}>
                <div class="unknown-words-sidebar-count">
                  {t('mlearn.Sidebar.WordCount', { count: visibleWords().length })}
                </div>
              </Show>
            </div>
            <div class="unknown-words-sidebar-title-actions">
              <Show when={props.onClose}>
                <Button buttonType="icon"
                  size="sm"
                  variant="ghost"
                  icon={<CloseIcon size={16} />}
                  aria-label={t('mlearn.Global.Close')}
                  onClick={() => props.onClose?.()}
                />
              </Show>
            </div>
          </div>
          <p class="unknown-words-sidebar-guidance">{t('mlearn.Sidebar.InspectionHint')}</p>
          <Show when={props.onPracticeWords}>
            <Button variant="primary" size="sm"
              label={t('mlearn.Sidebar.RecallWords', { count: visibleWords().length })}
              disabled={visibleWords().length === 0}
              onClick={() => props.onPracticeWords?.(visibleWords())} />
          </Show>
          <details class="unknown-words-sidebar-tools">
            <summary>{t('mlearn.Sidebar.FilterAndSave')}</summary>
            <Select
              class="unknown-words-sort-select"
              value={sortKey()}
              onChange={(e) => setSortKey(e.currentTarget.value)}
              options={props.sortOptions()}
            />
            <div class="unknown-words-sidebar-categories">
              <Button buttonType="pill"
                size="sm"
                variant={category() === 'all' ? 'blue' : 'gray'}
                label={t('mlearn.AITutorSetup.AllLevels')}
                onClick={() => setCategory('all')}
                aria-pressed={category() === 'all'}
              />
              <Button buttonType="pill"
                size="sm"
                variant={category() === 'dictionary' ? 'blue' : 'gray'}
                label={t('mlearn.Sidebar.DictionaryOnly')}
                onClick={() => setCategory('dictionary')}
                aria-pressed={category() === 'dictionary'}
              />
              <Show when={props.failedWordSet}>
                <Button buttonType="pill"
                  size="sm"
                  variant={category() === 'failed' ? 'blue' : 'gray'}
                  label={t('mlearn.ConversationAgent.Stats.HoveredWords')}
                  onClick={() => setCategory('failed')}
                  aria-pressed={category() === 'failed'}
                />
              </Show>
            </div>
            <div class="unknown-words-sidebar-actions">
              <Button
                size="sm"
                variant="ghost"
                label={props.isAddingAll() ? t('mlearn.Sidebar.AddingAll') : t('mlearn.Sidebar.SaveAllForReview')}
                onClick={() => props.onAddAllClick(visibleAddableEntries(), visibleDictionaryFoundAddable())}
                disabled={props.isAddingAll() || visibleAddableEntries().length === 0}
              />
            </div>
          </details>
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
                isIgnored={ineligibilityByWord().get(entry.word) === 'excluded'}
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
