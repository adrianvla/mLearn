/**
 * Word Database Editor Window
 * Allows editing word knowledge status, creating flashcards, and searching words
 * Ported from adjustWordsByLevel in stats.js
 */

import { Component, createSignal, For, Show } from 'solid-js';
import { WindowWrapper, useLanguage } from '../../context';
import {
  getWordsLearnedInApp,
  setWordStatus,
} from '../../services/statsService';
import { WORD_STATUS } from '../../../shared/constants';
import { SearchBar, EntriesHeader, WordEntryRow, type WordEntry } from './components';
import './wordDbEditor.css';

const WordDbEditorContent: Component = () => {
  const { wordFrequency } = useLanguage();
  const [searchQuery, setSearchQuery] = createSignal('');
  const [entries, setEntries] = createSignal<WordEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = createSignal<WordEntry[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [loadProgress, setLoadProgress] = createSignal(0);
  const [selectedLevel, setSelectedLevel] = createSignal<number | null>(null);
  const [sortKey, setSortKey] = createSignal<string>('word');
  const [sortDir, setSortDir] = createSignal<1 | -1>(1);

  // Level names for Japanese (would come from langData)
  const levelNames: Record<number, string> = {
    5: 'N1',
    4: 'N2',
    3: 'N3',
    2: 'N4',
    1: 'N5',
    0: 'Common',
    [-1]: 'Unlisted',
  };

  // Load all words from word frequency data
  const loadAllWords = async () => {
    setIsLoading(true);
    setLoadProgress(0);
    
    try {
      // Get tracked words (uuid -> status)
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
        const uuid = word; // Use word as UUID
        const status = trackedWords[uuid] ?? WORD_STATUS.UNKNOWN;
        
        wordEntries.push({
          uuid,
          word,
          translation: '', // Would need API call to get translation
          reading: freqEntry.reading || '',
          level: freqEntry.raw_level ?? -1,
          tracker: status === WORD_STATUS.KNOWN ? 'flashcards' : 'nothing',
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
    setWordStatus(entry.uuid, newStatus);
    setEntries(prev => prev.map(e =>
      e.uuid === entry.uuid ? { ...e, status: newStatus } : e
    ));
    setFilteredEntries(prev => prev.map(e =>
      e.uuid === entry.uuid ? { ...e, status: newStatus } : e
    ));
  };

  // Add flashcard for word
  const handleAddFlashcard = async (entry: WordEntry) => {
    try {
      // In real implementation, would call flashcard creation API
      setEntries(prev => prev.map(e =>
        e.uuid === entry.uuid ? { ...e, tracker: 'flashcards' } : e
      ));
      setFilteredEntries(prev => prev.map(e =>
        e.uuid === entry.uuid ? { ...e, tracker: 'flashcards' } : e
      ));
    } catch (e) {
      console.error('Failed to add flashcard:', e);
    }
  };

  // Remove flashcard for word
  const handleRemoveFlashcard = async (entry: WordEntry) => {
    try {
      setEntries(prev => prev.map(e =>
        e.uuid === entry.uuid ? { ...e, tracker: 'nothing' } : e
      ));
      setFilteredEntries(prev => prev.map(e =>
        e.uuid === entry.uuid ? { ...e, tracker: 'nothing' } : e
      ));
    } catch (e) {
      console.error('Failed to remove flashcard:', e);
    }
  };

  return (
    <div class="word-db-editor">
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
            />
          )}
        </For>
      </div>

      {/* Loading Overlay */}
      <Show when={isLoading()}>
        <div class="loading-overlay">
          <div class="loading-content">
            <div class="spinner" />
            <p>Loading... {loadProgress()}%</p>
          </div>
        </div>
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
