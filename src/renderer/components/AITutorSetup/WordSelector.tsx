/** Manual tutor material selection. Sources supply words, never knowledge classifications. */

import { Component, createSignal, createMemo, For, Show, onMount, onCleanup, batch } from 'solid-js';
import { useLocalization, useSettings, useLowPowerGate } from '../../context';
import { useLanguage } from '../../context/LanguageContext';
import { useFlashcards } from '../../context/FlashcardContext';
import { getBridge } from '../../../shared/bridges';
import { streamChat, isLLMReady } from '../../services/llmProvider';
import { getFrequencyLevelLabel, getFrequencyLevelVisualRank, getLanguagePromptName, isDisplayableFrequencyLevel, sortFrequencyLevelsForDisplay } from '../../../shared/languageFeatures';
import { isWordInLanguageScript } from '../../../shared/utils/textUtils';
import { resolveWordSelectorLanguageData } from './wordSelectorLanguage';

import { Input, LevelPillsFilter, EmptyState, HintText, Btn, SparklesIcon, CollapsibleStickyHeader } from '../common';
import type {
  TutorWordSelection,
  PassiveWordKnowledge,
  MediaStats,
  LLMChatMessage,
} from '../../../shared/types';
import './WordSelector.css';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.wordSelector");

interface WordSelectorProps {
  selected: TutorWordSelection[];
  onSelectionChange: (selected: TutorWordSelection[]) => void;
  customWords: TutorWordSelection[];
  onCustomWordsChange: (words: TutorWordSelection[]) => void;
}

