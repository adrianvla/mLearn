import { Component, For, Show, createEffect, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import { WORD_STATUS } from '../../../../../shared/constants';
import type { Token, TranslationResponse } from '../../../../../shared/types';
import type { OcrBox } from '../../../../components/reader/OcrOverlay';
import { Btn, ClockIcon, PillBtn, PillLabel, PitchAccentOverlay } from '../../../../components/common';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../../context';
import { getCachedTranslation, useTranslation } from '../../../../hooks/useTranslation';
import { setWordStatus, wordsLearnedInApp } from '../../../../services/statsService';
import {
  extractPitchAccentFromTranslationData,
  extractReadingFromEntries,
  getEffectiveWordStatus,
  numericToWordStatus,
  wordStatusToNumeric,
  type WordStatus,
} from '../../../../components/subtitle/wordHoverHelpers';
import { normalizeReading } from '../../../../../shared/utils/textUtils';
import { containsKanji, isAllKana } from '../../../../../shared/utils/textUtils';
import './ReaderUnknownWordsSidebar.css';

const ICON_CROSS2 = 'cross2';
const ICON_CHECK = 'check';

export interface ReaderUnknownWordEntry {
  key: string;
  word: string;
  token: Token;
  contextPhrase: string;
  pageId: string;
  box: OcrBox;
  boxIndex: number;
}

interface ReaderUnknownWordsSidebarProps {
  words: () => ReaderUnknownWordEntry[];
  addingWordKeys: () => Set<string>;
  isAddingAll: () => boolean;
  onAddWord: (entry: ReaderUnknownWordEntry) => void | Promise<void>;
  onAddAll: (entries: ReaderUnknownWordEntry[]) => void | Promise<void>;
  onIgnoreWord: (entry: ReaderUnknownWordEntry) => void | Promise<void>;
}

const UnknownWordRow: Component<{
  entry: ReaderUnknownWordEntry;
  translation: TranslationResponse | null | undefined;
  isAdding: boolean;
  isIgnored: boolean;
  onAddWord: (entry: ReaderUnknownWordEntry) => void | Promise<void>;
  onIgnoreWord: (entry: ReaderUnknownWordEntry) => void | Promise<void>;
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

  const effectiveReading = createMemo(() => {
    return pitchData()?.reading || props.entry.word;
  });

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

  const cycleStatus = () => {
    const order: WordStatus[] = ['unknown', 'learning', 'known'];
    const current = manualStatus();
    const next = order[(order.indexOf(current) + 1) % order.length];
    setWordStatus(props.entry.word, wordStatusToNumeric(next));
  };

  return (
    <article class="reader-unknown-words-item">
      <div class="reader-unknown-words-item-header">
        <div class="reader-unknown-words-item-word">
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
      </div>
      <div class="reader-unknown-words-item-pills">
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
          label={t('mlearn.Reader.Sidebar.IgnoreWord')}
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
                label={t('mlearn.Flashcards.Card.Tracked')}
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
        <Show when={isTracked() && (currentEase() !== undefined)}>
          <div class="reader-unknown-words-ease">
            <span>{t('mlearn.Flashcards.Card.Ease')} {Math.round((currentEase() ?? 0) * 100) / 100}</span>
          </div>
        </Show>
      </div>
    </article>
  );
};

export const ReaderUnknownWordsSidebar: Component<ReaderUnknownWordsSidebarProps> = (props) => {
  const { t } = useLocalization();
  const { hasWordSync, isWordIgnoredSync } = useFlashcards();
  const { translateWord } = useTranslation({ immediate: true });
  const [translations, setTranslations] = createStore<Record<string, TranslationResponse | null | undefined>>({});
  const requestedWords = new Set<string>();

  createEffect(() => {
    for (const entry of props.words()) {
      if (translations[entry.word] !== undefined || requestedWords.has(entry.word)) {
        continue;
      }

      const cached = getCachedTranslation(entry.word);
      if (cached) {
        setTranslations(entry.word, cached);
        continue;
      }

      requestedWords.add(entry.word);
      void translateWord(entry.word)
        .then((translation) => {
          setTranslations(entry.word, translation);
        })
        .catch(() => {
          setTranslations(entry.word, null);
        });
    }
  });

  const addableEntries = createMemo(() => props.words().filter((entry) => !props.addingWordKeys().has(entry.key) && !hasWordSync(entry.word) && !isWordIgnoredSync(entry.word)));

  return (
    <aside class="reader-unknown-words-sidebar panel">
      <div class="reader-unknown-words-sidebar-header">
        <div>
          <h2 class="reader-unknown-words-sidebar-title">{t('mlearn.Reader.Sidebar.UnknownWords')}</h2>
          <div class="reader-unknown-words-sidebar-count">
            {t('mlearn.Reader.Sidebar.UnknownWordsCount', { count: props.words().length })}
          </div>
        </div>
        <Btn
          size="sm"
          variant="primary"
          label={props.isAddingAll() ? t('mlearn.Reader.Sidebar.AddingAllFlashcards') : t('mlearn.Reader.Sidebar.AddAllFlashcards')}
          onClick={() => props.onAddAll(addableEntries())}
          disabled={props.isAddingAll() || addableEntries().length === 0}
        />
      </div>
      <Show
        when={props.words().length > 0}
        fallback={<div class="reader-unknown-words-empty">{t('mlearn.Reader.Sidebar.UnknownWordsEmpty')}</div>}
      >
        <div class="reader-unknown-words-list">
          <For each={props.words()}>
            {(entry) => (
              <UnknownWordRow
                entry={entry}
                translation={translations[entry.word]}
                isAdding={props.addingWordKeys().has(entry.key)}
                isIgnored={isWordIgnoredSync(entry.word)}
                onAddWord={props.onAddWord}
                onIgnoreWord={props.onIgnoreWord}
              />
            )}
          </For>
        </div>
      </Show>
    </aside>
  );
};