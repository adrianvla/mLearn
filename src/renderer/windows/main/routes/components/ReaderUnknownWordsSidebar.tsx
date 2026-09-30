import { Component, createMemo } from 'solid-js';
import type { OcrBox } from '../../../../components/reader/OcrOverlay';
import { AddAllFlashcardsHost, UnknownWordsSidebar, type SidebarWordEntry } from '../../../../components/sidebar';
import { useLocalization } from '../../../../context';
import { addAllFlashcardsLabels } from './addAllFlashcardsLabels';
import './ReaderUnknownWordsSidebar.css';

export interface ReaderUnknownWordEntry extends SidebarWordEntry {
  pageId: string;
  box?: OcrBox;
  boxIndex: number;
}

interface ReaderUnknownWordsSidebarProps {
  words: () => ReaderUnknownWordEntry[];
  isProcessing?: () => boolean;
  blockedMessage?: () => string | null;
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
  const addAllLabels = createMemo(() => addAllFlashcardsLabels(t, 'reader'));

  const sortOptions = createMemo(() => [
    { value: 'ocr', label: t('mlearn.Reader.Sidebar.SortBy.OCROrder') },
    { value: 'level', label: t('mlearn.Sidebar.SortBy.Level') },
    { value: 'word', label: t('mlearn.Sidebar.SortBy.Word') },
  ]);

  // The reader offers words found by OCR and names them in its own wording.
  // Everything about opening the confirmation and carrying its two entry lists
  // is shared with the video sidebar, and is owned once.
  return (
    <AddAllFlashcardsHost
      labels={addAllLabels()}
      onAdd={(entries) => props.onAddAll(entries as ReaderUnknownWordEntry[])}
    >
      {(addAll) => (
        <UnknownWordsSidebar
          words={props.words}
          addingWordKeys={props.addingWordKeys}
          isAddingAll={props.isAddingAll}
          failedWordSet={props.failedWordSet}
          failedEmptyMessage={t('mlearn.ConversationAgent.Stats.NoHoveredWords')}
          onAddWord={(entry) => props.onAddWord(entry as ReaderUnknownWordEntry)}
          onIgnoreWord={(entry) => props.onIgnoreWord(entry as ReaderUnknownWordEntry)}
          onWordHover={props.onWordHover ? (entry) => props.onWordHover!(entry as ReaderUnknownWordEntry) : undefined}
          onWordLeave={props.onWordLeave}
          sortOptions={sortOptions}
          defaultSort="ocr"
          emptyMessage={props.blockedMessage?.()
            ?? (props.isProcessing?.()
              ? t('mlearn.Reader.Status.Recognizing')
              : t('mlearn.Reader.Sidebar.UnknownWordsEmpty'))}
          hideEmptyCount={Boolean(props.blockedMessage?.() || props.isProcessing?.())}
          class="reader-unknown-words-sidebar"
          onClose={props.onClose}
          onAddAllClick={(addable, dictAddable) => {
            addAll.open(addable, dictAddable);
          }}
        />
      )}
    </AddAllFlashcardsHost>
  );
};