export const WordSelector: Component<WordSelectorProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();

  const { getFrequency, getFreqLevelNames, langData, currentLangData } = useLanguage();
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


  const languageDataFor = (language: string) => resolveWordSelectorLanguageData(
    language,
    settings.language,
    langData,
    currentLangData(),
  );

  const isValidWordForLanguage = (word: string, language: string) => {
    return Boolean(word?.trim()) && isWordInLanguageScript(word.trim(), language, languageDataFor(language));
  };

  const isValidWordForCurrentLanguage = (word: string) => isValidWordForLanguage(word, settings.language);

  // Load media stats on mount
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.mediaStats.onMediaStatsList((stats) => {
      setMediaStats(stats);
    });
    bridge.mediaStats.listMediaStats();
    onCleanup(cleanup);
  });

  // Clean up LLM generation on unmount
  onCleanup(() => {
    if (abortGeneration) abortGeneration();
  });

  // Media contributes candidate text only; its historical ease is not present knowledge.
  const mediaWords = createMemo((): PassiveWordKnowledge[] => {
    const wordMap = new Map<string, PassiveWordKnowledge>();

    for (const media of mediaStats()) {
      if (media.language !== settings.language) continue;
      for (const entry of Object.values(media.wordsEncountered)) {
        if (!isValidWordForCurrentLanguage(entry.word)) continue;
        // Deduplicate source text without ranking by historical ease.
        const existing = wordMap.get(entry.word);
        if (!existing) {
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

    return Array.from(wordMap.values());
  });

  // All tracked words from wordKnowledge for the current language
  const trackedWords = createMemo((): PassiveWordKnowledge[] => {
    const knowledge = flashcardCtx.store.wordKnowledge;
    const lang = settings.language;
    const items: PassiveWordKnowledge[] = [];

    for (const key of Object.keys(knowledge)) {
      const entry = knowledge[key];
      if (!entry) continue;
      if ((entry.language ?? key.split(':')[0]) !== lang) continue;
      if (!isValidWordForLanguage(entry.word, lang)) continue;
      items.push(entry);
    }

    return items;
  });

  // Words from flashcards for the current language
  const flashcardWords = createMemo((): PassiveWordKnowledge[] => {
    const cards = flashcardCtx.store.flashcards;
    const lang = settings.language;
    const items: PassiveWordKnowledge[] = [];

    for (const id of Object.keys(cards)) {
      const card = cards[id];
      if (!card) continue;
      if (card.language !== lang) continue;
      const word = card.content.front || card.content.word;
      if (!word || !isValidWordForLanguage(word, lang)) continue;
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

  // Combine source text for manual selection, with stable alphabetical ordering.
  const allWords = createMemo((): PassiveWordKnowledge[] => {
    const media = mediaWords();
    const wordMap = new Map<string, PassiveWordKnowledge>();

    // Add media words first
    for (const w of media) {
      wordMap.set(w.word, w);
    }

    // Prefer a saved reading where available without interpreting source ease.
    for (const w of trackedWords()) {
      const existing = wordMap.get(w.word);
      if (!existing || (!existing.reading && w.reading)) {
        wordMap.set(w.word, w);
      }
    }

    // Add flashcard words
    for (const w of flashcardWords()) {
      const existing = wordMap.get(w.word);
      if (!existing || (!existing.reading && w.reading)) {
        wordMap.set(w.word, w);
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

    return Array.from(wordMap.values()).sort((a, b) => a.word.localeCompare(b.word));
  });

  // Available frequency levels for filter pills
  const availableLevels = createMemo(() => {
    const levels = new Set<number>();
    const levelNames = getFreqLevelNames();
    const languageData = currentLangData();
    for (const w of allWords()) {
      const freq = getFrequency(w.word);
      if (freq && isDisplayableFrequencyLevel(freq.raw_level, levelNames, languageData)) {
        levels.add(freq.raw_level);
      }
    }
    return sortFrequencyLevelsForDisplay(Array.from(levels), languageData);
  });

  // Level names from language data
  const levelNames = createMemo(() => getFreqLevelNames());

  // Selected words set for O(1) lookup
  const selectedWords = createMemo(() => new Set(props.selected.map(s => s.word)));

  const queryFilteredWords = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const level = levelFilter();

    let items = allWords();

    // Filter by frequency level
    if (level !== null) {
      items = items.filter(w => {
        const freq = getFrequency(w.word);
        return freq
          && isDisplayableFrequencyLevel(freq.raw_level, levelNames(), currentLangData())
          && freq.raw_level === level;
      });
    }

    // Filter by search
    if (query) {
      items = items.filter(w =>
        w.word.toLowerCase().includes(query) ||
        (w.reading && w.reading.toLowerCase().includes(query))
      );
    }

    return items;
  });

  // Keep selection interactions cheap: only partition the current query
  // snapshot instead of rebuilding or sorting the full source list.
  const filteredWords = createMemo(() => {
    const selected = selectedWords();
    const selectedItems: PassiveWordKnowledge[] = [];
    const unselectedItems: PassiveWordKnowledge[] = [];

    for (const item of queryFilteredWords()) {
      if (selected.has(item.word)) {
        selectedItems.push(item);
      } else {
        unselectedItems.push(item);
      }
    }

    return [...selectedItems, ...unselectedItems];
  });

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

    if (!isLLMReady(settings)) {
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
    const languagePromptName = getLanguagePromptName(lang, currentLangData());

    const messages: LLMChatMessage[] = [
      {
        role: 'system',
        content: `You are a language learning vocabulary generator. Generate a list of useful vocabulary words for learning ${languagePromptName}. Output ONLY a valid JSON array of objects with "word" (the word in ${languagePromptName}) and optionally "reading" (pronunciation, transliteration, or reading annotation if useful for this language). Do not wrap in markdown code fences. Do not include any explanation or commentary. Generate 10-15 diverse, practical words. Example format: [{"word":"example","reading":"ex"}]`,
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
                log.error('[VocabGen] Response was empty after stripping think tags and fences');
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
              log.error('[VocabGen] No JSON array found in response');
              setGenerationError(t('mlearn.AITutorSetup.GenerateError'));
              return;
            }

            // Attempt to fix truncated JSON: remove trailing partial objects and close the array
            let parsed: Array<{ word: string; reading?: string }>;
            try {
              parsed = JSON.parse(jsonStr);
            } catch (parseErr) {
              // Try to salvage: find last complete object, trim remainder, close the array
              log.warn('[VocabGen] Initial parse failed, attempting salvage:', parseErr);
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
            log.error('[VocabGen] Failed to parse generated vocabulary:', err);
            setGenerationError(t('mlearn.AITutorSetup.GenerateError'));
          }
        },
        onError: (error) => {
          log.error('[VocabGen] LLM stream error:', error);
          setIsGenerating(false);
          abortGeneration = null;
          setGenerationError(typeof error === 'string' ? error : error instanceof Error ? error.message : t('mlearn.AITutorSetup.GenerateError'));
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
        <Show when={isLLMReady(settings)}>
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
          getLevelLabel={(level) => getFrequencyLevelLabel(level, levelNames(), currentLangData())}
          getVisualLevel={(level) => getFrequencyLevelVisualRank(level, levelNames(), currentLangData())}
          allLabel={t('mlearn.AITutorSetup.AllLevels')}
        />

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
            <div class="word-selector__item"><button type="button"
              class={`word-selector__cell ${selectedWords().has(w.word) ? 'selected' : ''}`}
              onClick={() => toggleWord(w)}
              title={w.reading ? `${w.word} (${w.reading})` : w.word}
              aria-pressed={selectedWords().has(w.word)}
            >
              <span class="word-selector__cell-text">{w.word}</span>
            </button>
            <button type="button" class="word-selector__inspect" onClick={() => openKnowledgeInspector(surfaceKnowledgeInspection(settings.language, w.word))}>{t('mlearn.Knowledge.Popup.Inspect')}</button>
            </div>
          )}
        </For>
      </div>

    </div>
  );
};
