/**
 * Word Database Editor Window
 * Allows editing word knowledge status, creating flashcards, and searching words
 * Ported from adjustWordsByLevel in stats.js
 */

import { Component, createSignal, For, Show, onMount, createEffect, createMemo } from 'solid-js';
import { WindowWrapper, useLanguage, useFlashcards, useLocalization } from '../../context';
import {
  getWordsLearnedInApp,
  setWordStatus,
  loadWordsFromStorage,
} from '../../services/statsService';
import { WORD_STATUS } from '../../../shared/constants';
import { SearchBar, EntriesHeader, WordEntryRow, EditTranslationDialog, type WordEntry, type TranslationOverride } from './components';
import { ModalLoadingOverlay, Spinner } from '../../components/common';
import './wordDbEditor.css';

const WordDbEditorContent: Component = () => {
  const { wordFrequency, getFreqLevelNames } = useLanguage();
  const { addFlashcard, hasWordSync, removeFlashcard, getCardByWord } = useFlashcards();
  const { t } = useLocalization();
  // useTranslation imported but translateWord used via EditTranslationDialog
  const [searchQuery, setSearchQuery] = createSignal('');
  const [entries, setEntries] = createSignal<WordEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = createSignal<WordEntry[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [loadProgress, setLoadProgress] = createSignal(0);
  const [selectedLevel, setSelectedLevel] = createSignal<number | null>(null);
  const [sortKey, setSortKey] = createSignal<string>('word');
  const [sortDir, setSortDir] = createSignal<1 | -1>(1);
  const [isInitialized, setIsInitialized] = createSignal(false);
  // Track if we've already loaded words (prevent re-loading on every frequency change)
  const [hasLoadedWords, setHasLoadedWords] = createSignal(false);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = createSignal(false);
  const [editingEntry, setEditingEntry] = createSignal<WordEntry | null>(null);

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
  
  // Auto-load words when wordFrequency data becomes available
  // This handles the case where langData loads asynchronously
  createEffect(() => {
    const freqWords = Object.keys(wordFrequency);
    const totalWords = freqWords.length;
    
    // Only auto-load once when we have data and haven't loaded yet
    if (isInitialized() && totalWords > 0 && !hasLoadedWords() && !isLoading()) {
      console.log(`Word DB Editor: Auto-loading ${totalWords} words from frequency data`);
      loadAllWords();
    }
  });

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
        });

        // Update progress every 100 words
        if (i % 100 === 0) {
          setLoadProgress(Math.floor((i / totalWords) * 100));
        }
      }

      setEntries(wordEntries);
      setFilteredEntries(wordEntries);
      setLoadProgress(100);
    } catch (e) {
      console.error('Failed to load words:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Search words
  const handleSearch = async () => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) {
      setFilteredEntries(entries());
      return;
    }

    const filtered = entries().filter(entry =>
        entry.word.toLowerCase().includes(query) ||
        entry.translation.toLowerCase().includes(query) ||
        entry.reading.toLowerCase().includes(query)
    );

    setFilteredEntries(filtered);
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

  return (
      <div class="word-db-editor">
        {/* Loading indicator while initializing or waiting for word frequency data */}
        <Show when={!isInitialized() || (!hasLoadedWords() && !isLoading())}>
          <div class="init-loading">
            <Spinner size={40} text={t('mlearn.WordDbEditor.Loading')} />
          </div>
        </Show>

        <Show when={isInitialized() && (hasLoadedWords() || isLoading())}>
          {/* Search Bar */}
          <SearchBar
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selectedLevel={selectedLevel}
              setSelectedLevel={setSelectedLevel}
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
            <Show when={!isLoading() && filteredEntries().length === 0 && hasLoadedWords()}>
              <div class="empty-state">
                <p>{t('mlearn.WordDbEditor.EmptyState')}</p>
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
                      onEdit={handleEdit}
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
