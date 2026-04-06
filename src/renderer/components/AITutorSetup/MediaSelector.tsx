/**
 * MediaSelector
 * Allows the user to select saved media (videos/books) for an AI tutor session.
 * When media is selected, shows its failed words which can be individually excluded.
 */

import { Component, createSignal, createMemo, For, Show, onMount, onCleanup } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { isWordMarkedFailed } from '@shared/utils/passiveWordTracking';
import { CheckboxCard, EmptyState, HintText, VideoIcon, BookIcon } from '../common';
import type { MediaStats, MediaStatsWordEntry, MediaStatsGrammarEntry, TutorMediaSelection } from '../../../shared/types';
import './MediaSelector.css';

interface MediaSelectorProps {
  selected: TutorMediaSelection[];
  onSelectionChange: (selected: TutorMediaSelection[]) => void;
}

const FAILED_GRAMMAR_EASE_THRESHOLD = 2.5;

export const MediaSelector: Component<MediaSelectorProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();

  const [allMedia, setAllMedia] = createSignal<MediaStats[]>([]);
  const [excludedWords, setExcludedWords] = createSignal<Set<string>>(new Set());

  // Selected media hashes for O(1) lookup
  const selectedHashes = createMemo(() => new Set(props.selected.map(m => m.mediaHash)));

  // Load media stats on mount
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.mediaStats.onMediaStatsList((stats) => {
      // Filter to current language and sort by last accessed
      const filtered = stats
        .filter(s => s.language === settings.language)
        .sort((a, b) => b.lastAccessed - a.lastAccessed);
      setAllMedia(filtered);
    });
    bridge.mediaStats.listMediaStats();
    onCleanup(cleanup);
  });

  // Get failed words for a given media
  const getFailedWords = (media: MediaStats): MediaStatsWordEntry[] => {
    return Object.values(media.wordsEncountered)
      .filter(word => isWordMarkedFailed(word, settings))
      .sort((a, b) => a.ease - b.ease);
  };

  // Get failed grammar for a given media
  const getFailedGrammar = (media: MediaStats): MediaStatsGrammarEntry[] => {
    return Object.values(media.grammarEncountered)
      .filter(g => g.ease < FAILED_GRAMMAR_EASE_THRESHOLD)
      .sort((a, b) => a.ease - b.ease);
  };

  const toggleMedia = (media: MediaStats) => {
    const isSelected = selectedHashes().has(media.mediaHash);
    if (isSelected) {
      props.onSelectionChange(props.selected.filter(m => m.mediaHash !== media.mediaHash));
    } else {
      const failedWords = getFailedWords(media).filter(w => !excludedWords().has(`${media.mediaHash}:${w.word}`));
      const failedGrammar = getFailedGrammar(media);
      props.onSelectionChange([...props.selected, {
        mediaHash: media.mediaHash,
        mediaName: media.mediaName,
        mediaType: media.mediaType,
        failedWords,
        failedGrammar,
      }]);
    }
  };

  const toggleWordExclusion = (mediaHash: string, word: string) => {
    const key = `${mediaHash}:${word}`;
    const newExcluded = new Set(excludedWords());
    if (newExcluded.has(key)) {
      newExcluded.delete(key);
    } else {
      newExcluded.add(key);
    }
    setExcludedWords(newExcluded);

    // Update the selection to reflect excluded words
    const media = allMedia().find(m => m.mediaHash === mediaHash);
    if (media && selectedHashes().has(mediaHash)) {
      const failedWords = getFailedWords(media).filter(w => !newExcluded.has(`${mediaHash}:${w.word}`));
      const failedGrammar = getFailedGrammar(media);
      props.onSelectionChange(props.selected.map(m =>
        m.mediaHash === mediaHash
          ? { ...m, failedWords, failedGrammar }
          : m
      ));
    }
  };

  return (
    <div class="media-selector">
      <HintText>{t('mlearn.AITutorSetup.SelectMediaHint')}</HintText>

      <Show when={props.selected.length > 0}>
        <HintText>{t('mlearn.AITutorSetup.ItemsSelected', { count: String(props.selected.length) })}</HintText>
      </Show>

      <Show when={allMedia().length === 0}>
        <EmptyState
          title={t('mlearn.AITutorSetup.NoMediaYet')}
        />
      </Show>

      <div class="media-selector__list">
        <For each={allMedia()}>
          {(media) => {
            const isSelected = () => selectedHashes().has(media.mediaHash);
            const failedWords = () => getFailedWords(media);

            return (
              <div class="media-selector__media-item">
                <CheckboxCard
                  checked={isSelected()}
                  onChange={() => toggleMedia(media)}
                  title={media.mediaName}
                  description={media.mediaType === 'video'
                    ? `${t('mlearn.Home.Cards.Video.Title')}`
                    : `${t('mlearn.Home.Cards.Reader.Title')}`
                  }
                >
                  <div class="media-selector__card-info">
                    {media.mediaType === 'video' ? <VideoIcon size={14} /> : <BookIcon size={14} />}
                    <span>{`${failedWords().length} ${t('mlearn.AITutorSetup.FailedWords')}`}</span>
                  </div>
                </CheckboxCard>

                {/* Show failed words when media is selected */}
                <Show when={isSelected() && failedWords().length > 0}>
                  <div class="media-selector__failed-section">
                    <div class="media-selector__failed-header">
                      {t('mlearn.AITutorSetup.FailedWords')}
                    </div>
                    <div class="media-selector__failed-list">
                      <For each={failedWords()}>
                        {(word) => {
                          const exclusionKey = () => `${media.mediaHash}:${word.word}`;
                          const isExcluded = () => excludedWords().has(exclusionKey());
                          return (
                            <CheckboxCard
                              checked={!isExcluded()}
                              onChange={() => toggleWordExclusion(media.mediaHash, word.word)}
                              title={word.word}
                              variant="bordered"
                            />
                          );
                        }}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};
