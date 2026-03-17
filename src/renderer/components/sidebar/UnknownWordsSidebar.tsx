import { Component, For, Show, Accessor, createEffect, createMemo, createSignal, JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { WORD_STATUS } from '../../../shared/constants';
import type { Token, TranslationEntry, TranslationResponse } from '../../../shared/types';
import { Btn, ClockIcon, CollapsibleStickyHeader, PillBtn, PillLabel, PitchAccentOverlay, Select, ToggleSwitch } from '../common';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import { getCachedTranslation, useTranslation } from '../../hooks/useTranslation';
import { setWordStatus, wordsLearnedInApp } from '../../services/statsService';
import {
  extractPitchAccentFromTranslationData,
  extractReadingFromEntries,
  getEffectiveWordStatus,
  numericToWordStatus,
  wordStatusToNumeric,
  type WordStatus,
} from '../subtitle/wordHoverHelpers';
import { normalizeReading, containsKanji, isAllKana } from '../../../shared/utils/textUtils';
import './UnknownWordsSidebar.css';

const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';

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

const UnknownWordRow: Component<{
  entry: SidebarWordEntry;
  translation: TranslationResponse | null | undefined;
  isAdding: boolean;
  isIgnored: boolean;
  onAddWord: (entry: SidebarWordEntry) => void | Promise<void>;
  onIgnoreWord: (entry: SidebarWordEntry) => void | Promise<void>;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}> = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const { getFrequency, getLevelName, getLanguageFeatures } = useLanguage();
  const { hasWordSync, getCardByWordSync } = useFlashcards();

  const currentFlashcard = createMemo(() => getCardByWordSync(props.entry.word));
  const manualStatus = createMemo(() => numericToWordStatus(wordsLearnedInApp()[props.entry.word] ?? WORD_STATUS.UNKNOWN));
  const effectiveStatus = createMemo(() => getEffectiveWordStatus(currentFlashcard(), manualStatus()));
  const isTracked = createMemo(() => props.isAdding || hasWordSync(props.entry.word));
  const currentEase = createMemo(() => currentFlashcard()?.ease);

  const pitchData = createMemo(() => {
    const features = getLanguageFeatures();
    if (!features.supportsPitchAccent || !settings.showPitchAccent || !props.translation?.data) {
      return null;
    }
    const reading = normalizeReading(extractReadingFromEntries(props.translation.data));
    const position = extractPitchAccentFromTranslationData(props.translation);
    if (!reading || reading.length <= 1 || position === undefined) {
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

  const statusVariant = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown' ? 'red' : status === 'learning' ? 'orange' : 'green';
  });

  const statusIcon = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown' ? ICON_CROSS2 : ICON_CHECK;
  });

  const statusLabel = createMemo(() => {
    const status = effectiveStatus();
    return status === 'unknown'
      ? t('mlearn.WordHover.Status.Unknown')
      : status === 'learning'
        ? t('mlearn.WordHover.Status.Learning')
        : t('mlearn.WordHover.Status.Known');
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

  const cycleStatus = () => {
    const order: WordStatus[] = ['unknown', 'learning', 'known'];
    const current = manualStatus();
    const next = order[(order.indexOf(current) + 1) % order.length];
    setWordStatus(props.entry.word, wordStatusToNumeric(next));
  };

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
        <PillBtn
          variant={statusVariant()}
          icon={statusIcon()}
          label={statusLabel()}
          onClick={cycleStatus}
        />
        <PillBtn
          variant="gray"
          label={t('mlearn.Sidebar.Ignore')}
          onClick={() => props.onIgnoreWord(props.entry)}
          disabled={props.isIgnored}
        />
        <Show
          when={isTracked()}
          fallback={
            <PillBtn
              variant="blue"
              icon={ICON_CROSS2}
              iconRotation={45}
              label={t('mlearn.Global.Flashcard')}
              onClick={() => props.onAddWord(props.entry)}
              disabled={props.isAdding}
            />
          }
        >
          <Show
            when={props.isAdding}
            fallback={
              <PillBtn
                variant="green"
                icon={ICON_CHECK}
                label={currentEase() !== undefined
                  ? `${t('mlearn.Flashcards.Card.Ease')} ${Math.round((currentEase()!) * 100) / 100}`
                  : t('mlearn.Flashcards.Card.Tracked')
                }
              />
            }
          >
            <PillBtn
              variant="yellow"
              icon={<ClockIcon size={14} />}
              label={t('mlearn.Global.Status.Adding')}
              disabled={true}
            />
          </Show>
        </Show>
      </div>
    </article>
  );
};

export const UnknownWordsSidebar: Component<UnknownWordsSidebarProps> = (props) => {
  const { t } = useLocalization();
  const { hasWordSync, isWordIgnoredSync } = useFlashcards();
  const { getFrequency } = useLanguage();
  const { translateWord } = useTranslation({ immediate: true });
  const [translations, setTranslations] = createStore<Record<string, TranslationResponse | null | undefined>>({});
  const requestedWords = new Set<string>();
  const [sortKey, setSortKey] = createSignal(props.defaultSort);
  const [dictionaryOnly, setDictionaryOnly] = createSignal(true);

  createEffect(() => {
    for (const entry of props.words()) {
      if (translations[entry.word] !== undefined || requestedWords.has(entry.word)) continue;
      const cached = getCachedTranslation(entry.word);
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

  const sortedBase = createMemo(() => {
    const base = dictionaryOnly() ? dictionaryFoundWords() : props.words();
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
          <div class="unknown-words-sidebar-actions">
            <ToggleSwitch
              checked={dictionaryOnly()}
              onChange={setDictionaryOnly}
              label={t('mlearn.Sidebar.DictionaryOnly')}
            />
            <Btn
              size="sm"
              variant="primary"
              label={props.isAddingAll() ? t('mlearn.Sidebar.AddingAll') : t('mlearn.Sidebar.AddAll')}
              onClick={() => props.onAddAllClick(addableEntries(), dictionaryFoundAddable())}
              disabled={props.isAddingAll() || addableEntries().length === 0}
            />
          </div>
        </div>
      </CollapsibleStickyHeader>
      <Show
        when={props.words().length > 0}
        fallback={<div class="unknown-words-empty">{props.emptyMessage}</div>}
      >
        <div class="unknown-words-list">
          <For each={visibleWords()}>
            {(entry) => (
              <UnknownWordRow
                entry={entry}
                translation={translations[entry.word]}
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
