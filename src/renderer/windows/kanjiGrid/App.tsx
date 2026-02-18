/**
 * Kanji Grid Window
 * Displays a visual grid of kanji with learning status colors
 * Ported from showKnownKanjiGrid in stats.js
 * 
 * Features:
 * - Shows all kanji from tracked words
 * - Color-coded by learning status (known/learning/unknown)
 * - Level pills from language data (not hardcoded)
 * - Hover highlighting for kanji by level
 */

import { Component, createSignal, For, Show, onMount, createMemo, createEffect } from 'solid-js';
import { WindowWrapper, useSettings, useLanguage, useLocalization } from '../../context';
import {
  getWordsLearnedInApp,
} from '../../services/statsService';
import { WORD_STATUS } from '../../../shared/constants';
import { Spinner, PillLabel, LegendItem, BookIcon } from '../../components/common';
import './kanjiGrid.css';

interface KanjiData {
  kanji: string;
  category: 'known' | 'learning' | 'unknown';
  score: number;
  knownCount: number;
  learnCount: number;
  wordsKnown: string[];
  wordsLearning: string[];
  wordsUnknown: string[];
  level?: number; // The frequency level (e.g., 5 = N5)
}

// Check if character is kanji
function isKanjiChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0) || 0;
  return (
    (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4DBF) || // Extension A
    (code >= 0xF900 && code <= 0xFAFF)    // Compatibility Ideographs
  );
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

