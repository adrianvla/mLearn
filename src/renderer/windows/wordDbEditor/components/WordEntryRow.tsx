/**
 * Word Entry Row Component
 * Single row in the word database editor
 * Lazily fetches translation from backend when visible
 */

import { Component, Show, For, createEffect, createMemo, createSignal, onMount, onCleanup, type JSX } from 'solid-js';
import { Btn, PillLabel, AnkiHoverPreview } from '../../../components/common';
import { ProsodyOverlay, WordWithReading } from '../../../components/language-specific';
import type { WordWithReadingRenderTextOptions } from '../../../components/language-specific/WordWithReading';
import { WordStatusPill } from '../../../components/common/Smart';
import type { AnkiCardFields, AnkiCardSchedulingInfo } from '../../../components/common';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { cacheVersion, getCachedTranslation, getCachedReading, fetchTranslation, type WordLookupCandidateOptions } from '../../../hooks/useTranslation';
import { getDictionaryTargetLanguageForSettings } from '../../../utils/dictionaryTargetLanguage';
import { getProsodyOverlayRenderer } from '../../../utils/prosodyPresentation';
import { getProsodyOverlayTextTarget } from '../../../utils/prosodyOverlayTarget';
import {
  extractProsodyFromTranslationData,
  normalizeDictionaryReading,
  resolveStoredProsodyForDisplayedReading,
} from '../../../utils/readingProsody';
import type { FlashcardProsody, LanguageData, TranslationResponse, TranslationEntry } from '../../../../shared/types';
import type { WordStatus } from '../../../components/subtitle/wordHoverHelpers';
import {
  getFrequencyLevelLabel,
  getFrequencyLevelVisualRank,
  getLanguageProsodyType,
  getProsodyPositionFromOverride,
  isDisplayableFrequencyLevel,
} from '../../../../shared/languageFeatures';
import { prosodyVisible } from '../../../../shared/prosodySettings';
import './WordEntryRow.css';
import { getLogger } from '../../../../shared/utils/logger';
import { getBackend } from '../../../../shared/backends';

const log = getLogger("renderer.wordDbEditor.wordEntryRow");

/** Export result state for per-row Anki feedback */
export type AnkiExportState = 'idle' | 'exporting' | 'exported' | 'duplicate' | 'error';

/**
 * Shared translation fetch queue to avoid overwhelming the backend.
 * Uses fetchTranslation which populates the global translation cache,
 * so getCachedReading/getCachedTranslation work after fetch.
 */
const translationQueue: Array<{ word: string; language: string; lookupOptions: WordLookupCandidateOptions; resolve: () => void }> = [];
let isProcessingQueue = false;
const BATCH_SIZE = 5;
const BATCH_DELAY = 50;
const MAX_QUEUE_SIZE = 200;

function enqueueTranslationFetch(word: string, language: string, lookupOptions: WordLookupCandidateOptions): Promise<void> {
  return new Promise((resolve) => {
    translationQueue.push({ word, language, lookupOptions, resolve });
    if (translationQueue.length > MAX_QUEUE_SIZE) {
      const dropped = translationQueue.splice(0, translationQueue.length - MAX_QUEUE_SIZE);
      for (const item of dropped) item.resolve();
    }
    if (!isProcessingQueue) {
      processQueue();
    }
  });
}

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (translationQueue.length > 0) {
    const batch = translationQueue.splice(0, BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ word, language, lookupOptions, resolve }) => {
        try {
          await fetchTranslation(word, language, lookupOptions);
        } catch (e) {
          log.error("error", e);
        }
        resolve();
      })
    );
    if (translationQueue.length > 0) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY));
    }
  }

  isProcessingQueue = false;
}

/** Extract a short translation string from a cached TranslationResponse */
function extractTranslation(resp: TranslationResponse): string {
  const entry = resp?.data?.[0] as TranslationEntry | undefined;
  if (!entry?.definitions) return '';
  const defs = Array.isArray(entry.definitions) ? entry.definitions : [entry.definitions];
  return defs.slice(0, 3).join(', ');
}

