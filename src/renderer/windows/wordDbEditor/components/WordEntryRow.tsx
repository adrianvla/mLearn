/**
 * Word Entry Row Component
 * Single row in the word database editor
 * Lazily fetches translation from backend when visible
 */

import { Component, Show, createMemo, createSignal, onMount, onCleanup } from 'solid-js';
import { Btn, PillLabel, StatusLabel, numericToStatus, statusToNumeric, getNextStatus, PitchAccentOverlay } from '../../../components/common';
import { useSettings, useLocalization } from '../../../context';
import { getCachedTranslation } from '../../../hooks/useTranslation';
import type { TranslationResponse, TranslationEntry } from '../../../../shared/types';

/**
 * Shared translation fetch queue to avoid overwhelming the backend.
 * Processes translation requests in batches with concurrency control.
 */
const translationQueue: Array<{ word: string; resolve: (t: string) => void }> = [];
let isProcessingQueue = false;
const BATCH_SIZE = 5;
const BATCH_DELAY = 50;

function enqueueTranslation(word: string, translationUrl: string): Promise<string> {
  return new Promise((resolve) => {
    translationQueue.push({ word, resolve });
    if (!isProcessingQueue) {
      processQueue(translationUrl);
    }
  });
}

async function processQueue(translationUrl: string): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (translationQueue.length > 0) {
    const batch = translationQueue.splice(0, BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ word, resolve }) => {
        try {
          const response = await fetch(translationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word }),
          });
          if (!response.ok) {
            resolve('');
            return;
          }
          const data = await response.json() as TranslationResponse;
          const entry = data?.data?.[0] as TranslationEntry | undefined;
          if (entry?.definitions) {
            const defs = Array.isArray(entry.definitions) ? entry.definitions : [entry.definitions];
            const short = defs.slice(0, 3).join(', ');
            resolve(short);
          } else {
            resolve('');
          }
        } catch {
          resolve('');
        }
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
}

export interface WordEntryRowProps {
  entry: WordEntry;
  levelNames: Record<number, string>;
  onStatusChange: (entry: WordEntry, newStatus: number) => void;
  onAddFlashcard: (entry: WordEntry) => void;
  onRemoveFlashcard: (entry: WordEntry) => void;
  onEdit?: (entry: WordEntry) => void;
}

export const WordEntryRow: Component<WordEntryRowProps> = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();
  const [fetchedTranslation, setFetchedTranslation] = createSignal('');
  let rowRef: HTMLDivElement | undefined;
  let observer: IntersectionObserver | undefined;
  let fetched = false;

  // Determine the translation to display: prop > fetched > cache > empty
  const displayTranslation = createMemo(() => {
    if (props.entry.translation) return props.entry.translation;
    if (fetchedTranslation()) return fetchedTranslation();
    const cached = getCachedTranslation(props.entry.word);
    if (cached) return extractTranslation(cached);
    return '';
  });

  // Lazily fetch translation when the row becomes visible
  onMount(() => {
    if (props.entry.translation || getCachedTranslation(props.entry.word)) {
      // Already have translation, no need to fetch
      if (!props.entry.translation && getCachedTranslation(props.entry.word)) {
        setFetchedTranslation(extractTranslation(getCachedTranslation(props.entry.word)!));
      }
      return;
    }

    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !fetched) {
          fetched = true;
          observer?.disconnect();
          enqueueTranslation(props.entry.word, settings.getTranslationUrl).then((t) => {
            if (t) setFetchedTranslation(t);
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
        <span class="word-text" style={{ position: 'relative' }}>
          <PitchAccentOverlay
            word={props.entry.word}
            reading={props.entry.reading || props.entry.word}
            pitchPosition={props.entry.pitch}
            mode="overlay"
            homogenous={true}
          >
            {props.entry.word}
          </PitchAccentOverlay>
        </span>
        <Show when={props.entry.reading && props.entry.reading !== props.entry.word}>
          <span class="reading">{props.entry.reading}</span>
        </Show>
        <Show when={props.onEdit}>
          <button
            class="edit-btn"
            onClick={() => props.onEdit?.(props.entry)}
            title={t('mlearn.WordDbEditor.EditTranslation.Tooltip')}
          >
            {t('mlearn.Global.Edit')}
          </button>
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
        <span class="tracker-label">{props.entry.tracker}</span>
        <Show when={props.entry.tracker === 'flashcards'}>
          <Btn
            variant="danger"
            size="sm"
            onClick={() => props.onRemoveFlashcard(props.entry)}
          >
            {t('mlearn.Global.Remove')}
          </Btn>
        </Show>
        <Show when={props.entry.tracker !== 'flashcards'}>
          <Btn
            variant="primary"
            size="sm"
            onClick={() => props.onAddFlashcard(props.entry)}
          >
            {t('mlearn.Global.Add')}
          </Btn>
        </Show>
      </div>
      <div class="col status">
        <StatusLabel
          status={numericToStatus(props.entry.status)}
          active={true}
          onClick={() => {
            const currentStatus = numericToStatus(props.entry.status);
            const nextStatus = getNextStatus(currentStatus);
            props.onStatusChange(props.entry, statusToNumeric(nextStatus));
          }}
          showIcon={false}
        />
      </div>
    </div>
  );
};

export default WordEntryRow;
