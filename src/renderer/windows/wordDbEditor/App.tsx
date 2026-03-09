/**
 * Word Database Editor Window
 * Allows editing word knowledge status, creating flashcards, and searching words
 * Ported from adjustWordsByLevel in stats.js
 */

import { Component, createSignal, For, Show, onMount, createEffect, createMemo, on } from 'solid-js';
import { WindowWrapper, useLanguage, useFlashcards, useLocalization, useSettings } from '../../context';
import {
  getWordsLearnedInApp,
  setWordStatus,
  loadWordsFromStorage,
} from '../../services/statsService';
import { WORD_STATUS } from '../../../shared/constants';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import { SearchBar, EntriesHeader, WordEntryRow, EditTranslationDialog, AnkiCardPreviewModal, type WordEntry, type TranslationOverride, type AnkiExportState, type WordDbBrowseMode } from './components';
import { Modal, ModalLoadingOverlay, Spinner } from '../../components/common';
import { FlashcardEditor } from '../../components/flashcard';
import { useAnki } from '../../hooks/useAnki';
import './WordDbEditorLayout.css';

export const WordDbEditorContent: Component = () => {
  const { wordFrequency, getFreqLevelNames } = useLanguage();
  const { addFlashcard, hasWordSync, removeFlashcard, getCardByWord, getCardByWordSync, updateFlashcardContent, isLoading: flashcardsLoading, getIgnoredWordsSync, unignoreWordForLanguage } = useFlashcards();
  const { t } = useLocalization();
  const { settings } = useSettings();
  const anki = useAnki();
  const [searchQuery, setSearchQuery] = createSignal('');
  const [entries, setEntries] = createSignal<WordEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = createSignal<WordEntry[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [loadProgress, setLoadProgress] = createSignal(0);
  const [selectedLevel, setSelectedLevel] = createSignal<number | null>(null);
  const [browseMode, setBrowseMode] = createSignal<WordDbBrowseMode>('all');
  const [sortKey, setSortKey] = createSignal<string>('word');
  const [sortDir, setSortDir] = createSignal<1 | -1>(1);
  const [isInitialized, setIsInitialized] = createSignal(false);
  // Track if we've already loaded words (prevent re-loading on every frequency change)
  const [hasLoadedWords, setHasLoadedWords] = createSignal(false);

  const [editDialogOpen, setEditDialogOpen] = createSignal(false);
  const [editingEntry, setEditingEntry] = createSignal<WordEntry | null>(null);

  const [ankiExportStates, setAnkiExportStates] = createSignal<Record<string, AnkiExportState>>({});

  // Anki card preview state
  const [ankiPreviewOpen, setAnkiPreviewOpen] = createSignal(false);
  const [ankiPreviewEntry, setAnkiPreviewEntry] = createSignal<WordEntry | null>(null);

  // Flashcard edit modal state
  const [editFlashcardOpen, setEditFlashcardOpen] = createSignal(false);
  const [editingFlashcard, setEditingFlashcard] = createSignal<Flashcard | null>(null);

  // Level names - use dynamic level names from langData (e.g., JLPT N1-N5, HSK 1-6, etc.)
  const getLevelNames = (): Record<number, string> => {
    const langLevelNames = getFreqLevelNames();
    const result: Record<number, string> = {};
    
    // Add language-specific level names
    for (const [key, value] of Object.entries(langLevelNames)) {
      result[Number(key)] = value;
    }
    
    // Add special levels with localized names
    result[0] = t('mlearn.WordDbEditor.LevelNames.Common');
    result[-1] = t('mlearn.WordDbEditor.LevelNames.Unlisted');
    
    return result;
  };

  // Load words from storage on mount
  onMount(async () => {
    try {
      await loadWordsFromStorage();
      setIsInitialized(true);
      console.log('Word DB Editor: Loaded words from storage');
    } catch (e) {
      console.error('Word DB Editor: Failed to load words:', e);
      setIsInitialized(true);
    }
  });
  
  // Auto-load words when wordFrequency data becomes available AND flashcards are loaded
  // This handles the case where langData and flashcards load asynchronously
  createEffect(() => {
    const freqWords = Object.keys(wordFrequency);
    const totalWords = freqWords.length;
    const fcLoading = flashcardsLoading();
    
    // Only auto-load once when we have data, flashcards are ready, and haven't loaded yet
    if (isInitialized() && totalWords > 0 && !fcLoading && !hasLoadedWords() && !isLoading()) {
      console.log(`Word DB Editor: Auto-loading ${totalWords} words from frequency data`);
      loadAllWords();
    }
  });

  const buildFilteredEntries = (sourceEntries: WordEntry[]): WordEntry[] => {
    const query = searchQuery().toLowerCase().trim();
    const level = selectedLevel();

    return sourceEntries.filter((entry) => {
      if (level !== null && entry.level !== level) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        entry.word.toLowerCase().includes(query) ||
        entry.translation.toLowerCase().includes(query) ||
        entry.reading.toLowerCase().includes(query) ||
        entry.alternateReadings?.some((reading) => reading.toLowerCase().includes(query))
      );
    });
  };

  const ignoredEntries = createMemo<WordEntry[]>(() => {
    return getIgnoredWordsSync()
      .map((ignored) => {
        const freqEntry = wordFrequency[ignored.word];
        return {
          uuid: `ignored:${ignored.word}`,
          word: ignored.word,
          translation: '',
          reading: ignored.reading || freqEntry?.reading || '',
          level: freqEntry?.raw_level ?? -1,
          tracker: 'ignored',
          status: getWordsLearnedInApp()[ignored.word] ?? WORD_STATUS.UNKNOWN,
          alternateReadings: freqEntry?.alternateReadings,
          ignoredAt: ignored.ignoredAt,
        };
      })
      .sort((a, b) => (b.ignoredAt ?? 0) - (a.ignoredAt ?? 0) || a.word.localeCompare(b.word));
  });

  createEffect(on([entries, ignoredEntries, selectedLevel, browseMode, hasLoadedWords], () => {
    if (browseMode() === 'all' && !hasLoadedWords()) {
      return;
    }
    const sourceEntries = browseMode() === 'ignored' ? ignoredEntries() : entries();
    setFilteredEntries(buildFilteredEntries(sourceEntries));
  }, { defer: true }));

  // Load all words from word frequency data
  const loadAllWords = async () => {
    setIsLoading(true);
    setLoadProgress(0);
    setHasLoadedWords(true);

    try {
      // Ensure storage is loaded first
      await loadWordsFromStorage();

      // Get tracked words (word -> status)
      const trackedWords = getWordsLearnedInApp();
      const wordEntries: WordEntry[] = [];

      // Get words from word frequency data (from langData)
      const freqWords = Object.entries(wordFrequency);
      const totalWords = freqWords.length;

      if (totalWords === 0) {
        console.warn('No word frequency data available');
        setEntries([]);
        setFilteredEntries([]);
        return;
      }

      for (let i = 0; i < totalWords; i++) {
        const [word, freqEntry] = freqWords[i];
        const uuid = word; // Use word as UUID for consistency
        const status = trackedWords[word] ?? WORD_STATUS.UNKNOWN;
        // Check if word is actually tracked as a flashcard (sync for better performance)
        const isTracked = hasWordSync(word);

        wordEntries.push({
          uuid,
          word,
          translation: '', // Would need API call to get translation
          reading: freqEntry.reading || '',
          level: freqEntry.raw_level ?? -1,
          tracker: isTracked ? 'flashcards' : 'nothing',
          status,
          alternateReadings: freqEntry.alternateReadings,
        });

        // Update progress every 100 words
        if (i % 100 === 0) {
          setLoadProgress(Math.floor((i / totalWords) * 100));
        }
      }

      setEntries(wordEntries);
      setFilteredEntries(buildFilteredEntries(wordEntries));
      setLoadProgress(100);
    } catch (e) {
      console.error('Failed to load words:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const [isSearching, setIsSearching] = createSignal(false);

  // Search words — show a loader while filtering large datasets
  const handleSearch = () => {
    const sourceEntries = browseMode() === 'ignored' ? ignoredEntries() : entries();

    setIsSearching(true);
    // Yield to the event loop so the loader overlay paints before the sync work
    requestAnimationFrame(() => {
      setFilteredEntries(buildFilteredEntries(sourceEntries));
      setIsSearching(false);
    });
  };

  // Sort entries
  const handleSort = (key: string) => {
    if (sortKey() === key) {
      setSortDir(prev => prev === 1 ? -1 : 1);
    } else {
      setSortKey(key);
      setSortDir(1);
    }

    const sorted = [...filteredEntries()].sort((a, b) => {
      let comparison = 0;
      switch (key) {
        case 'word':
          comparison = a.word.localeCompare(b.word);
          break;
        case 'translation':
          comparison = a.translation.localeCompare(b.translation);
          break;
        case 'level':
          comparison = (a.level ?? -1) - (b.level ?? -1);
          break;
        case 'status':
          comparison = a.status - b.status;
          break;
      }
      return comparison * sortDir();
    });

    setFilteredEntries(sorted);
  };

  // Change word status
  const handleStatusChange = async (entry: WordEntry, newStatus: number) => {
    try {
      // Update status in storage using word (not uuid)
      setWordStatus(entry.word, newStatus);
      // saveWordsToStorage is called automatically by setWordStatus

      // Update local state
      setEntries(prev => prev.map(e =>
          e.uuid === entry.uuid ? { ...e, status: newStatus } : e
      ));
      setFilteredEntries(prev => prev.map(e =>
          e.uuid === entry.uuid ? { ...e, status: newStatus } : e
      ));
      console.log(`%cUpdated status for word "${entry.word}" to ${newStatus}`, 'color: lime;');
    } catch (e) {
      console.error('Failed to update word status:', e);
    }
  };

  // Add flashcard for word
  const handleAddFlashcard = async (entry: WordEntry) => {
    try {
      // Create a flashcard for this word using new format
      const content = {
        type: 'word' as const,
        front: entry.word,
        back: entry.translation || entry.fullTranslation || entry.word,
        reading: entry.reading || undefined,
        pos: '',
        level: entry.level,
      };

      // Add to flashcard store using context
      await addFlashcard(content);

      // Update local state
      setEntries(prev => prev.map(e =>
          e.uuid === entry.uuid ? { ...e, tracker: 'flashcards' } : e
      ));
      setFilteredEntries(prev => prev.map(e =>
          e.uuid === entry.uuid ? { ...e, tracker: 'flashcards' } : e
      ));
      console.log(`%cAdded flashcard for word "${entry.word}"`, 'color: cyan;');
    } catch (e) {
      console.error('Failed to add flashcard:', e);
    }
  };

  // Remove flashcard for word
  const handleRemoveFlashcard = async (entry: WordEntry) => {
    try {
      // Find flashcard by word (async now)
      const card = await getCardByWord(entry.word);

      if (card) {
        await removeFlashcard(card.id, true);
      }

      // Update local state
      setEntries(prev => prev.map(e =>
          e.uuid === entry.uuid ? { ...e, tracker: 'nothing' } : e
      ));
      setFilteredEntries(prev => prev.map(e =>
          e.uuid === entry.uuid ? { ...e, tracker: 'nothing' } : e
      ));
      console.log(`%cRemoved flashcard for word "${entry.word}"`, 'color: orange;');
    } catch (e) {
      console.error('Failed to remove flashcard:', e);
    }
  };

  const handleUnignore = async (entry: WordEntry) => {
    try {
      await unignoreWordForLanguage(entry.word);
    } catch (e) {
      console.error('Failed to unignore word:', e);
    }
  };

  // Reactive level names from langData - uses createMemo for reactivity
  // This ensures the level names update when langData loads asynchronously
  const levelNames = createMemo(() => getLevelNames());

  // Edit entry handler
  const handleEdit = (entry: WordEntry) => {
    setEditingEntry(entry);
    setEditDialogOpen(true);
  };

  // Handle save from edit dialog
  const handleEditSave = async (data: TranslationOverride) => {
    const entry = editingEntry();
    if (!entry) return;

    // Update local state with new data
    const updatedEntry: WordEntry = {
      ...entry,
      reading: data.reading || entry.reading,
      pitch: data.pitch,
      translation: data.definitions.slice(0, 3).join(', '),
      fullTranslation: data.definitions.join('\n'),
    };

    setEntries(prev => prev.map(e =>
        e.uuid === entry.uuid ? updatedEntry : e
    ));
    setFilteredEntries(prev => prev.map(e =>
        e.uuid === entry.uuid ? updatedEntry : e
    ));

    setEditDialogOpen(false);
    setEditingEntry(null);
    console.log(`%cUpdated translation data for word "${entry.word}"`, 'color: lime;');
  };

  const handleAnkiPreview = (entry: WordEntry) => {
    setAnkiPreviewEntry(entry);
    setAnkiPreviewOpen(true);
  };

  // Open flashcard editor for a tracked word
  const handleEditFlashcard = (entry: WordEntry) => {
    const card = getCardByWordSync(entry.word);
    if (!card) return;
    setEditingFlashcard(card);
    setEditFlashcardOpen(true);
  };

  const handleEditFlashcardSave = (content: FlashcardContent) => {
    const card = editingFlashcard();
    if (!card) return;
    updateFlashcardContent(card.id, content);
    setEditFlashcardOpen(false);
    setEditingFlashcard(null);
  };

  const handleEditFlashcardCancel = () => {
    setEditFlashcardOpen(false);
    setEditingFlashcard(null);
  };

  const handleExportToAnki = async (entry: WordEntry) => {
    const uuid = entry.uuid;
    setAnkiExportStates(prev => ({ ...prev, [uuid]: 'exporting' }));

    try {
      const isConnected = await anki.checkConnection();
      if (!isConnected) {
        setAnkiExportStates(prev => ({ ...prev, [uuid]: 'error' }));
        console.warn('Anki is not connected');
        return;
      }

      const isDuplicate = await anki.checkDuplicate(entry.word);
      if (isDuplicate) {
        setAnkiExportStates(prev => ({ ...prev, [uuid]: 'duplicate' }));
        return;
      }

      const meaning = entry.translation || entry.fullTranslation || entry.word;
      const noteId = await anki.addNote({
        word: entry.word,
        reading: entry.reading || undefined,
        meaning,
      });

      if (noteId) {
        setAnkiExportStates(prev => ({ ...prev, [uuid]: 'exported' }));
        console.log(`%cExported "${entry.word}" to Anki (noteId: ${noteId})`, 'color: cyan;');
      } else {
        setAnkiExportStates(prev => ({ ...prev, [uuid]: 'error' }));
      }
    } catch (e) {
      console.error('Failed to export to Anki:', e);
      setAnkiExportStates(prev => ({ ...prev, [uuid]: 'error' }));
    }
  };

  const ankiEnabled = createMemo(() => settings.use_anki);

  return (
      <div class="word-db-editor">
        {/* Loading indicator while initializing or waiting for word frequency data */}
        <Show when={!isInitialized() || (browseMode() === 'all' && !hasLoadedWords() && !isLoading())}>
          <div class="init-loading">
            <Spinner size={44} shape="square" strokeWidth={8} cornerRadius={0} text={t('mlearn.WordDbEditor.Loading')}/>
            {/*<Spinner size={40} shape="square" text={t('mlearn.WordDbEditor.Loading')} />*/}
          </div>
        </Show>

        <Show when={isInitialized() && (browseMode() === 'ignored' || hasLoadedWords() || isLoading())}>
          {/* Search Bar */}
          <SearchBar
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selectedLevel={selectedLevel}
              setSelectedLevel={setSelectedLevel}
              browseMode={browseMode}
              setBrowseMode={setBrowseMode}
              isLoading={isLoading}
              loadProgress={loadProgress}
              levelNames={levelNames()}
              onSearch={handleSearch}
          />

          {/* Table Header */}
          <EntriesHeader
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
          />

          {/* Entries List */}
          <div class="entries-list">
            <Show when={!isLoading() && filteredEntries().length === 0 && (browseMode() === 'ignored' || hasLoadedWords())}>
              <div class="empty-state">
                <p>{browseMode() === 'ignored' ? t('mlearn.WordDbEditor.EmptyIgnoredState') : t('mlearn.WordDbEditor.EmptyState')}</p>
              </div>
            </Show>

            <For each={filteredEntries()}>
              {(entry) => (
                  <WordEntryRow
                      entry={entry}
                      levelNames={levelNames()}
                      onStatusChange={handleStatusChange}
                      onAddFlashcard={handleAddFlashcard}
                      onRemoveFlashcard={handleRemoveFlashcard}
                      onUnignore={handleUnignore}
                      onEditFlashcard={handleEditFlashcard}
                      onEdit={handleEdit}
                      onExportToAnki={ankiEnabled() ? handleExportToAnki : undefined}
                      onAnkiPreview={ankiEnabled() ? handleAnkiPreview : undefined}
                      ankiExportState={ankiExportStates()[entry.uuid] || 'idle'}
                  />
              )}
            </For>
          </div>

          {/* Loading Overlay */}
          <ModalLoadingOverlay
            isOpen={isLoading()}
            message={`${t('mlearn.WordDbEditor.LoadingMore')} ${loadProgress()}%`}
            progress={loadProgress()}
            showProgress={true}
            showPercent={false}
          />

          {/* Search Overlay */}
          <ModalLoadingOverlay
            isOpen={isSearching()}
            message={t('mlearn.WordDbEditor.Searching')}
          />

          {/* Anki Card Preview Modal */}
          <Show when={ankiPreviewOpen() && ankiPreviewEntry()}>
            <AnkiCardPreviewModal
                word={ankiPreviewEntry()!.word}
                isOpen={ankiPreviewOpen()}
                onClose={() => {
                  setAnkiPreviewOpen(false);
                  setAnkiPreviewEntry(null);
                }}
                onExport={() => {
                  const entry = ankiPreviewEntry();
                  if (entry) handleExportToAnki(entry);
                  setAnkiPreviewOpen(false);
                  setAnkiPreviewEntry(null);
                }}
            />
          </Show>

          {/* Edit Translation Dialog */}
          <Show when={editDialogOpen() && editingEntry()}>
            <EditTranslationDialog
                word={editingEntry()!.word}
                isOpen={editDialogOpen()}
                onClose={() => {
                  setEditDialogOpen(false);
                  setEditingEntry(null);
                }}
                onSave={handleEditSave}
                initialData={editingEntry()?.pitch !== undefined ? {
                  reading: editingEntry()!.reading || '',
                  pitch: editingEntry()!.pitch ?? null,
                  definitions: editingEntry()!.fullTranslation?.split('\n') || [],
                } : null}
            />
          </Show>

          {/* Edit Flashcard Modal */}
          <Modal
            isOpen={editFlashcardOpen()}
            onClose={handleEditFlashcardCancel}
            title={`${t('mlearn.Flashcards.Modals.EditCard.Title')} – ${editingFlashcard()?.content.front || ''}`}
            size="lg"
          >
            <Show when={editingFlashcard()}>
              <FlashcardEditor
                flashcard={editingFlashcard()!}
                onSave={handleEditFlashcardSave}
                onCancel={handleEditFlashcardCancel}
                showStats={true}
              />
            </Show>
          </Modal>
        </Show>
      </div>
  );
};

// Main App with providers
export const WordDbEditorApp: Component = () => {
  return (
      <WindowWrapper showDragRegion={false}>
        <WordDbEditorContent />
      </WindowWrapper>
  );
};

export default WordDbEditorApp;
