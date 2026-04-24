/**
 * WordSelector
 * Allows the user to search and select words they want to focus on during an AI tutor session.
 * Shows words from wordKnowledge in a color-coded grid (like KanjiGrid), sorted by ease.
 *
 * Word ordering:
 *  1. Failed words from media (based on counted hover failures, excluding pure numbers)
 *  2. Tracked words the user has interacted with, sorted by ease ascending
 *
 * Extras:
 *  - Custom word entry (type + Enter to add anything not in the list)
 *  - LLM-powered vocabulary generation for a given topic
 */

import { Component, createSignal, createMemo, For, Show, onMount, onCleanup, batch } from 'solid-js';
import { useLocalization, useSettings, useLowPowerGate } from '../../context';
import { useLanguage } from '../../context/LanguageContext';
import { useFlashcards } from '../../context/FlashcardContext';
import { getBridge } from '../../../shared/bridges';
import { streamChat } from '../../services/llmProvider';
import { isWordInLanguageScript } from '../../../shared/utils/textUtils';
import { getWordsLearnedInApp } from '../../services/statsService';
import { WORD_STATUS } from '../../../shared/constants';
import { Input, LevelPillsFilter, EmptyState, HintText, Btn, SparklesIcon, CollapsibleStickyHeader } from '../common';
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
  customWords: TutorWordSelection[];
  onCustomWordsChange: (words: TutorWordSelection[]) => void;
}

/**
 * Get background color for a word cell based on ease value.
 * Lower ease = more red/struggling, higher ease = more green/known.
 */
function getWordCellColor(ease: number, isDark: boolean): string {
  // Unassessed words (generated/custom) get a neutral color
  if (ease < 0) return isDark ? 'rgba(160, 160, 160, 0.25)' : 'rgba(160, 160, 160, 0.18)';
  if (ease < 1.5) return isDark ? 'rgba(255, 60, 89, 0.45)' : 'rgba(255, 60, 89, 0.25)';
  if (ease < 2.0) return isDark ? 'rgba(255, 141, 60, 0.45)' : 'rgba(255, 141, 60, 0.25)';
  if (ease < 2.5) return isDark ? 'rgba(255, 200, 60, 0.40)' : 'rgba(255, 200, 60, 0.25)';
  if (ease < 3.0) return isDark ? 'rgba(66, 214, 49, 0.35)' : 'rgba(66, 214, 49, 0.2)';
  return isDark ? 'rgba(66, 214, 49, 0.5)' : 'rgba(66, 214, 49, 0.3)';
}

