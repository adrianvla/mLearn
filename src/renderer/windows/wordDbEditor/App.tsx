/**
 * Word Database Editor Window
 * Allows editing word knowledge status, creating flashcards, and searching words
 * Ported from adjustWordsByLevel in stats.js
 */

import { Component, createSignal, For, Show } from 'solid-js';
import { WindowWrapper } from '../../context';
import { GlassButton } from '../../components/common';
import {
  getWordsLearnedInApp,
  setWordStatus,
} from '../../services/statsService';
import { WORD_STATUS } from '../../../shared/constants';
import './wordDbEditor.css';

interface WordEntry {
  uuid: string;
  word: string;
  translation: string;
  reading: string;
  level: number;
  tracker: string;
  status: number;
  fullTranslation?: string;
}

const WordDbEditorContent: Component = () => {
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

  // Load all words
  const loadAllWords = async () => {
    setIsLoading(true);
    setLoadProgress(0);
    
    try {
      const trackedWords = getWordsLearnedInApp();
      const wordEntries: WordEntry[] = [];
      const uuids = Object.keys(trackedWords);
      
      for (let i = 0; i < uuids.length; i++) {
        const uuid = uuids[i];
        const status = trackedWords[uuid];
        
        // In a real implementation, we'd fetch word data from the backend
        // For now, create placeholder entries
        wordEntries.push({
          uuid,
          word: `Word ${i + 1}`, // Would be actual word from lookup
          translation: 'Translation', // Would be fetched
          reading: '',
          level: -1,
          tracker: status === WORD_STATUS.KNOWN ? 'flashcards' : 'nothing',
          status,
        });
        
        setLoadProgress(Math.floor((i / uuids.length) * 100));
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
      <div class="search-bar">
        <input
          type="text"
          class="glass-input search-input"
          placeholder="Search word..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
        />
        <GlassButton onClick={handleSearch}>Search</GlassButton>
        <GlassButton onClick={loadAllWords} disabled={isLoading()}>
          Load All
        </GlassButton>
        
        <Show when={isLoading()}>
          <div class="load-progress">
            <div class="bar" style={{ width: `${loadProgress()}%` }} />
          </div>
        </Show>
        
        <select
          class="glass-select level-select"
          value={selectedLevel() ?? ''}
          onChange={(e) => {
            const val = e.currentTarget.value;
            setSelectedLevel(val ? parseInt(val) : null);
          }}
        >
          <option value="">All Levels</option>
          <For each={Object.entries(levelNames)}>
            {([level, name]) => <option value={level}>{name}</option>}
          </For>
        </select>
        
        <span class="hint">
          Enter to search; exact matches prioritized. Press Load All first.
        </span>
      </div>

      {/* Table Header */}
      <div class="entries-header">
        <div class="col word" onClick={() => handleSort('word')}>
          Word {sortKey() === 'word' && (sortDir() === 1 ? '▲' : '▼')}
        </div>
        <div class="col translation" onClick={() => handleSort('translation')}>
          Translation {sortKey() === 'translation' && (sortDir() === 1 ? '▲' : '▼')}
        </div>
        <div class="col level" onClick={() => handleSort('level')}>
          Level {sortKey() === 'level' && (sortDir() === 1 ? '▲' : '▼')}
        </div>
        <div class="col tracker">Tracked By</div>
        <div class="col status" onClick={() => handleSort('status')}>
          Status {sortKey() === 'status' && (sortDir() === 1 ? '▲' : '▼')}
        </div>
      </div>

      {/* Entries List */}
      <div class="entries-list">
        <Show when={!isLoading() && filteredEntries().length === 0}>
          <div class="empty-state">
            <p>No words found. Click "Load All" to load your word database.</p>
          </div>
        </Show>
        
        <For each={filteredEntries()}>
          {(entry) => (
            <div class="entry">
              <div class="col word">
                <span>{entry.word}</span>
                <Show when={entry.reading}>
                  <span class="reading">{entry.reading}</span>
                </Show>
              </div>
              <div class="col translation" title={entry.fullTranslation}>
                {entry.translation}
              </div>
              <div class="col level">
                <Show when={entry.level >= 0}>
                  <span class="pill" data-level={entry.level}>
                    {levelNames[entry.level] || `Level ${entry.level}`}
                  </span>
                </Show>
                <Show when={entry.level < 0}>-</Show>
              </div>
              <div class="col tracker">
                <span class="tracker-label">{entry.tracker}</span>
                <Show when={entry.tracker === 'flashcards'}>
                  <GlassButton
                    variant="danger"
                    size="sm"
                    onClick={() => handleRemoveFlashcard(entry)}
                  >
                    Remove
                  </GlassButton>
                </Show>
                <Show when={entry.tracker !== 'flashcards'}>
                  <GlassButton
                    variant="primary"
                    size="sm"
                    onClick={() => handleAddFlashcard(entry)}
                  >
                    Add
                  </GlassButton>
                </Show>
              </div>
              <div class="col status">
                <div class="status-pills">
                  <button
                    class={`status-pill ${entry.status === WORD_STATUS.UNKNOWN ? 'active' : ''} status-unknown`}
                    onClick={() => handleStatusChange(entry, WORD_STATUS.UNKNOWN)}
                  >
                    Unknown
                  </button>
                  <button
                    class={`status-pill ${entry.status === WORD_STATUS.LEARNING ? 'active' : ''} status-learning`}
                    onClick={() => handleStatusChange(entry, WORD_STATUS.LEARNING)}
                  >
                    Learning
                  </button>
                  <button
                    class={`status-pill ${entry.status === WORD_STATUS.KNOWN ? 'active' : ''} status-learned`}
                    onClick={() => handleStatusChange(entry, WORD_STATUS.KNOWN)}
                  >
                    Learned
                  </button>
                </div>
              </div>
            </div>
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