export const KanjiGridContent: Component = () => {
  const { settings } = useSettings();
  const { wordFrequency, getFreqLevelNames, getFrequency, currentLangData } = useLanguage();
  const { t } = useLocalization();
  
  const [kanjiData, setKanjiData] = createSignal<KanjiData[]>([]);
  const [hoveredKanji, setHoveredKanji] = createSignal<KanjiData | null>(null);
  const [hoveredLevel, setHoveredLevel] = createSignal<number | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [levelKanji, setLevelKanji] = createSignal<Record<number, Set<string>>>({});

  // Get dynamic level names from language data
  const levelNames = createMemo(() => {
    const names = getFreqLevelNames();
    // Convert to Record<number, string> for easier iteration
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(names)) {
      result[parseInt(key)] = value;
    }
    return result;
  });

  // Get sorted level keys (descending, so higher levels like N1 appear first)
  const sortedLevelKeys = createMemo(() => {
    const keys = Object.keys(levelNames()).map(Number).filter(n => !isNaN(n));
    return keys.sort((a, b) => b - a);
  });

  // Calculate stats
  const stats = createMemo(() => {
    const data = kanjiData();
    const known = data.filter(k => k.category === 'known').length;
    const learning = data.filter(k => k.category === 'learning').length;
    const unknown = data.filter(k => k.category === 'unknown').length;
    const total = data.length;
    return { known, learning, unknown, total };
  });

  // Build kanji data from tracked words
  const buildKanjiStats = async () => {
    setIsLoading(true);
    
    try {
      const trackedWordsMap = getWordsLearnedInApp();
      const kanjiMap = new Map<string, KanjiData>();
      const levels: Record<number, Set<string>> = {};

      // Convert tracked words map to array
      // Keys are in format: word|reading or just word
      const trackedWordsArray = Object.entries(trackedWordsMap).map(([key, status]) => {
        const [word] = key.split('|');
        return { word, status };
      });

      // Only process if we have tracked words - no sample/demo data
      if (trackedWordsArray.length === 0) {
        // No tracked words yet - show empty state
        setKanjiData([]);
        setLevelKanji({});
        setIsLoading(false);
        return;
      }

      // Process real tracked words and build level-kanji mapping
      for (const { word, status } of trackedWordsArray) {
        const chars = Array.from(word) as string[];
        const uniqueKanji = new Set(chars.filter(ch => isKanjiChar(ch)));
        
        // Get word level from frequency data
        const freqData = getFrequency(word);
        const wordLevel = freqData?.raw_level;

        for (const k of uniqueKanji) {
          if (!kanjiMap.has(k)) {
            kanjiMap.set(k, {
              kanji: k,
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

          const item = kanjiMap.get(k)!;
          
          // Track kanji by level for hover highlighting
          if (wordLevel !== undefined) {
            if (!levels[wordLevel]) {
              levels[wordLevel] = new Set();
            }
            levels[wordLevel].add(k);
            // Keep the highest level (lowest number = more advanced)
            if (item.level === undefined || wordLevel < item.level) {
              item.level = wordLevel;
            }
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
      
      // Also add kanji from the frequency data (words not yet tracked)
      // This ensures we show all kanji that exist in the language's frequency list
      if (wordFrequency) {
        for (const [word, data] of Object.entries(wordFrequency)) {
          const level = data.raw_level;
          if (level === undefined) continue;
          
          const chars = Array.from(word) as string[];
          const uniqueKanji = chars.filter(ch => isKanjiChar(ch));
          
          for (const k of uniqueKanji) {
            // Add to level mapping
            if (!levels[level]) {
              levels[level] = new Set();
            }
            levels[level].add(k);
            
            // Add kanji to map if not already present
            if (!kanjiMap.has(k)) {
              kanjiMap.set(k, {
                kanji: k,
                category: 'unknown',
                score: 0,
                knownCount: 0,
                learnCount: 0,
                wordsKnown: [],
                wordsLearning: [],
                wordsUnknown: [word],
                level,
              });
            }
          }
        }
      }

      // Classify kanji
      let maxKnown = 1;
      let maxLearn = 0.5;
      
      for (const item of kanjiMap.values()) {
        if (item.knownCount > 0) {
          item.category = 'known';
          maxKnown = Math.max(maxKnown, item.score);
        } else if (item.score > 0) {
          item.category = 'learning';
          maxLearn = Math.max(maxLearn, item.score);
        }
      }

      // Sort by category and score
      const sorted = Array.from(kanjiMap.values()).sort((a, b) => {
        const order = { known: 0, learning: 1, unknown: 2 };
        if (order[a.category] !== order[b.category]) {
          return order[a.category] - order[b.category];
        }
        return b.score - a.score;
      });

      setKanjiData(sorted);
      setLevelKanji(levels);
    } catch (e) {
      console.error('Failed to build kanji stats:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Get color for kanji based on category
  const getColorForKanji = (item: KanjiData): string => {
    const maxKnown = Math.max(1, ...kanjiData().filter(k => k.category === 'known').map(k => k.score));
    const maxLearn = Math.max(0.5, ...kanjiData().filter(k => k.category === 'learning').map(k => k.score));

    if (item.category === 'known') {
      const t = maxKnown > 1 ? (item.score - 1) / (maxKnown - 1) : 0;
      return mixHex('#2E7D32', '#81C784', t);
    } else if (item.category === 'learning') {
      const t = maxLearn > 0.5 ? (item.score - 0.5) / (maxLearn - 0.5) : 0;
      return mixHex('#E65100', '#FFEB3B', t);
    }
    const isDark = settings.theme === 'dark' || settings.theme === 'glass-dark' || settings.theme === 'darker';
    return isDark ? '#616161' : '#9E9E9E';
  };

  // Check if kanji should be dimmed (not in hovered level)
  const isKanjiDimmed = (item: KanjiData) => {
    const level = hoveredLevel();
    if (level === null) return false;
    
    const kanjiInLevel = levelKanji()[level];
    if (!kanjiInLevel) return true;
    
    return !kanjiInLevel.has(item.kanji);
  };

  onMount(() => {
    buildKanjiStats();
  });

  // Rebuild when language data changes
  createEffect(() => {
    if (currentLangData()) {
      buildKanjiStats();
    }
  });

  return (
    <div class="kanji-grid-window">
      <div class="kg-header">
        <h1>{t('mlearn.KanjiGrid.Title')}</h1>
        <p class="kg-subtitle">
          {t('mlearn.KanjiGrid.Description')}
        </p>
      </div>

      <div class="kg-main">
        <div class="kg-grid">
          <Show when={!isLoading() && kanjiData().length > 0}>
            <For each={kanjiData()}>
              {(item) => (
                <div
                  class={`kg-cell ${isKanjiDimmed(item) ? 'dimmed' : ''}`}
                  style={{
                    background: getColorForKanji(item),
                    color: item.category !== 'unknown' ? '#111' : ((settings.theme === 'dark' || settings.theme === 'glass-dark' || settings.theme === 'darker') ? '#ddd' : '#222'),
                  }}
                  onMouseEnter={() => setHoveredKanji(item)}
                  onMouseLeave={() => setHoveredKanji(null)}
                >
                  <span class="kanji-char">{item.kanji}</span>
                </div>
              )}
            </For>
          </Show>
          
          <Show when={!isLoading() && kanjiData().length === 0}>
            <div class="kg-empty-state">
              <div class="empty-icon"><BookIcon size={40} /></div>
              <h3>{t('mlearn.KanjiGrid.EmptyState.Title')}</h3>
              <p>{t('mlearn.KanjiGrid.EmptyState.Description')}</p>
              <p class="hint">{t('mlearn.KanjiGrid.EmptyState.Hint')}</p>
            </div>
          </Show>
          
          <Show when={isLoading()}>
            <Spinner size={40} text={t('mlearn.KanjiGrid.Loading')} />
          </Show>
        </div>

        <div class="kg-sidebar">
          {/* Legend */}
          <div class="kg-legend">
            <LegendItem label={t('mlearn.KanjiGrid.Legend.Learning')} color="#E65100" secondaryColor="#FFEB3B" showArrow />
            <LegendItem label={t('mlearn.KanjiGrid.Legend.Known')} color="#2E7D32" secondaryColor="#81C784" showArrow />
            <LegendItem label={t('mlearn.KanjiGrid.Legend.Unknown')} color="#616161" />
          </div>

          {/* Stats */}
          <div class="kg-stats">
            <div>· {t('mlearn.KanjiGrid.Stats.Known')} <b>{stats().known}</b> <span style={"color:var(--text-secondary)"}>({stats().total ? Math.round(stats().known / stats().total * 1000) / 10 : 0}%)</span></div>
            <div>· {t('mlearn.KanjiGrid.Stats.Learning')} <b>{stats().learning}</b> <span style={"color:var(--text-secondary)"}>({stats().total ? Math.round(stats().learning / stats().total * 1000) / 10 : 0}%)</span></div>
            <div>· {t('mlearn.KanjiGrid.Stats.Unknown')} <b>{stats().unknown}</b> <span style={"color:var(--text-secondary)"}>({stats().total ? Math.round(stats().unknown / stats().total * 1000) / 10 : 0}%)</span></div>
            <div>· {t('mlearn.KanjiGrid.Stats.TotalFound')} <b>{stats().total}</b></div>
          </div>

          {/* Level Pills - dynamically loaded from language data */}
          <Show when={sortedLevelKeys().length > 0}>
            <div class="kg-levels">
              <p>{t('mlearn.KanjiGrid.CharactersByExamLevel')}</p>
              <div class="level-pills">
                <For each={sortedLevelKeys()}>
                  {(level) => {
                    const count = () => levelKanji()[level]?.size || 0;
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
                        {levelNames()[level] || t('mlearn.KanjiGrid.LevelFallback', { level })}
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
      <Show when={hoveredKanji()}>
        <div class="kg-tooltip">
          <div class="tooltip-title">
            {t('mlearn.KanjiGrid.Tooltip.WordsContaining', { char: hoveredKanji()!.kanji })}
            <span class="tooltip-meta">
              {hoveredKanji()!.category} ({t('mlearn.KanjiGrid.Tooltip.Score')} {Math.round(hoveredKanji()!.score * 10) / 10},
              {t('mlearn.KanjiGrid.Tooltip.KnownCount')}: {hoveredKanji()!.knownCount}, {t('mlearn.KanjiGrid.Tooltip.LearningCount')}: {hoveredKanji()!.learnCount})
            </span>
          </div>
          <div class="tooltip-words">
            <For each={hoveredKanji()!.wordsKnown.slice(0, 10)}>
              {(word) => <PillLabel variant="green" size="sm">{word}</PillLabel>}
            </For>
            <For each={hoveredKanji()!.wordsLearning.slice(0, 10)}>
              {(word) => <PillLabel variant="orange" size="sm">{word}</PillLabel>}
            </For>
            <For each={hoveredKanji()!.wordsUnknown.slice(0, 10)}>
              {(word) => <PillLabel variant="gray" size="sm">{word}</PillLabel>}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

// Main App with providers
export const KanjiGridApp: Component = () => {
  return (
    <WindowWrapper>
      <KanjiGridContent />
    </WindowWrapper>
  );
};

export default KanjiGridApp;
