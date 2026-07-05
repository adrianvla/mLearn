/**
 * Character Grid Window
 * Displays a visual grid of language-defined study characters with learning status colors.
 */

import { Component, createSignal, For, Show, onMount, createMemo, createEffect } from 'solid-js';
import { WindowWrapper, useLanguage, useLocalization, useSettings, useFlashcards } from '../../context';
import { WORD_STATUS } from '../../../shared/constants';
import {
  extractUniqueStudyCharacters,
  getCharacterStudyLevelOrder,
  getCharacterStudyScripts,
  getFrequencyLevelLabel,
  isDisplayableFrequencyLevel,
  selectHarderFrequencyLevel,
  shouldShowCharacterStudyLevelDisclaimer,
} from '../../../shared/languageFeatures';
import { Spinner, PillLabel, LegendItem, BookIcon, AlertBanner } from '../../components/common';
import './characterGrid.css';
import { getLogger } from '../../../shared/utils/logger';
import type { LanguageCharacterStudyConfig } from '../../../shared/types';

const log = getLogger("renderer.characterGrid.app");

interface StudyCharacterData {
  character: string;
  category: 'known' | 'learning' | 'unknown';
  score: number;
  knownCount: number;
  learnCount: number;
  wordsKnown: string[];
  wordsLearning: string[];
  wordsUnknown: string[];
  level?: number;
}

// Linear interpolation
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// Mix two hex colors
function mixHex(c1: string, c2: string, t: number): string {
  const hexToRgb = (hex: string) => {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (!m) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(m[1], 16),
      g: parseInt(m[2], 16),
      b: parseInt(m[3], 16),
    };
  };

  const rgbToHex = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  };

  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  return rgbToHex({
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  });
}

