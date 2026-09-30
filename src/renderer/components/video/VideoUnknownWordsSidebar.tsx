import { Component, createMemo } from 'solid-js';
import { useLocalization } from '../../context';
import { AddAllFlashcardsHost, UnknownWordsSidebar, type SidebarWordEntry } from '../sidebar';
import { addAllFlashcardsLabels } from '../../windows/main/routes/components/addAllFlashcardsLabels';
import './VideoUnknownWordsSidebar.css';

export interface VideoWordEntry extends SidebarWordEntry {
  subtitleIndex: number;
  subtitleStart?: number;
  subtitleEnd?: number;
}

interface VideoUnknownWordsSidebarProps {
  words: () => VideoWordEntry[];
  addingWordKeys: () => Set<string>;
  isAddingAll: () => boolean;
  /**
   * Optional: a surface that has no per-word failure record omits this rather
   * than passing an empty set, so the sidebar can hide the category instead of
   * offering a filter that can never contain anything.
   */
  failedWordSet?: () => ReadonlySet<string>;
  onAddWord: (entry: VideoWordEntry) => void | Promise<void>;
  onAddAll: (entries: VideoWordEntry[]) => void | Promise<void>;
  onIgnoreWord: (entry: VideoWordEntry) => void | Promise<void>;
  onClose: () => void;
}

export const VideoUnknownWordsSidebar: Component<VideoUnknownWordsSidebarProps> = (props) => {
  const { t } = useLocalization();
  const addAllLabels = createMemo(() => addAllFlashcardsLabels(t, 'video'));

  const sortOptions = createMemo(() => [
    { value: 'subtitle', label: t('mlearn.Video.Sidebar.SortBy.SubtitleOrder') },
    { value: 'level', label: t('mlearn.Sidebar.SortBy.Level') },
    { value: 'word', label: t('mlearn.Sidebar.SortBy.Word') },
  ]);

  // What differs from the reader is only which words this surface can offer and
  // the wording naming them. Opening the confirmation, carrying the two entry
  // lists, and closing it are the same decision on both, so that lifecycle lives
  // in one place.
  return (
    <AddAllFlashcardsHost
      labels={addAllLabels()}
      onAdd={(entries) => props.onAddAll(entries as VideoWordEntry[])}
    >
      {(addAll) => (
        <UnknownWordsSidebar
          words={props.words}
          addingWordKeys={props.addingWordKeys}
          isAddingAll={props.isAddingAll}
          failedWordSet={props.failedWordSet}
          failedEmptyMessage={t('mlearn.ConversationAgent.Stats.NoHoveredWords')}
          onAddWord={(entry) => props.onAddWord(entry as VideoWordEntry)}
          onIgnoreWord={(entry) => props.onIgnoreWord(entry as VideoWordEntry)}
          sortOptions={sortOptions}
          defaultSort="subtitle"
          emptyMessage={t('mlearn.Video.Sidebar.UnknownWordsEmpty')}
          class="video-unknown-words-sidebar"
          onClose={props.onClose}
          onAddAllClick={(addableEntries, dictionaryFoundAddable) => {
            addAll.open(addableEntries, dictionaryFoundAddable);
          }}
        />
      )}
    </AddAllFlashcardsHost>
  );
};
