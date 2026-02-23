/**
 * WordSelector
 * Allows the user to search and select words they want to focus on during an AI tutor session.
 * Shows words from wordKnowledge in a color-coded grid (like KanjiGrid), sorted by ease.
 *
 * Word ordering:
 *  1. Failed words from media (ease < 2.5, excluding pure numbers)
 *  2. Tracked words the user has interacted with, sorted by ease ascending
 *
 * Extras:
 *  - Custom word entry (type + Enter to add anything not in the list)
 *  - LLM-powered vocabulary generation for a given topic
 */

import { Component, createSignal, createMemo, For, Show, onMount, onCleanup, batch } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import { useLanguage } from '../../context/LanguageContext';
import { useFlashcards } from '../../context/FlashcardContext';
import { getBridge } from '../../../shared/bridges';
import { streamChat } from '../../services/llmProvider';
import { Input, PillBtn, PillLabel, EmptyState, HintText, Btn, Spinner, SparklesIcon } from '../common';
import type {
  TutorWordSelection,
  PassiveWordKnowledge,
  MediaStats,
  LLMChatMessage,
} from '../../../shared/types';
import './WordSelector.css';

interface WordSelectorProps {
  selected: TutorWordSelection[];
  onSelectionChange: (selected: TutorWordSelection[]) => void;
}

const INITIAL_DISPLAY_COUNT = 200;

/** Returns true if a string is purely numeric (digits only) */
const isNumeric = (s: string): boolean => /^\d+$/.test(s);

/**
 * Get background color for a word cell based on ease value.
 * Lower ease = more red/struggling, higher ease = more green/known.
 */
function getWordCellColor(ease: number, isDark: boolean): string {
  if (ease < 1.5) return isDark ? 'rgba(255, 60, 89, 0.45)' : 'rgba(255, 60, 89, 0.25)';
  if (ease < 2.0) return isDark ? 'rgba(255, 141, 60, 0.45)' : 'rgba(255, 141, 60, 0.25)';
  if (ease < 2.5) return isDark ? 'rgba(255, 200, 60, 0.40)' : 'rgba(255, 200, 60, 0.25)';
  if (ease < 3.0) return isDark ? 'rgba(66, 214, 49, 0.35)' : 'rgba(66, 214, 49, 0.2)';
  return isDark ? 'rgba(66, 214, 49, 0.5)' : 'rgba(66, 214, 49, 0.3)';
}

/** Ease threshold below which a word is considered failed / struggled */
const FAILED_EASE_THRESHOLD = 2.5;