export const WordSelector: Component<WordSelectorProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { getFrequency, getFreqLevelNames } = useLanguage();
  const flashcardCtx = useFlashcards();
  const { requestAccess } = useLowPowerGate();

  const [searchQuery, setSearchQuery] = createSignal('');
  const [levelFilter, setLevelFilter] = createSignal<number | null>(null);

  // Media stats for failed-word extraction
  const [mediaStats, setMediaStats] = createSignal<MediaStats[]>([]);

  // Custom words are managed by the parent to survive tab switches
  const customWords = () => props.customWords ?? [];
  const setCustomWords = (updater: TutorWordSelection[] | ((prev: TutorWordSelection[]) => TutorWordSelection[])) => {
    const prev = props.customWords ?? [];
    const next = typeof updater === 'function' ? updater(prev) : updater;
    props.onCustomWordsChange(next);
  };

  // LLM vocabulary generation state
  const [topicInput, setTopicInput] = createSignal('');
  const [isGenerating, setIsGenerating] = createSignal(false);
  const [generationError, setGenerationError] = createSignal('');
  let abortGeneration: (() => void) | null = null;
  const [wordGridRef, setWordGridRef] = createSignal<HTMLDivElement | undefined>(undefined);

  const isDark = () => settings.theme === 'dark' || settings.theme === 'glass-dark' || settings.theme === 'darker';

  const isValidWordForCurrentLanguage = (word: string) => {
    return Boolean(word?.trim()) && isWordInLanguageScript(word.trim(), settings.language);
  };

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

  // Extract all words from media stats, deduplicated, sorted by ease
  const mediaWords = createMemo((): PassiveWordKnowledge[] => {
    const wordMap = new Map<string, PassiveWordKnowledge>();

    for (const media of mediaStats()) {
      for (const entry of Object.values(media.wordsEncountered)) {
        if (!isWordInLanguageScript(entry.word, settings.language)) continue;
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

  // All tracked words from wordKnowledge for the current language
  const trackedWords = createMemo((): PassiveWordKnowledge[] => {
    const knowledge = flashcardCtx.store.wordKnowledge;
    const lang = settings.language;
    const items: PassiveWordKnowledge[] = [];

    for (const key of Object.keys(knowledge)) {
      const entry = knowledge[key];
      if (!entry) continue;
      if (entry.language && entry.language !== lang) continue;
      if (!isWordInLanguageScript(entry.word, lang)) continue;
      items.push(entry);
    }

    // Sort by ease ascending (least known first)
    return items.sort((a, b) => a.ease - b.ease);
  });

  // Words from flashcards for the current language
  const flashcardWords = createMemo((): PassiveWordKnowledge[] => {
    const cards = flashcardCtx.store.flashcards;
    const lang = settings.language;
    const items: PassiveWordKnowledge[] = [];

    for (const id of Object.keys(cards)) {
      const card = cards[id];
      if (!card) continue;
      if (card.language && card.language !== lang) continue;
      const word = card.content.front || card.content.word;
      if (!word || !isWordInLanguageScript(word, lang)) continue;
      items.push({
        word,
        reading: card.content.reading || card.content.pronunciation,
        ease: card.ease,
        lastSeen: card.lastReviewed || card.createdAt,
        timesSeen: card.reviews || 0,
        timesHovered: 0,
      });
    }

    return items;
  });

  const wordStatusMap = createMemo(() => getWordsLearnedInApp());

  // Combined word list: media + tracked + flashcards, deduplicated, sorted by ease (least known first)
  const allWords = createMemo((): PassiveWordKnowledge[] => {
    const media = mediaWords();
    const wordMap = new Map<string, PassiveWordKnowledge>();

    // Add media words first
    for (const w of media) {
      wordMap.set(w.word, w);
    }

    // Add tracked words (keep lowest ease if duplicated)
    for (const w of trackedWords()) {
      const existing = wordMap.get(w.word);
      if (!existing || w.ease < existing.ease) {
        wordMap.set(w.word, w);
      }
    }

    // Add flashcard words
    for (const w of flashcardWords()) {
      const existing = wordMap.get(w.word);
      if (!existing || w.ease < existing.ease) {
        wordMap.set(w.word, w);
      }
    }

    // Include words from the word-status database used by Word DB editor.
    for (const [word, status] of Object.entries(wordStatusMap())) {
      if (!isWordInLanguageScript(word, settings.language)) continue;
      const statusEase = status === WORD_STATUS.KNOWN
        ? 4.5
        : status === WORD_STATUS.LEARNING
          ? 2.5
          : 1.8;
      const existing = wordMap.get(word);
      if (!existing) {
        wordMap.set(word, {
          word,
          ease: statusEase,
          lastSeen: 0,
          timesSeen: 0,
          timesHovered: 0,
        });
      } else if (status === WORD_STATUS.KNOWN && existing.ease < statusEase) {
        wordMap.set(word, { ...existing, ease: statusEase });
      }
    }

    // Also add custom words that aren't in any list
    for (const cw of customWords()) {
      if (!wordMap.has(cw.word)) {
        wordMap.set(cw.word, {
          word: cw.word,
          reading: cw.reading,
          ease: cw.ease,
          lastSeen: 0,
          timesSeen: 0,
          timesHovered: 0,
        });
      }
    }

    // Sort by ease ascending (least known first)
    return Array.from(wordMap.values())
      .sort((a, b) => a.ease - b.ease);
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

    // Sort: selected first, then by ease ascending (least known first)
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

  const legendItems = createMemo(() => ([
    { key: 'unassessed', color: getWordCellColor(-1, isDark()) },
    { key: 'hard', color: getWordCellColor(1.4, isDark()) },
    { key: 'struggling', color: getWordCellColor(1.9, isDark()) },
    { key: 'reviewing', color: getWordCellColor(2.4, isDark()) },
    { key: 'known', color: getWordCellColor(3.2, isDark()) },
  ]));

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
    if (!isValidWordForCurrentLanguage(query)) {
      return;
    }

    const newWord: TutorWordSelection = { word: query, ease: -1 };
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
    if (!isValidWordForCurrentLanguage(query)) return false;
    return !allWords().some(w => w.word.toLowerCase() === query.toLowerCase());
  });

  // LLM vocabulary generation
  const generateVocabulary = async () => {
    const topic = topicInput().trim();
    if (!topic || isGenerating()) return;

    if (!settings.llmEnabled || !settings.llmConfigured) {
      setGenerationError(t('mlearn.AITutorSetup.LLMNotConfigured'));
      return;
    }

    // Low power gate: prompt before local LLM call
    if (settings.llmProvider !== 'cloud') {
      const allowed = await requestAccess('llm');
      if (!allowed) return;
    }

    setIsGenerating(true);
    setGenerationError('');

    const lang = settings.language;

    const messages: LLMChatMessage[] = [
      {
        role: 'system',
        content: `You are a language learning vocabulary generator. Generate a list of useful vocabulary words for learning ${lang}. Output ONLY a valid JSON array of objects with "word" (the word in ${lang}) and optionally "reading" (pronunciation/reading if applicable). Do not wrap in markdown code fences. Do not include any explanation or commentary. Generate 10-15 diverse, practical words. Example format: [{"word":"example","reading":"ex"}]`,
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
            // Strip <think>...</think> tags from response (Qwen3 thinking mode)
            // Also handle unclosed <think> blocks (model may not close the tag)
            let cleaned = finalContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            // If there's still an unclosed <think>, strip everything from <think> onward
            const unclosedThink = cleaned.indexOf('<think>');
            if (unclosedThink >= 0) {
              cleaned = cleaned.slice(0, unclosedThink).trim();
            }
            // Strip markdown code fences (```json ... ``` or ``` ... ```)
            cleaned = cleaned.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();

            // If response is empty after cleanup, try to extract JSON from within think tags
            if (!cleaned) {
              // The model may have placed its JSON inside <think> tags
              const thinkMatch = finalContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
              if (thinkMatch) {
                const thinkContent = thinkMatch[1].trim();
                const thinkJson = thinkContent.match(/\[[\s\S]*\]/)?.[0];
                if (thinkJson) {
                  cleaned = thinkJson;
                }
              }
              if (!cleaned) {
                console.error('[VocabGen] Response was empty after stripping think tags and fences');
                setGenerationError(t('mlearn.AITutorSetup.GenerateError'));
                return;
              }
            }
            // Extract JSON array from response (handle potential markdown wrapping)
            let jsonStr = cleaned.match(/\[[\s\S]*\]/)?.[0];
            if (!jsonStr) {
              // Try to find a truncated array start
              const arrayStart = cleaned.indexOf('[');
              if (arrayStart >= 0) {
                jsonStr = cleaned.slice(arrayStart);
              }
            }
            if (!jsonStr) {
              console.error('[VocabGen] No JSON array found in response');
              setGenerationError(t('mlearn.AITutorSetup.GenerateError'));
              return;
            }

            // Attempt to fix truncated JSON: remove trailing partial objects and close the array
            let parsed: Array<{ word: string; reading?: string }>;
            try {
              parsed = JSON.parse(jsonStr);
            } catch (parseErr) {
              // Try to salvage: find last complete object, trim remainder, close the array
              console.warn('[VocabGen] Initial parse failed, attempting salvage:', parseErr);
              const lastCloseBrace = jsonStr.lastIndexOf('}');
              if (lastCloseBrace > 0) {
                const salvaged = jsonStr.slice(0, lastCloseBrace + 1) + ']';
                parsed = JSON.parse(salvaged);
              } else {
                throw new Error('No valid JSON objects found');
              }
            }
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
              if (!isValidWordForCurrentLanguage(word)) continue;

              const entry: TutorWordSelection = {
                word,
                reading: item.reading,
                ease: -1,
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
          } catch (err) {
            console.error('[VocabGen] Failed to parse generated vocabulary:', err);
            setGenerationError(t('mlearn.AITutorSetup.GenerateError'));
          }
        },
        onError: (error) => {
          console.error('[VocabGen] LLM stream error:', error);
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
      <CollapsibleStickyHeader
        class="word-selector__header"
        getScrollContainer={wordGridRef}
      >
        <HintText>{t('mlearn.AITutorSetup.SelectWordsHint')}</HintText>

        <div class="word-selector__search-row">
          <Input
            value={searchQuery()}
            onInput={(e) => {
              setSearchQuery(e.currentTarget.value);
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
                variant="default"
                size="sm"
                onClick={generateVocabulary}
                disabled={isGenerating() || !topicInput().trim()}
                icon={<SparklesIcon size={14} />}
                loading={isGenerating()}
              >
                {t('mlearn.AITutorSetup.GenerateBtn')}
              </Btn>
            </div>
            <Show when={generationError()}>
              <span class="word-selector__generate-error">{generationError()}</span>
            </Show>
          </div>
        </Show>

        <LevelPillsFilter
          levels={availableLevels()}
          selectedLevel={levelFilter()}
          onLevelChange={(level) => {
            setLevelFilter(level);
          }}
          getLevelLabel={(level) => levelNames()[String(level)] || String(level)}
          allLabel={t('mlearn.AITutorSetup.AllLevels')}
        />

        <div class="word-selector__legend" role="group" aria-label={t('mlearn.AITutorSetup.WordEaseLegendTitle')}>
          <span class="word-selector__legend-title">{t('mlearn.AITutorSetup.WordEaseLegendTitle')}</span>
          <For each={legendItems()}>
            {(item) => (
              <div class="word-selector__legend-item">
                <span class="word-selector__legend-swatch" style={{ background: item.color }} />
                <span class="word-selector__legend-label">
                  {t(`mlearn.AITutorSetup.WordEaseLegend.${item.key}`)}
                </span>
              </div>
            )}
          </For>
        </div>

        {/*<Show when={props.selected.length > 0}>*/}
          <HintText>{t('mlearn.AITutorSetup.ItemsSelected', { count: String(props.selected.length) })}</HintText>
        {/*</Show>*/}

        <Show when={allWords().length === 0}>
          <EmptyState
            title={t('mlearn.AITutorSetup.NoWordsYet')}
          />
        </Show>
      </CollapsibleStickyHeader>

      <div
        class="word-selector__grid"
        ref={setWordGridRef}
      >
        <For each={filteredWords()}>
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

    </div>
  );
};
