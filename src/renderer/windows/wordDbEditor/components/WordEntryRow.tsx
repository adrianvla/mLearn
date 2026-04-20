/**
 * Word Entry Row Component
 * Single row in the word database editor
 * Lazily fetches translation from backend when visible
 */

import { Component, Show, For, createMemo, createSignal, onMount, onCleanup } from 'solid-js';
import { Btn, PillLabel, PitchAccentOverlay, AnkiHoverPreview, Tooltip } from '../../../components/common';
import { WordStatusPill } from '../../../components/common/Smart';
import type { AnkiCardFields, AnkiCardSchedulingInfo } from '../../../components/common';
import { useLocalization } from '../../../context';
import { getCachedTranslation, getCachedReading, fetchTranslation } from '../../../hooks/useTranslation';
import { extractPitchPosition } from '../../../utils/translationCacheParsers';
import type { TranslationResponse, TranslationEntry } from '../../../../shared/types';
import type { WordStatus } from '../../../components/subtitle/wordHoverHelpers';
import { containsKanji, isAllKana } from '../../../../shared/utils/textUtils';
import './WordEntryRow.css';

/** Export result state for per-row Anki feedback */
export type AnkiExportState = 'idle' | 'exporting' | 'exported' | 'duplicate' | 'error';

/**
 * Shared translation fetch queue to avoid overwhelming the backend.
 * Uses fetchTranslation which populates the global translation cache,
 * so getCachedReading/getCachedTranslation work after fetch.
 */
const translationQueue: Array<{ word: string; resolve: () => void }> = [];
let isProcessingQueue = false;
const BATCH_SIZE = 5;
const BATCH_DELAY = 50;

function enqueueTranslationFetch(word: string): Promise<void> {
  return new Promise((resolve) => {
    translationQueue.push({ word, resolve });
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
      batch.map(async ({ word, resolve }) => {
        try {
          await fetchTranslation(word);
        } catch (e) {
          console.error(e);
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

/** Extract pitch accent position from cached translation data */
function extractPitchFromCache(word: string): number | null {
  const cached = getCachedTranslation(word);
  if (!cached?.data) return null;

  return extractPitchPosition(cached.data[2]);
}

export interface WordEntry {
  uuid: string;
  word: string;
  translation: string;
  reading: string;
  level: number;
  tracker: string;
  status: number;
  fullTranslation?: string;
  pitch?: number | null;
  ignoredAt?: number;
  /** Additional readings for words that have multiple independent senses */
  alternateReadings?: string[];
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
  // Signals bumped after fetch to trigger re-reads of cache
  const [fetchVersion, setFetchVersion] = createSignal(0);
  let rowRef: HTMLDivElement | undefined;
  let observer: IntersectionObserver | undefined;
  let fetched = false;

  // Effective reading: translation cache reading > freq data > word
  const effectiveReading = createMemo(() => {
    fetchVersion(); // re-evaluate when fetch completes
    const cached = getCachedReading(props.entry.word);
    return cached || props.entry.reading || props.entry.word;
  });

  // Effective pitch: explicit prop > cache (reactive via fetchVersion)
  const effectivePitch = createMemo((): number | null => {
    if (props.entry.pitch !== undefined && props.entry.pitch !== null) {
      return props.entry.pitch;
    }
    fetchVersion(); // re-evaluate when fetch completes
    return extractPitchFromCache(props.entry.word);
  });

  // Whether the word needs furigana (has kanji and reading differs)
  const needsFurigana = createMemo(() => {
    const word = props.entry.word;
    const reading = effectiveReading();
    if (!reading || reading === word) return false;
    if (isAllKana(word)) return false;
    return containsKanji(word);
  });

  // Determine the translation to display: prop > cache > empty
  const displayTranslation = createMemo(() => {
    fetchVersion(); // re-evaluate when fetch completes
    if (props.entry.translation) return props.entry.translation;
    const cached = getCachedTranslation(props.entry.word);
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

  const fetchAnkiCard = async () => {
    if (props.entry.tracker !== 'anki') return;
    if (ankiHoverFetched) return;
    ankiHoverFetched = true;
    setAnkiHoverLoading(true);
    try {
      const { getBackend } = await import('../../../../shared/backends');
      const result = await getBackend().getCard({ word: props.entry.word }) as {
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
      if (!result.error && !result.poor && result.cards.length > 0) {
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
      console.error(e);
      // ignore
    } finally {
      setAnkiHoverLoading(false);
    }
  };

  // Lazily fetch translation when the row becomes visible.
  // Uses fetchTranslation which populates the global cache (reading + translation + pitch).
  onMount(() => {
    if (props.entry.translation && getCachedTranslation(props.entry.word)) {
      return;
    }
    // If already cached, just bump version to read from cache
    if (getCachedTranslation(props.entry.word)) {
      setFetchVersion((v) => v + 1);
      return;
    }

    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !fetched) {
          fetched = true;
          observer?.disconnect();
          enqueueTranslationFetch(props.entry.word).then(() => {
            setFetchVersion((v) => v + 1);
          });
        }
      },
      { threshold: 0 }
    );
    if (rowRef) observer.observe(rowRef);
  });

  onCleanup(() => {
    observer?.disconnect();
  });
  
  return (
    <div class="entry" ref={rowRef}>
      <div class="col word">
        <span class="word-text">
          <Show when={needsFurigana()} fallback={
            <PitchAccentOverlay
              word={props.entry.word}
              reading={effectiveReading()}
              pitchPosition={effectivePitch()}
              mode="overlay"
              homogenous={true}
            >
              {props.entry.word}
            </PitchAccentOverlay>
          }>
            <ruby class="word-db-ruby">
              {props.entry.word}
              <rt>
                <span class="word-db-ruby-rt">
                  <PitchAccentOverlay
                    word={props.entry.word}
                    reading={effectiveReading()}
                    pitchPosition={effectivePitch()}
                    mode="overlay"
                    homogenous={true}
                  >
                    {effectiveReading()}
                  </PitchAccentOverlay>
                </span>
              </rt>
            </ruby>
          </Show>
        </span>
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
              {(altReading) => (
                <PitchAccentOverlay
                  word={props.entry.word}
                  reading={altReading}
                  mode="pill"
                  showParticleBox={true}
                  homogenous={true}
                />
              )}
            </For>
          </span>
        </Show>
      </div>
      <div class="col translation" title={props.entry.fullTranslation || displayTranslation()}>
        {displayTranslation() || '-'}
      </div>
      <div class="col level">
        <Show when={props.entry.level >= 0}>
          <PillLabel level={props.entry.level}>
            {props.levelNames[props.entry.level] || `Level ${props.entry.level}`}
          </PillLabel>
        </Show>
        <Show when={props.entry.level < 0}>-</Show>
      </div>
      <div class="col tracker">
        <Show when={props.entry.tracker === 'anki'} fallback={
          <span class="tracker-label">{trackerLabel()}</span>
        }>
          <Tooltip
            content={
              <AnkiHoverPreview
                loading={ankiHoverLoading()}
                fields={ankiHoverCard()}
                cardInfo={ankiHoverCardInfo()}
              />
            }
            position="bottom"
            onShow={fetchAnkiCard}
            class="tracker-label tracker-label--anki"
          >
            {trackerLabel()}
          </Tooltip>
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
