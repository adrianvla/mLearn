/**
 * Word Entry Row Component
 * Single row in the word database editor
 */

import { Component, Show, createMemo } from 'solid-js';
import { GlassBtn, PillLabel, StatusLabel } from '../../../components/common';
import { WORD_STATUS } from '../../../../shared/constants';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../../../utils/pitchAccent';
import { useSettings, useLocalization } from '../../../context';

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
  
  // Generate pitch accent HTML
  const pitchAccentHtml = createMemo(() => {
    if (settings.language !== 'ja' || !settings.showPitchAccent) return '';
    const pitch = props.entry.pitch;
    const reading = props.entry.reading || props.entry.word;
    
    if (pitch === null || pitch === undefined) return '';
    if (!reading || reading.length <= 1) return '';
    
    const info = getPitchAccentInfo(pitch, reading);
    if (!info) return '';
    
    return buildPitchAccentHtml(info, reading.length, {
      includeParticleBox: true,
      homogenous: true,
    });
  });
  
  return (
    <div class="entry">
      <div class="col word">
        <span class="word-text" style={{ position: 'relative' }}>
          {props.entry.word}
          <Show when={pitchAccentHtml()}>
            <div
              class="mLearn-pitch-accent"
              style={{ '--pitch-accent-height': '3px' } as any}
              innerHTML={pitchAccentHtml()}
            />
          </Show>
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
      <div class="col translation" title={props.entry.fullTranslation}>
        {props.entry.translation || '-'}
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
          <GlassBtn
            variant="danger"
            size="sm"
            onClick={() => props.onRemoveFlashcard(props.entry)}
          >
            {t('mlearn.Global.Remove')}
          </GlassBtn>
        </Show>
        <Show when={props.entry.tracker !== 'flashcards'}>
          <GlassBtn
            variant="primary"
            size="sm"
            onClick={() => props.onAddFlashcard(props.entry)}
          >
            {t('mlearn.Global.Add')}
          </GlassBtn>
        </Show>
      </div>
      <div class="col status">
        <div class="status-pill-group">
          <StatusLabel
            status="unknown"
            active={props.entry.status === WORD_STATUS.UNKNOWN}
            onClick={() => props.onStatusChange(props.entry, WORD_STATUS.UNKNOWN)}
            showIcon={false}
          />
          <StatusLabel
            status="learning"
            active={props.entry.status === WORD_STATUS.LEARNING}
            onClick={() => props.onStatusChange(props.entry, WORD_STATUS.LEARNING)}
            showIcon={false}
          />
          <StatusLabel
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
