import { Component, createMemo } from 'solid-js';
import { useLocalization } from '../../context';
import { UnknownWordsSidebar, type SidebarWordEntry } from '../sidebar';
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
  onAddWord: (entry: VideoWordEntry) => void | Promise<void>;
  onAddAll: (entries: VideoWordEntry[]) => void | Promise<void>;
  onIgnoreWord: (entry: VideoWordEntry) => void | Promise<void>;
  onClose: () => void;
}

export const VideoUnknownWordsSidebar: Component<VideoUnknownWordsSidebarProps> = (props) => {
  const { t } = useLocalization();

  const sortOptions = createMemo(() => [
    { value: 'subtitle', label: t('mlearn.Video.Sidebar.SortBy.SubtitleOrder') },
    { value: 'level', label: t('mlearn.Sidebar.SortBy.Level') },
    { value: 'word', label: t('mlearn.Sidebar.SortBy.Word') },
  ]);

  return (
    <UnknownWordsSidebar
      words={props.words}
      addingWordKeys={props.addingWordKeys}
      isAddingAll={props.isAddingAll}
      onAddWord={(entry) => props.onAddWord(entry as VideoWordEntry)}
      onIgnoreWord={(entry) => props.onIgnoreWord(entry as VideoWordEntry)}
      sortOptions={sortOptions}
      defaultSort="subtitle"
      emptyMessage={t('mlearn.Video.Sidebar.UnknownWordsEmpty')}
      class="video-unknown-words-sidebar"
      onAddAllClick={(entries) => props.onAddAll(entries as VideoWordEntry[])}
    />
  );
};
