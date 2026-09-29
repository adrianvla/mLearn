import { Component, createMemo, createSignal } from 'solid-js';
import { useLocalization } from '../../context';
import { UnknownWordsSidebar, type SidebarWordEntry } from '../sidebar';
import { AddAllFlashcardsModal } from '../../windows/main/routes/components/AddAllFlashcardsModal';
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
  failedWordSet: () => ReadonlySet<string>;
  onAddWord: (entry: VideoWordEntry) => void | Promise<void>;
  onAddAll: (entries: VideoWordEntry[]) => void | Promise<void>;
  onIgnoreWord: (entry: VideoWordEntry) => void | Promise<void>;
  onClose: () => void;
}

export const VideoUnknownWordsSidebar: Component<VideoUnknownWordsSidebarProps> = (props) => {
  const { t } = useLocalization();
  const [isAddAllOpen, setIsAddAllOpen] = createSignal(false);
  const [addAllEntries, setAddAllEntries] = createSignal<SidebarWordEntry[]>([]);
  const [addAllDictionaryEntries, setAddAllDictionaryEntries] = createSignal<SidebarWordEntry[]>([]);
  const addAllLabels = createMemo(() => addAllFlashcardsLabels(t, 'video'));

  const sortOptions = createMemo(() => [
    { value: 'subtitle', label: t('mlearn.Video.Sidebar.SortBy.SubtitleOrder') },
    { value: 'level', label: t('mlearn.Sidebar.SortBy.Level') },
    { value: 'word', label: t('mlearn.Sidebar.SortBy.Word') },
  ]);

  return (
    <>
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
          // The same control as the reader's, so the same confirm: name the
          // words, let the learner narrow or untick them, then create. The two
          // lists are kept apart because the dictionary filter means
          // "found in a dictionary" and "all of them" are different claims.
          setAddAllEntries(addableEntries);
          setAddAllDictionaryEntries(dictionaryFoundAddable);
          setIsAddAllOpen(true);
        }}
      />
      <AddAllFlashcardsModal
        isOpen={isAddAllOpen()}
        onClose={() => setIsAddAllOpen(false)}
        allEntries={addAllEntries()}
        dictionaryEntries={addAllDictionaryEntries()}
        labels={addAllLabels()}
        onAdd={(entries) => props.onAddAll(entries as VideoWordEntry[])}
      />
    </>
  );
};
