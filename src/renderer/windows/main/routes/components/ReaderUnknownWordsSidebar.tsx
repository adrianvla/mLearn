import { Component, createMemo, createSignal } from 'solid-js';
import type { OcrBox } from '../../../../components/reader/OcrOverlay';
import { UnknownWordsSidebar, type SidebarWordEntry } from '../../../../components/sidebar';
import { useLocalization } from '../../../../context';
import { AddAllFlashcardsModal } from './AddAllFlashcardsModal';
import './ReaderUnknownWordsSidebar.css';

export interface ReaderUnknownWordEntry extends SidebarWordEntry {
  pageId: string;
  box: OcrBox;
  boxIndex: number;
}

interface ReaderUnknownWordsSidebarProps {
  words: () => ReaderUnknownWordEntry[];
  addingWordKeys: () => Set<string>;
  isAddingAll: () => boolean;
  failedWordSet: () => ReadonlySet<string>;
  onAddWord: (entry: ReaderUnknownWordEntry) => void | Promise<void>;
  onAddAll: (entries: ReaderUnknownWordEntry[]) => void | Promise<void>;
  onIgnoreWord: (entry: ReaderUnknownWordEntry) => void | Promise<void>;
  onWordHover?: (entry: ReaderUnknownWordEntry) => void;
  onWordLeave?: () => void;
  onClose?: () => void;
}

export const ReaderUnknownWordsSidebar: Component<ReaderUnknownWordsSidebarProps> = (props) => {
  const { t } = useLocalization();
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [modalEntries, setModalEntries] = createSignal<SidebarWordEntry[]>([]);
  const [modalDictEntries, setModalDictEntries] = createSignal<SidebarWordEntry[]>([]);

  const sortOptions = createMemo(() => [
    { value: 'ocr', label: t('mlearn.Reader.Sidebar.SortBy.OCROrder') },
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
        failedEmptyMessage={t('mlearn.ConversationAgent.Stats.NoFailedWords')}
        onAddWord={(entry) => props.onAddWord(entry as ReaderUnknownWordEntry)}
        onIgnoreWord={(entry) => props.onIgnoreWord(entry as ReaderUnknownWordEntry)}
        onWordHover={props.onWordHover ? (entry) => props.onWordHover!(entry as ReaderUnknownWordEntry) : undefined}
        onWordLeave={props.onWordLeave}
        sortOptions={sortOptions}
        defaultSort="ocr"
        emptyMessage={t('mlearn.Reader.Sidebar.UnknownWordsEmpty')}
        class="reader-unknown-words-sidebar"
        onClose={props.onClose}
        onAddAllClick={(addable, dictAddable) => {
          setModalEntries(addable);
          setModalDictEntries(dictAddable);
          setIsModalOpen(true);
        }}
      />
      <AddAllFlashcardsModal
        isOpen={isModalOpen()}
        onClose={() => setIsModalOpen(false)}
        allEntries={modalEntries() as ReaderUnknownWordEntry[]}
        dictionaryEntries={modalDictEntries() as ReaderUnknownWordEntry[]}
        onAdd={(entries) => props.onAddAll(entries)}
      />
    </>
  );
};
