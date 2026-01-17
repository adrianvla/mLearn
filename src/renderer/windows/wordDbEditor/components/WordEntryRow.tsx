/**
 * Word Entry Row Component
 * Single row in the word database editor
 */

import { Component, Show } from 'solid-js';
import { GlassButton, Pill, StatusPill } from '../../../components/common';
import { WORD_STATUS } from '../../../../shared/constants';

export interface WordEntry {
  uuid: string;
  word: string;
  translation: string;
  reading: string;
  level: number;
  tracker: string;
  status: number;
  fullTranslation?: string;
}

export interface WordEntryRowProps {
  entry: WordEntry;
  levelNames: Record<number, string>;
  onStatusChange: (entry: WordEntry, newStatus: number) => void;
  onAddFlashcard: (entry: WordEntry) => void;
  onRemoveFlashcard: (entry: WordEntry) => void;
}

const getStatusType = (status: number): 'unknown' | 'learning' | 'known' => {
  switch (status) {
    case WORD_STATUS.LEARNING:
      return 'learning';
    case WORD_STATUS.KNOWN:
      return 'known';
    default:
      return 'unknown';
  }
};

export const WordEntryRow: Component<WordEntryRowProps> = (props) => {
  return (
    <div class="entry">
      <div class="col word">
        <span>{props.entry.word}</span>
        <Show when={props.entry.reading}>
          <span class="reading">{props.entry.reading}</span>
        </Show>
      </div>
      <div class="col translation" title={props.entry.fullTranslation}>
        {props.entry.translation}
      </div>
      <div class="col level">
        <Show when={props.entry.level >= 0}>
          <Pill level={props.entry.level}>
            {props.levelNames[props.entry.level] || `Level ${props.entry.level}`}
          </Pill>
        </Show>
        <Show when={props.entry.level < 0}>-</Show>
      </div>
      <div class="col tracker">
        <span class="tracker-label">{props.entry.tracker}</span>
        <Show when={props.entry.tracker === 'flashcards'}>
          <GlassButton
            variant="danger"
            size="sm"
            onClick={() => props.onRemoveFlashcard(props.entry)}
          >
            Remove
          </GlassButton>
        </Show>
        <Show when={props.entry.tracker !== 'flashcards'}>
          <GlassButton
            variant="primary"
            size="sm"
            onClick={() => props.onAddFlashcard(props.entry)}
          >
            Add
          </GlassButton>
        </Show>
      </div>
      <div class="col status">
        <div class="status-pill-group">
          <StatusPill
            status="unknown"
            active={props.entry.status === WORD_STATUS.UNKNOWN}
            onClick={() => props.onStatusChange(props.entry, WORD_STATUS.UNKNOWN)}
            showIcon={false}
          />
          <StatusPill
            status="learning"
            active={props.entry.status === WORD_STATUS.LEARNING}
            onClick={() => props.onStatusChange(props.entry, WORD_STATUS.LEARNING)}
            showIcon={false}
          />
          <StatusPill
            status="known"
            active={props.entry.status === WORD_STATUS.KNOWN}
            onClick={() => props.onStatusChange(props.entry, WORD_STATUS.KNOWN)}
            showIcon={false}
          />
        </div>
      </div>
    </div>
  );
};

export default WordEntryRow;