function extractProsodyFromCacheForReading(
  word: string,
  language: string,
  lookupOptions: WordLookupCandidateOptions,
  languageData: LanguageData | null,
  displayedReading: string,
): FlashcardProsody | undefined {
  const cached = getCachedTranslation(word, language, lookupOptions);
  if (!cached?.data) return undefined;

  return extractProsodyFromTranslationData(cached, languageData, displayedReading);
}

export interface WordEntry {
  uuid: string;
  word: string;
  translation: string;
  reading: string;
  level: number | null;
  tracker: string;
  status: number;
  /** The comprehensive knowledge source that determined this word's status */
  knowledgeSource?: string;
  fullTranslation?: string;
  prosodyPosition?: number | null;
  prosody?: FlashcardProsody;
  ignoredAt?: number;
  /** Additional readings for words that have multiple independent senses */
  alternateReadings?: string[];
  /** Expression that matched the Anki cache, if it differs from the displayed dictionary word. */
  ankiLookupWord?: string;
}

export interface WordEntryRowProps {
  entry: WordEntry;
  levelNames: Record<number, string>;
  onStatusChange: (entry: WordEntry, newStatus: WordStatus) => void;
  onAddFlashcard: (entry: WordEntry) => void;
  onRemoveFlashcard: (entry: WordEntry) => void;
  onUnignore?: (entry: WordEntry) => void;
  onEditFlashcard?: (entry: WordEntry) => void;
  onEdit?: (entry: WordEntry) => void;
  onExportToAnki?: (entry: WordEntry) => void;
  onAnkiPreview?: (entry: WordEntry) => void;
  ankiExportState?: AnkiExportState;
  isInAnki?: boolean;
}

