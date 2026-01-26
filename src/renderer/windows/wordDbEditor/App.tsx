/**
 * Word Database Editor Window
 * Allows editing word knowledge status, creating flashcards, and searching words
 * Ported from adjustWordsByLevel in stats.js
 */

import { Component, createSignal, For, Show, onMount } from 'solid-js';
import { WindowWrapper, useLanguage, useFlashcards } from '../../context';
import {
  getWordsLearnedInApp,
  setWordStatus,
  loadWordsFromStorage,
} from '../../services/statsService';
import { WORD_STATUS } from '../../../shared/constants';
import { SearchBar, EntriesHeader, WordEntryRow, EditTranslationDialog, type WordEntry, type TranslationOverride } from './components';
import { Spinner } from '../../components/common';
import './wordDbEditor.css';

const WordDbEditorContent: Component = () => {
  const { wordFrequency, getLevelName } = useLanguage();
  const { addFlashcard, hasWord, removeFlashcard, findFlashcardIndex } = useFlashcards();
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
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = createSignal(false);
  const [editingEntry, setEditingEntry] = createSignal<WordEntry | null>(null);

  // Level names for Japanese - use dynamic level names from langData
  const getLevelNames = (): Record<number, string> => ({
    5: getLevelName(5) || 'N1',
    4: getLevelName(4) || 'N2',
    3: getLevelName(3) || 'N3',
    2: getLevelName(2) || 'N4',
    1: getLevelName(1) || 'N5',
    0: 'Common',
    [-1]: 'Unlisted',
  });

  // Load words from storage on mount and auto-load all words
  onMount(async () => {
    try {
      await loadWordsFromStorage();
      setIsInitialized(true);
      console.log('Word DB Editor: Loaded words from storage');
      
      // Auto-load all words after storage is initialized
      await loadAllWords();
    } catch (e) {
      console.error('Word DB Editor: Failed to load words:', e);
      setIsInitialized(true);
    }
  });

  // Load all words from word frequency data
  const loadAllWords = async () => {
    setIsLoading(true);
    setLoadProgress(0);
    
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
        // Check if word is actually tracked as a flashcard
        const isTracked = hasWord(word);
        
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
      // Create a basic flashcard for this word
      const content = {
        word: entry.word,
        pronunciation: entry.reading || entry.word,
        translation: entry.translation ? [entry.translation] : [],
        definition: entry.fullTranslation ? [entry.fullTranslation] : [],
        example: '-',
        exampleMeaning: '',
        pos: '',
        level: entry.level,
      };
      
      // Add to flashcard store using context
      await addFlashcard(content, 1.3); // Default ease
      
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
      // Find flashcard index by word
      const index = await findFlashcardIndex(entry.word);
      
      if (index >= 0) {
        await removeFlashcard(index, true);
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

  // Dynamic level names from langData
  const levelNames = getLevelNames();
  
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
      {/* Loading indicator while initializing */}
      <Show when={!isInitialized()}>
        <div class="init-loading">
          <Spinner size={40} text="Loading word database..." />
        </div>
      </Show>
      
      <Show when={isInitialized()}>
        {/* Search Bar */}
        <SearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedLevel={selectedLevel}
          setSelectedLevel={setSelectedLevel}
          isLoading={isLoading}
          loadProgress={loadProgress}
          levelNames={levelNames}
          onSearch={handleSearch}
          onLoadAll={loadAllWords}
        />

        {/* Table Header */}
        <EntriesHeader
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />

        {/* Entries List */}
        <div class="entries-list">
          <Show when={!isLoading() && filteredEntries().length === 0}>
            <div class="empty-state">
              <p>No words found. Click "Load All" to load your word database.</p>
            </div>
          </Show>
          
          <For each={filteredEntries()}>
            {(entry) => (
              <WordEntryRow
                entry={entry}
                levelNames={levelNames}
                onStatusChange={handleStatusChange}
                onAddFlashcard={handleAddFlashcard}
                onRemoveFlashcard={handleRemoveFlashcard}
                onEdit={handleEdit}
              />
            )}
          </For>
        </div>

        {/* Loading Overlay */}
        <Show when={isLoading()}>
          <div class="loading-overlay">
            <div class="loading-content">
              <Spinner size={40} text={`Loading... ${loadProgress()}%`} />
            </div>
          </div>
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
      </Show>
    </div>
  );
};

// Main App with providers
export const WordDbEditorApp: Component = () => {
  return (
    <WindowWrapper>
      <WordDbEditorContent />
    </WindowWrapper>
  );
};

export default WordDbEditorApp;