export const CharacterGridContent: Component = () => {
  const { getWordFrequency, getFreqLevelNames, getFrequency, currentLangData } = useLanguage();
  const { t } = useLocalization();
  const { settings } = useSettings();
  const flashcardCtx = useFlashcards();

  const [characterData, setCharacterData] = createSignal<StudyCharacterData[]>([]);
  const [hoveredCharacter, setHoveredCharacter] = createSignal<StudyCharacterData | null>(null);
  const [hoveredLevel, setHoveredLevel] = createSignal<number | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [levelCharacters, setLevelCharacters] = createSignal<Record<number, Set<string>>>({});

  // Get dynamic level names from language data
  const levelNames = createMemo(() => {
    const names = getFreqLevelNames();
    // Convert to Record<number, string> for easier iteration
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(names)) {
      const level = Number(key);
      if (Number.isFinite(level)) result[level] = value;
    }
    return result;
  });

  // Get sorted level keys using the language's character-study level semantics.
  const sortedLevelKeys = createMemo(() => {
    const keys = Object.keys(levelNames()).map(Number).filter(n => !isNaN(n));
    const order = getCharacterStudyLevelOrder(currentLangData());
    return keys.sort((a, b) => order === 'ascending' ? a - b : b - a);
  });

  const studyScripts = createMemo(() => getCharacterStudyScripts(currentLangData()));
  const supportsCharacterStudy = createMemo(() => studyScripts().length > 0);
  const showLevelDisclaimer = createMemo(() => shouldShowCharacterStudyLevelDisclaimer(currentLangData()));
  const characterStudyLabels = createMemo(() => currentLangData()?.characterStudy?.labels ?? {});
  const characterStudyText = (
    key: keyof NonNullable<LanguageCharacterStudyConfig['labels']>,
    fallbackKey: string,
  ) => {
    const configured = characterStudyLabels()[key]?.trim();
    return configured || t(fallbackKey);
  };

  // Calculate stats
  const stats = createMemo(() => {
    const data = characterData();
    const known = data.filter(item => item.category === 'known').length;
    const learning = data.filter(item => item.category === 'learning').length;
    const unknown = data.filter(item => item.category === 'unknown').length;
    const total = data.length;
    return { known, learning, unknown, total };
  });

  const buildCharacterStats = async () => {
    setIsLoading(true);

    try {
      if (!supportsCharacterStudy()) {
        setCharacterData([]);
        setLevelCharacters({});
        return;
      }

      const characterMap = new Map<string, StudyCharacterData>();
      const levels: Record<number, Set<string>> = {};
      const lang = settings.language;
      const languageData = currentLangData();
      const declaredLevels = new Set(
        Object.keys(levelNames())
          .map(Number)
          .filter((level) => isDisplayableFrequencyLevel(level, levelNames(), languageData)),
      );
      const declaredCharacterLevel = (level: number | undefined): number | undefined => (
        level !== undefined && declaredLevels.has(level) ? level : undefined
      );

      const wordSet = new Set<string>();

      for (const entry of Object.values(flashcardCtx.store.wordKnowledge)) {
        if (entry && entry.language === lang) {
          wordSet.add(entry.word);
        }
      }

      for (const card of Object.values(flashcardCtx.store.flashcards)) {
        if (card.language === lang) {
          const word = card.content.front || card.content.word;
          if (word) wordSet.add(word);
        }
      }

      for (const entry of Object.values(flashcardCtx.store.ignoredWords)) {
        if (entry && entry.language === lang) {
          wordSet.add(entry.word);
        }
      }

      const trackedWordsArray: Array<{ word: string; status: number }> = [];
      for (const word of wordSet) {
        const status = flashcardCtx.getComprehensiveWordStatusSync(word, lang);
        if (status === 'known') {
          trackedWordsArray.push({ word, status: WORD_STATUS.KNOWN });
        } else if (status === 'learning') {
          trackedWordsArray.push({ word, status: WORD_STATUS.LEARNING });
        } else {
          trackedWordsArray.push({ word, status: WORD_STATUS.UNKNOWN });
        }
      }

      // Process real tracked words and build the per-level character mapping.
      for (const { word, status } of trackedWordsArray) {
        const uniqueCharacters = extractUniqueStudyCharacters(word, studyScripts());

        // Get word level from frequency data
        const freqData = getFrequency(word);
        const wordLevel = declaredCharacterLevel(freqData?.raw_level);

        for (const character of uniqueCharacters) {
          if (!characterMap.has(character)) {
            characterMap.set(character, {
              character,
              category: 'unknown',
              score: 0,
              knownCount: 0,
              learnCount: 0,
              wordsKnown: [],
              wordsLearning: [],
              wordsUnknown: [],
              level: wordLevel,
            });
          }

          const item = characterMap.get(character)!;

          // Track characters by level for hover highlighting.
          if (wordLevel !== undefined) {
            if (!levels[wordLevel]) {
              levels[wordLevel] = new Set();
            }
            levels[wordLevel].add(character);
            item.level = selectHarderFrequencyLevel(wordLevel, item.level, languageData);
          }

          if (status === WORD_STATUS.KNOWN) {
            item.score += 1;
            item.knownCount += 1;
            item.wordsKnown.push(word);
          } else if (status === WORD_STATUS.LEARNING) {
            item.score += 0.5;
            item.learnCount += 1;
            item.wordsLearning.push(word);
          } else {
            item.wordsUnknown.push(word);
          }
        }
      }

      // Also add study characters from the frequency data (words not yet tracked).
      const wordFrequency = getWordFrequency();
      if (wordFrequency) {
        for (const [word, data] of Object.entries(wordFrequency)) {
          const level = declaredCharacterLevel(data.raw_level);

          const uniqueCharacters = extractUniqueStudyCharacters(word, studyScripts());

          for (const character of uniqueCharacters) {
            // Add to level mapping
            if (level !== undefined) {
              if (!levels[level]) {
                levels[level] = new Set();
              }
              levels[level].add(character);
            }

            // Add character to map if not already present
            if (!characterMap.has(character)) {
              characterMap.set(character, {
                character,
                category: 'unknown',
                score: 0,
                knownCount: 0,
                learnCount: 0,
                wordsKnown: [],
                wordsLearning: [],
                wordsUnknown: [word],
                level,
              });
            } else if (level !== undefined) {
              const item = characterMap.get(character)!;
              item.level = selectHarderFrequencyLevel(level, item.level, languageData);
            }
          }
        }
      }

      // Classify characters.
      let maxKnown = 1;
      let maxLearn = 0.5;
      
      for (const item of characterMap.values()) {
        if (item.knownCount > 0) {
          item.category = 'known';
          maxKnown = Math.max(maxKnown, item.score);
        } else if (item.score > 0) {
          item.category = 'learning';
          maxLearn = Math.max(maxLearn, item.score);
        }
      }

      // Sort by category and score
      const sorted = Array.from(characterMap.values()).sort((a, b) => {
        const order = { known: 0, learning: 1, unknown: 2 };
        if (order[a.category] !== order[b.category]) {
          return order[a.category] - order[b.category];
        }
        return b.score - a.score;
      });

      setCharacterData(sorted);
      setLevelCharacters(levels);
    } catch (e) {
      log.error('Failed to build character stats:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const getColorForCharacter = (item: StudyCharacterData): string => {
    const maxKnown = Math.max(1, ...characterData().filter(entry => entry.category === 'known').map(entry => entry.score));
    const maxLearn = Math.max(0.5, ...characterData().filter(entry => entry.category === 'learning').map(entry => entry.score));

    if (item.category === 'known') {
      const t = maxKnown > 1 ? (item.score - 1) / (maxKnown - 1) : 0;
      return mixHex('#2E7D32', '#81C784', t);
    } else if (item.category === 'learning') {
      const t = maxLearn > 0.5 ? (item.score - 0.5) / (maxLearn - 0.5) : 0;
      return mixHex('#E65100', '#FFEB3B', t);
    }
    return 'var(--character-grid-unknown-bg)';
  };

  const isCharacterDimmed = (item: StudyCharacterData) => {
    const level = hoveredLevel();
    if (level === null) return false;
    
    const charactersInLevel = levelCharacters()[level];
    if (!charactersInLevel) return true;
    
    return !charactersInLevel.has(item.character);
  };

  onMount(() => {
    buildCharacterStats();
  });

  // Rebuild when language data changes
  createEffect(() => {
    if (currentLangData()) {
      buildCharacterStats();
    }
  });

  return (
    <div class="character-grid-window">
      <div class="cg-header">
        <h1>{characterStudyText('title', 'mlearn.CharacterGrid.Title')}</h1>
        <p class="cg-subtitle">
          {characterStudyText('description', 'mlearn.CharacterGrid.Description')}
        </p>
      </div>

      <div class="cg-main">
        <div class="cg-grid">
          <Show when={!isLoading() && characterData().length > 0}>
            <For each={characterData()}>
              {(item) => (
                <div
                  class={`cg-cell ${isCharacterDimmed(item) ? 'dimmed' : ''} ${item.category !== 'unknown' ? 'cg-cell-colored' : 'cg-cell-unknown'}`}
                  style={{ background: getColorForCharacter(item) }}
                  onMouseEnter={() => setHoveredCharacter(item)}
                  onMouseLeave={() => setHoveredCharacter(null)}
                >
                  <span class="study-character">{item.character}</span>
                </div>
              )}
            </For>
          </Show>
          
          <Show when={!isLoading() && supportsCharacterStudy() && characterData().length === 0}>
            <div class="cg-empty-state">
              <div class="empty-icon"><BookIcon size={40} /></div>
              <h3>{characterStudyText('emptyTitle', 'mlearn.CharacterGrid.EmptyState.Title')}</h3>
              <p>{characterStudyText('emptyDescription', 'mlearn.CharacterGrid.EmptyState.Description')}</p>
              <p class="hint">{characterStudyText('emptyHint', 'mlearn.CharacterGrid.EmptyState.Hint')}</p>
            </div>
          </Show>

          <Show when={!isLoading() && !supportsCharacterStudy()}>
            <div class="cg-empty-state">
              <div class="empty-icon"><BookIcon size={40} /></div>
              <h3>{characterStudyText('unsupportedTitle', 'mlearn.CharacterGrid.Unsupported.Title')}</h3>
              <p>{characterStudyText('unsupportedDescription', 'mlearn.CharacterGrid.Unsupported.Description')}</p>
            </div>
          </Show>
          
          <Show when={isLoading()}>
            <Spinner size={40} shape="square" text={characterStudyText('loading', 'mlearn.CharacterGrid.Loading')} />
          </Show>
        </div>

        <div class="cg-sidebar">
          {/* Legend */}
          <div class="cg-legend">
            <LegendItem label={t('mlearn.CharacterGrid.Legend.Learning')} color="var(--pos-auxiliary)" secondaryColor="var(--color-warning)" showArrow />
            <LegendItem label={t('mlearn.CharacterGrid.Legend.Known')} color="var(--color-success)" secondaryColor="var(--color-success-lighter)" showArrow />
            <LegendItem label={t('mlearn.CharacterGrid.Legend.Unknown')} color="var(--character-grid-unknown-bg)" />
          </div>

          {/* Stats */}
          <div class="cg-stats">
            <div>· {t('mlearn.CharacterGrid.Stats.Known')} <b>{stats().known}</b> <span class="cg-stats-pct">({stats().total ? Math.round(stats().known / stats().total * 1000) / 10 : 0}%)</span></div>
            <div>· {t('mlearn.CharacterGrid.Stats.Learning')} <b>{stats().learning}</b> <span class="cg-stats-pct">({stats().total ? Math.round(stats().learning / stats().total * 1000) / 10 : 0}%)</span></div>
            <div>· {t('mlearn.CharacterGrid.Stats.Unknown')} <b>{stats().unknown}</b> <span class="cg-stats-pct">({stats().total ? Math.round(stats().unknown / stats().total * 1000) / 10 : 0}%)</span></div>
            <div>· {t('mlearn.CharacterGrid.Stats.TotalFound')} <b>{stats().total}</b></div>
          </div>

          {/* Level Pills - dynamically loaded from language data */}
          <Show when={supportsCharacterStudy() && sortedLevelKeys().length > 0}>
            <div class="cg-levels">
              <p>{characterStudyText('byLevel', 'mlearn.CharacterGrid.CharactersByLevel')}</p>
              <Show when={showLevelDisclaimer()}>
                <AlertBanner
                  variant="info"
                  size="sm"
                  class="cg-disclaimer"
                  title={t('mlearn.CharacterGrid.Disclaimer.Title')}
                  message={t('mlearn.CharacterGrid.Disclaimer.Description')}
                />
              </Show>
              <div class="level-pills">
                <For each={sortedLevelKeys()}>
                  {(level) => {
                    const count = () => levelCharacters()[level]?.size || 0;
                    return (
                      <PillLabel
                        level={level}
                        clickable
                        class={hoveredLevel() === level ? 'active' : ''}
                        onClick={() => {}}
                        onMouseEnter={() => setHoveredLevel(level)}
                        onMouseLeave={() => setHoveredLevel(null)}
                        count={count() > 0 ? count() : undefined}
                      >
                        {getFrequencyLevelLabel(level, levelNames(), currentLangData())}
                      </PillLabel>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* Tooltip */}
      <Show when={hoveredCharacter()}>
        <div class="cg-tooltip">
          <div class="tooltip-title">
            {t('mlearn.CharacterGrid.Tooltip.WordsContaining', { char: hoveredCharacter()!.character })}
            <span class="tooltip-meta">
              {hoveredCharacter()!.category} ({t('mlearn.CharacterGrid.Tooltip.Score')} {Math.round(hoveredCharacter()!.score * 10) / 10},
              {t('mlearn.CharacterGrid.Tooltip.KnownCount')}: {hoveredCharacter()!.knownCount}, {t('mlearn.CharacterGrid.Tooltip.LearningCount')}: {hoveredCharacter()!.learnCount})
            </span>
          </div>
          <div class="tooltip-words">
            <For each={hoveredCharacter()!.wordsKnown.slice(0, 10)}>
              {(word) => <PillLabel variant="green" size="sm">{word}</PillLabel>}
            </For>
            <For each={hoveredCharacter()!.wordsLearning.slice(0, 10)}>
              {(word) => <PillLabel variant="orange" size="sm">{word}</PillLabel>}
            </For>
            <For each={hoveredCharacter()!.wordsUnknown.slice(0, 10)}>
              {(word) => <PillLabel variant="gray" size="sm">{word}</PillLabel>}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

// Main App with providers
export const CharacterGridApp: Component = () => {
  return (
    <WindowWrapper>
      <CharacterGridContent />
    </WindowWrapper>
  );
};

export default CharacterGridApp;