export const WordEntryRow: Component<WordEntryRowProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { currentLangData, getCanonicalForm, getWordVariants, getReadingVariants } = useLanguage();
  // Signals bumped after fetch to trigger re-reads of cache
  const [fetchVersion, setFetchVersion] = createSignal(0);
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const lookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };
  const prosodyOverlayRenderer = createMemo(() => (
    getProsodyOverlayRenderer(currentLangData(), props.entry.prosody?.type)
  ));
  const canRenderProsodyOverlay = createMemo(() => (
    prosodyOverlayRenderer() !== null
    && prosodyVisible(settings)
  ));
  let rowRef: HTMLDivElement | undefined;

  // Effective reading: translation cache reading > freq data > word
  const effectiveReading = createMemo(() => {
    fetchVersion(); // re-evaluate when fetch completes
    cacheVersion(); // re-evaluate when another surface warms the shared cache
    const cached = getCachedReading(props.entry.word, settings.language, lookupOptions);
    return cached || props.entry.reading || props.entry.word;
  });

  const storedProsodyForDisplayedReading = (displayedReading: string): FlashcardProsody | undefined => {
    if (!props.entry.prosody || !displayedReading) return undefined;
    const languageData = currentLangData();
    const savedDisplayReadings = [
      props.entry.reading,
      effectiveReading(),
      ...(props.entry.alternateReadings ?? []),
    ];
    return resolveStoredProsodyForDisplayedReading({
      prosody: props.entry.prosody,
      displayedReading,
      savedReadings: savedDisplayReadings,
      languageData,
    });
  };

  const cachedProsodyForDisplayedReading = (displayedReading: string): FlashcardProsody | undefined => {
    if (!canRenderProsodyOverlay() || !displayedReading) return undefined;
    fetchVersion();
    cacheVersion();
    const languageData = currentLangData();
    const storedReadingProsody = storedProsodyForDisplayedReading(displayedReading);
    if (storedReadingProsody) return storedReadingProsody;
    const cacheKeys = [displayedReading, props.entry.word].filter((key, index, all) => (
      key && all.indexOf(key) === index
    ));
    for (const cacheKey of cacheKeys) {
      const prosody = extractProsodyFromCacheForReading(cacheKey, settings.language, lookupOptions, languageData, displayedReading);
      if (prosody) return prosody;
    }
    return undefined;
  };

  const prosodyPositionForDisplayedReading = (displayedReading: string): number | null => {
    if (!canRenderProsodyOverlay() || !displayedReading) return null;
    const languageData = currentLangData();
    const normalizedDisplayed = normalizeDictionaryReading(displayedReading, languageData);
    const normalizedEntryReading = normalizeDictionaryReading(props.entry.reading, languageData);
    const storedPosition = normalizedDisplayed && normalizedDisplayed === normalizedEntryReading
      ? props.entry.prosodyPosition ?? null
      : null;

    return getProsodyPositionFromOverride(
      storedPosition,
      cachedProsodyForDisplayedReading(displayedReading)
    );
  };

  const prosodyTypeForDisplayedReading = (displayedReading: string): FlashcardProsody['type'] | undefined => (
    cachedProsodyForDisplayedReading(displayedReading)?.type
    ?? props.entry.prosody?.type
    ?? getLanguageProsodyType(currentLangData())
  );

  const displayableLevel = createMemo(() => (
    isDisplayableFrequencyLevel(props.entry.level, props.levelNames, currentLangData())
  ));
  const renderedLevel = createMemo((): number | null => (
    displayableLevel() ? props.entry.level : null
  ));

  const renderEntryWordText = (text: JSX.Element, options: WordWithReadingRenderTextOptions) => {
    if (!canRenderProsodyOverlay()) {
      return <span class={options.class} style={options.style}>{text}</span>;
    }

    const overlayTarget = getProsodyOverlayTextTarget(props.entry.word, effectiveReading(), options);

    return (
      <ProsodyOverlay
        word={overlayTarget.word}
        reading={overlayTarget.reading}
        prosodyPosition={prosodyPositionForDisplayedReading(overlayTarget.reading)}
        prosodyType={prosodyTypeForDisplayedReading(overlayTarget.reading)}
        languageData={currentLangData()}
        mode="overlay"
        homogenous={true}
        isReadingScript={options.isReadingScript}
        class={options.slot === 'reading' ? 'prosody-overlay-wrapper--reading' : options.class}
        style={options.style}
      >
        {text}
      </ProsodyOverlay>
    );
  };

  // Determine the translation to display: prop > cache > empty
  const displayTranslation = createMemo(() => {
    fetchVersion(); // re-evaluate when fetch completes
    cacheVersion(); // re-evaluate when another surface warms the shared cache
    if (props.entry.translation) return props.entry.translation;
    const cached = getCachedTranslation(props.entry.word, settings.language, lookupOptions);
    if (cached) return extractTranslation(cached);
    return '';
  });

  // Alternate readings to show: all known readings that differ from the displayed one
  const visibleAlternateReadings = createMemo(() => {
    const displayed = effectiveReading();
    const primary = props.entry.reading;
    const alternates = props.entry.alternateReadings || [];
    // Collect all unique readings from freq data (primary + alternates)
    const all = new Set<string>();
    if (primary) all.add(primary);
    for (const r of alternates) all.add(r);
    // Remove the currently displayed one
    all.delete(displayed);
    return Array.from(all);
  });

  const trackerLabel = createMemo(() => {
    if (props.entry.tracker === 'flashcards') return t('mlearn.WordDbEditor.Trackers.Flashcards');
    if (props.entry.tracker === 'anki') return t('mlearn.WordDbEditor.Trackers.Anki');
    if (props.entry.tracker === 'ignored') return t('mlearn.WordDbEditor.Trackers.Ignored');
    return t('mlearn.WordDbEditor.Trackers.Nothing');
  });

  // Anki hover preview state
  const [ankiHoverCard, setAnkiHoverCard] = createSignal<AnkiCardFields | null>(null);
  const [ankiHoverLoading, setAnkiHoverLoading] = createSignal(false);
  const [ankiHoverCardInfo, setAnkiHoverCardInfo] = createSignal<AnkiCardSchedulingInfo | null>(null);
  let ankiHoverFetched = false;

  createEffect(() => {
    props.entry.word;
    props.entry.ankiLookupWord;
    props.entry.tracker;
    ankiHoverFetched = false;
    setAnkiHoverCard(null);
    setAnkiHoverCardInfo(null);
    setAnkiHoverLoading(false);
  });

  const fetchAnkiCard = async () => {
    if (props.entry.tracker !== 'anki') return;
    if (ankiHoverFetched) return;
    ankiHoverFetched = true;
    setAnkiHoverLoading(true);
    try {
      const lookupWord = props.entry.ankiLookupWord || props.entry.word;
      const result = await getBackend().getCard({ word: lookupWord }) as {
        cards: Array<{
          fields: AnkiCardFields;
          factor?: number;
          due?: number;
          queue?: number;
          type?: number;
          interval?: number;
          mod?: number;
        }>;
        error: boolean;
        poor: boolean;
      };
      if (!result.error && result.cards.length > 0) {
        const card = result.cards[0];
        setAnkiHoverCard(card.fields || null);
        setAnkiHoverCardInfo({
          ease: card.factor ?? null,
          due: card.due ?? null,
          queue: card.queue ?? null,
          type: card.type ?? null,
          interval: card.interval ?? null,
          mod: card.mod ?? null,
        });
      }
    } catch (e) {
      log.error("error", e);
      // ignore
    } finally {
      setAnkiHoverLoading(false);
    }
  };

  let fetchTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    const wordsToFetch = [props.entry.word, ...visibleAlternateReadings()].filter((word, index, words) => (
      word && words.indexOf(word) === index
    ));
    const missingWords = wordsToFetch.filter((word) => !getCachedTranslation(word, settings.language, lookupOptions));
    if (missingWords.length === 0) {
      setFetchVersion((v) => v + 1);
      return;
    }

    fetchTimer = setTimeout(() => {
      Promise.all(
        missingWords.map((word) => enqueueTranslationFetch(word, settings.language, lookupOptions))
      ).then(() => {
        setFetchVersion((v) => v + 1);
      });
    }, 300);
  });

  onCleanup(() => {
    if (fetchTimer) clearTimeout(fetchTimer);
  });
  
  return (
    <div class="entry" ref={rowRef}>
      <div class="col word">
        <WordWithReading
          word={props.entry.word}
          reading={effectiveReading()}
          language={settings.language}
          languageData={currentLangData()}
          class="word-text"
          renderText={renderEntryWordText}
        />
        <Show when={props.onEdit}>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => props.onEdit?.(props.entry)}
            title={t('mlearn.WordDbEditor.EditTranslation.Tooltip')}
          >
            {t('mlearn.Global.Edit')}
          </Btn>
        </Show>
        <Show when={visibleAlternateReadings().length > 0}>
          <span class="word-db-alt-readings">
            <For each={visibleAlternateReadings()}>
              {(altReading) => {
                const alternateProsody = () => cachedProsodyForDisplayedReading(altReading);
                const prosodyPosition = () => {
                  const storedPosition = normalizeDictionaryReading(props.entry.reading, currentLangData()) === normalizeDictionaryReading(altReading, currentLangData())
                    ? props.entry.prosodyPosition ?? null
                    : null;
                  return getProsodyPositionFromOverride(storedPosition, alternateProsody());
                };
                return (
                  <Show
                    when={canRenderProsodyOverlay() && prosodyPosition() !== null}
                    fallback={<span>{altReading}</span>}
                  >
                    <ProsodyOverlay
                      word={altReading}
                      reading={altReading}
                      prosodyPosition={prosodyPosition()}
                      prosodyType={alternateProsody()?.type ?? getLanguageProsodyType(currentLangData())}
                      languageData={currentLangData()}
                      mode="pill"
                      homogenous={true}
                    />
                  </Show>
                );
              }}
            </For>
          </span>
        </Show>
      </div>
      <div class="col translation" title={props.entry.fullTranslation || displayTranslation()}>
        {displayTranslation() || '-'}
      </div>
      <div class="col level">
        <Show when={renderedLevel() !== null}>
          <PillLabel
            level={renderedLevel()!}
            visualLevel={getFrequencyLevelVisualRank(renderedLevel()!, props.levelNames, currentLangData())}
          >
            {getFrequencyLevelLabel(renderedLevel()!, props.levelNames, currentLangData())}
          </PillLabel>
        </Show>
        <Show when={renderedLevel() === null}>-</Show>
      </div>
      <div class="col tracker">
        <Show when={props.entry.tracker === 'anki'} fallback={
          <span class="tracker-label">{trackerLabel()}</span>
        }>
          <AnkiHoverPreview
            loading={ankiHoverLoading()}
            fields={ankiHoverCard()}
            cardInfo={ankiHoverCardInfo()}
            onShow={fetchAnkiCard}
            position="bottom"
            class="tracker-label tracker-label--anki"
          >
            {trackerLabel()}
          </AnkiHoverPreview>
        </Show>
        <Show when={props.entry.tracker === 'flashcards'}>
          <Show when={props.onEditFlashcard}>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => props.onEditFlashcard?.(props.entry)}
            >
              {t('mlearn.Global.Edit')}
            </Btn>
          </Show>
          <Btn
            variant="danger"
            size="sm"
            onClick={() => props.onRemoveFlashcard(props.entry)}
          >
            {t('mlearn.Global.Remove')}
          </Btn>
        </Show>
        <Show when={props.entry.tracker === 'ignored' && props.onUnignore}>
          <Btn
            variant="secondary"
            size="sm"
            onClick={() => props.onUnignore?.(props.entry)}
          >
            {t('mlearn.WordDbEditor.Actions.Unignore')}
          </Btn>
        </Show>
        <Show when={props.entry.tracker !== 'flashcards' && props.entry.tracker !== 'ignored' && props.entry.tracker !== 'anki'}>
          <Btn
            variant="primary"
            size="sm"
            onClick={() => props.onAddFlashcard(props.entry)}
          >
            {t('mlearn.Global.Add')}
          </Btn>
        </Show>
        <Show when={props.onAnkiPreview && props.isInAnki}>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => props.onAnkiPreview?.(props.entry)}
            title={t('mlearn.WordDbEditor.Anki.PreviewTitle', { word: props.entry.word })}
          >
            {t('mlearn.WordDbEditor.Anki.Preview')}
          </Btn>
        </Show>
        <Show when={props.onExportToAnki && !props.isInAnki}>
          <Btn
            variant={props.ankiExportState === 'exported' || props.ankiExportState === 'duplicate' ? 'ghost' : 'secondary'}
            size="sm"
            loading={props.ankiExportState === 'exporting'}
            disabled={props.ankiExportState === 'exported' || props.ankiExportState === 'duplicate'}
            onClick={() => props.onExportToAnki?.(props.entry)}
            title={t('mlearn.WordDbEditor.Anki.ExportToAnki')}
          >
            {props.ankiExportState === 'exported'
              ? t('mlearn.WordDbEditor.Anki.Exported')
              : props.ankiExportState === 'duplicate'
                ? t('mlearn.WordDbEditor.Anki.AlreadyInAnki')
                : props.ankiExportState === 'error'
                  ? t('mlearn.WordDbEditor.Anki.ExportFailed')
                  : t('mlearn.WordDbEditor.Anki.ExportToAnki')}
          </Btn>
        </Show>
      </div>
      <div class="col status">
        <WordStatusPill
          word={props.entry.word}
          onStatusChange={(status) => props.onStatusChange(props.entry, status)}
        />
      </div>
    </div>
  );
};

export default WordEntryRow;