export const WordSelector: Component<WordSelectorProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { getFrequency, getFreqLevelNames } = useLanguage();
  const flashcardCtx = useFlashcards();

  const [searchQuery, setSearchQuery] = createSignal('');
  const [displayCount, setDisplayCount] = createSignal(INITIAL_DISPLAY_COUNT);
  const [levelFilter, setLevelFilter] = createSignal<number | null>(null);

  // Media stats for failed-word extraction
  const [mediaStats, setMediaStats] = createSignal<MediaStats[]>([]);

  // Custom words added by the user (not in wordKnowledge)
  const [customWords, setCustomWords] = createSignal<TutorWordSelection[]>([]);

  // LLM vocabulary generation state
  const [topicInput, setTopicInput] = createSignal('');
  const [isGenerating, setIsGenerating] = createSignal(false);
  const [generationError, setGenerationError] = createSignal('');
  let abortGeneration: (() => void) | null = null;

  const isDark = () => settings.theme === 'dark' || settings.theme === 'glass-dark' || settings.theme === 'darker';

  // Load media stats on mount
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.mediaStats.onMediaStatsList((stats) => {
      const filtered = stats.filter(s => s.language === settings.language);
      setMediaStats(filtered);
    });
    bridge.mediaStats.listMediaStats();
    onCleanup(cleanup);
  });

  // Clean up LLM generation on unmount
  onCleanup(() => {
    if (abortGeneration) abortGeneration();
  });

  // Extract all failed words from media (excluding numbers), deduplicated, sorted by ease
  const mediaFailedWords = createMemo((): PassiveWordKnowledge[] => {
    const wordMap = new Map<string, PassiveWordKnowledge>();

    for (const media of mediaStats()) {
      for (const entry of Object.values(media.wordsEncountered)) {
        if (entry.ease >= FAILED_EASE_THRESHOLD) continue;
        if (isNumeric(entry.word)) continue;
        // Keep the entry with the lowest ease if duplicated across media
        const existing = wordMap.get(entry.word);
        if (!existing || entry.ease < existing.ease) {
          wordMap.set(entry.word, {
            word: entry.word,
            ease: entry.ease,
            timesSeen: entry.timesSeen,
            timesHovered: entry.timesHovered,
            lastSeen: 0,
          });
        }
      }
    }

    return Array.from(wordMap.values()).sort((a, b) => a.ease - b.ease);
  });

  // Tracked words from wordKnowledge for the current language (only interacted words)
  const trackedWords = createMemo((): PassiveWordKnowledge[] => {
    const knowledge = flashcardCtx.store.wordKnowledge;
    const lang = settings.language;
    const items: PassiveWordKnowledge[] = [];

    for (const key of Object.keys(knowledge)) {
      const entry = knowledge[key];
      if (!entry) continue;
      if (entry.language && entry.language !== lang) continue;
      // Only include words the user has actually interacted with
      if (entry.timesSeen <= 0 && entry.timesHovered <= 0) continue;
      items.push(entry);
    }

    // Sort by ease ascending (least known first)
    return items.sort((a, b) => a.ease - b.ease);
  });

  // Combined word list: media-failed first, then remaining tracked words (deduped)
  const allWords = createMemo((): PassiveWordKnowledge[] => {
    const failed = mediaFailedWords();
    const failedSet = new Set(failed.map(w => w.word));
    const tracked = trackedWords().filter(w => !failedSet.has(w.word));

    // Also add custom words that aren't in either list
    const knownSet = new Set([...failedSet, ...tracked.map(w => w.word)]);
    const customs: PassiveWordKnowledge[] = customWords()
      .filter(cw => !knownSet.has(cw.word))
      .map(cw => ({
        word: cw.word,
        reading: cw.reading,
        ease: cw.ease,
        lastSeen: 0,
        timesSeen: 0,
        timesHovered: 0,
      }));

    return [...failed, ...tracked, ...customs];
  });

  // Available frequency levels for filter pills
  const availableLevels = createMemo(() => {
    const levels = new Set<number>();
    for (const w of allWords()) {
      const freq = getFrequency(w.word);
      if (freq) levels.add(freq.raw_level);
    }
    return Array.from(levels).sort((a, b) => a - b);
  });

  // Level names from language data
  const levelNames = createMemo(() => getFreqLevelNames());

  // Selected words set for O(1) lookup
  const selectedWords = createMemo(() => new Set(props.selected.map(s => s.word)));

  // Filter and sort
  const filteredWords = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const level = levelFilter();

    let items = allWords();

    // Filter by frequency level
    if (level !== null) {
      items = items.filter(w => {
        const freq = getFrequency(w.word);
        return freq && freq.raw_level === level;
      });
    }

    // Filter by search
    if (query) {
      items = items.filter(w =>
        w.word.toLowerCase().includes(query) ||
        (w.reading && w.reading.toLowerCase().includes(query))
      );
    }

    // Sort: selected first, then preserve combined order (media-failed → tracked → custom)
    const combined = allWords();
    const orderIndex = new Map<string, number>();
    for (let i = 0; i < combined.length; i++) {
      orderIndex.set(combined[i].word, i);
    }

    return items.sort((a, b) => {
      const aSelected = selectedWords().has(a.word) ? 0 : 1;
      const bSelected = selectedWords().has(b.word) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;

      const aIdx = orderIndex.get(a.word) ?? Infinity;
      const bIdx = orderIndex.get(b.word) ?? Infinity;
      return aIdx - bIdx;
    });
  });

  const displayedWords = createMemo(() => filteredWords().slice(0, displayCount()));

  const toggleWord = (w: PassiveWordKnowledge) => {
    const isSelected = selectedWords().has(w.word);
    if (isSelected) {
      props.onSelectionChange(props.selected.filter(s => s.word !== w.word));
    } else {
      props.onSelectionChange([...props.selected, {
        word: w.word,
        reading: w.reading,
        ease: w.ease,
      }]);
    }
  };

  const handleShowMore = () => {
    setDisplayCount(prev => prev + INITIAL_DISPLAY_COUNT);
  };

  // Custom word entry: when user types a word not in the list and presses Enter
  const handleSearchKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const query = searchQuery().trim();
    if (!query) return;

    // Check if word already exists in allWords
    const exists = allWords().some(w => w.word.toLowerCase() === query.toLowerCase());
    if (exists) {
      // If word exists but not selected, select it
      const match = allWords().find(w => w.word.toLowerCase() === query.toLowerCase());
      if (match && !selectedWords().has(match.word)) {
        toggleWord(match);
      }
      setSearchQuery('');
      return;
    }

    // Add as custom word and auto-select
    const newWord: TutorWordSelection = { word: query, ease: 2.5 };
    batch(() => {
      setCustomWords(prev => [...prev, newWord]);
      props.onSelectionChange([...props.selected, newWord]);
      setSearchQuery('');
    });
  };

  // Check whether the search query could be added as custom
  const canAddCustom = createMemo(() => {
    const query = searchQuery().trim();
    if (!query) return false;
    return !allWords().some(w => w.word.toLowerCase() === query.toLowerCase());
  });

  // LLM vocabulary generation
  const generateVocabulary = () => {
    const topic = topicInput().trim();
    if (!topic || isGenerating()) return;

    if (!settings.llmEnabled || !settings.llmConfigured) {
      setGenerationError(t('mlearn.AITutorSetup.LLMNotConfigured'));
      return;
    }

    setIsGenerating(true);
    setGenerationError('');

    const lang = settings.language;

    const messages: LLMChatMessage[] = [
      {
        role: 'system',
        content: `You are a language learning vocabulary generator. Generate a list of useful vocabulary words for learning ${lang}. Output ONLY a JSON array of objects with "word" (the word in ${lang}) and optionally "reading" (pronunciation/reading if applicable). No markdown, no explanation, just the JSON array. Generate 15-25 diverse, practical words.`,
      },
      {
        role: 'user',
        content: `Generate vocabulary about: ${topic}`,
      },
    ];

    const { abort } = streamChat(
      messages,
      [],
      {
        onChunk: () => {},
        onToolCall: () => {},
        onDone: (finalContent) => {
          setIsGenerating(false);
          abortGeneration = null;

          // Parse the JSON response
          try {
            // Extract JSON array from response (handle potential markdown wrapping)
            const jsonMatch = finalContent.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
              setGenerationError(t('mlearn.AITutorSetup.GenerateError'));
              return;
            }

            const parsed = JSON.parse(jsonMatch[0]) as Array<{ word: string; reading?: string }>;
            if (!Array.isArray(parsed) || parsed.length === 0) {
              setGenerationError(t('mlearn.AITutorSetup.GenerateError'));
              return;
            }

            // Add generated words as custom words and auto-select them
            const existingWords = new Set(allWords().map(w => w.word));
            const existingSelected = new Set(props.selected.map(s => s.word));
            const newCustom: TutorWordSelection[] = [];
            const newSelected: TutorWordSelection[] = [];

            for (const item of parsed) {
              if (!item.word || typeof item.word !== 'string') continue;
              const word = item.word.trim();
              if (!word) continue;

              const entry: TutorWordSelection = {
                word,
                reading: item.reading,
                ease: 2.5,
              };

              if (!existingWords.has(word)) {
                newCustom.push(entry);
              }
              if (!existingSelected.has(word)) {
                newSelected.push(entry);
              }
            }

            batch(() => {
              if (newCustom.length > 0) {
                setCustomWords(prev => [...prev, ...newCustom]);
              }
              if (newSelected.length > 0) {
                props.onSelectionChange([...props.selected, ...newSelected]);
              }
              setTopicInput('');
            });
          } catch {
            setGenerationError(t('mlearn.AITutorSetup.GenerateError'));
          }
        },
        onError: (error) => {
          setIsGenerating(false);
          abortGeneration = null;
          setGenerationError(error);
        },
      },
      settings,
    );

    abortGeneration = abort;
  };

  return (
    <div class="word-selector">
      <HintText>{t('mlearn.AITutorSetup.SelectWordsHint')}</HintText>

      <div class="word-selector__search-row">
        <Input
          value={searchQuery()}
          onInput={(e) => {
            setSearchQuery(e.currentTarget.value);
            setDisplayCount(INITIAL_DISPLAY_COUNT);
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('mlearn.AITutorSetup.SearchWords')}
        />
        <Show when={canAddCustom()}>
          <span class="word-selector__add-hint">{t('mlearn.AITutorSetup.PressEnterToAdd')}</span>
        </Show>
      </div>

      {/* LLM vocabulary generation */}
      <Show when={settings.llmEnabled && settings.llmConfigured}>
        <div class="word-selector__generate-section">
          <div class="word-selector__generate-row">
            <Input
              value={topicInput()}
              onInput={(e) => setTopicInput(e.currentTarget.value)}
              onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') generateVocabulary(); }}
              placeholder={t('mlearn.AITutorSetup.GenerateTopicPlaceholder')}
              disabled={isGenerating()}
            />
            <Btn
              variant="ghost"
              size="sm"
              onClick={generateVocabulary}
              disabled={isGenerating() || !topicInput().trim()}
            >
              <Show when={isGenerating()} fallback={<><SparklesIcon size={14} /> {t('mlearn.AITutorSetup.GenerateBtn')}</>}>
                <Spinner size={14} />
              </Show>
            </Btn>
          </div>
          <Show when={generationError()}>
            <span class="word-selector__generate-error">{generationError()}</span>
          </Show>
        </div>
      </Show>

      <Show when={availableLevels().length > 1}>
        <div class="word-selector__level-pills">
          <PillLabel
            variant="gray"
            clickable
            active={levelFilter() === null}
            onClick={() => {
              setLevelFilter(null);
              setDisplayCount(INITIAL_DISPLAY_COUNT);
            }}
          >
            {t('mlearn.AITutorSetup.AllLevels')}
          </PillLabel>
          <For each={availableLevels()}>
            {(level) => (
              <PillLabel
                level={level}
                clickable
                active={levelFilter() === level}
                onClick={() => {
                  setLevelFilter(level);
                  setDisplayCount(INITIAL_DISPLAY_COUNT);
                }}
              >
                {levelNames()[String(level)] || String(level)}
              </PillLabel>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.selected.length > 0}>
        <HintText>{t('mlearn.AITutorSetup.ItemsSelected', { count: String(props.selected.length) })}</HintText>
      </Show>

      <Show when={allWords().length === 0}>
        <EmptyState
          title={t('mlearn.AITutorSetup.NoWordsYet')}
        />
      </Show>

      <div class="word-selector__grid">
        <For each={displayedWords()}>
          {(w) => (
            <div
              class={`word-selector__cell ${selectedWords().has(w.word) ? 'selected' : ''}`}
              style={{ background: getWordCellColor(w.ease, isDark()) }}
              onClick={() => toggleWord(w)}
              title={w.reading ? `${w.word} (${w.reading})` : w.word}
              role="button"
              tabIndex={0}
            >
              <span class="word-selector__cell-text">{w.word}</span>
            </div>
          )}
        </For>
      </div>

      <Show when={displayCount() < filteredWords().length}>
        <PillBtn onClick={handleShowMore}>
          {t('mlearn.AITutorSetup.ShowMore')}
        </PillBtn>
      </Show>
    </div>
  );
};
