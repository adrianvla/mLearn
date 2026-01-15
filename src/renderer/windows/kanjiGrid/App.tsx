/**
 * Kanji Grid Window
 * Displays a visual grid of kanji with learning status colors
 * Ported from showKnownKanjiGrid in stats.js
 */

import { Component, createSignal, For, Show, onMount, createMemo } from 'solid-js';
import { WindowWrapper, useSettings } from '../../context';
import {
  getWordsLearnedInApp,
} from '../../services/statsService';
import { WORD_STATUS } from '../../../shared/constants';
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

const KanjiGridContent: Component = () => {
  const { settings } = useSettings();
  
  const [kanjiData, setKanjiData] = createSignal<KanjiData[]>([]);
  const [hoveredKanji, setHoveredKanji] = createSignal<KanjiData | null>(null);
  const [hoveredLevel, setHoveredLevel] = createSignal<number | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [levelKanji, setLevelKanji] = createSignal<Record<number, Set<string>>>({});

  // Level names
  const levelNames: Record<number, string> = {
    5: 'N1',
    4: 'N2',
    3: 'N3',
    2: 'N4',
    1: 'N5',
  };

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

      // Check if we have real tracked words, otherwise use sample data
      const wordsToProcess = trackedWordsArray.length > 0 
        ? trackedWordsArray
        : [
            // Sample words for demo
            '日本', '言語', '学習', '漢字', '勉強', '読書', '映画', '音楽',
            '食事', '旅行', '仕事', '生活', '電話', '時間', '天気', '友達',
            '先生', '学生', '会社', '病院', '駅', '空港', '公園', '図書館',
          ].map(word => ({ word, status: Math.floor(Math.random() * 3) }));

      // Process words
      for (const { word, status } of wordsToProcess) {
        const chars = Array.from(word) as string[];
        const uniqueKanji = new Set(chars.filter(ch => isKanjiChar(ch)));

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
            });
          }

          const item = kanjiMap.get(k)!;
          
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
    return settings.dark_mode ? '#616161' : '#9E9E9E';
  };

  onMount(() => {
    buildKanjiStats();
  });

  return (
    <div class="kanji-grid-window">
      <div class="kg-header">
        <h1>Character Knowledge Overview</h1>
        <p class="kg-subtitle">
          Colors: learning (orange→yellow), known (green→light-green); unknown (gray).
          Hover a level to highlight expected characters.
        </p>
      </div>

      <div class="kg-main">
        <div class="kg-grid">
          <Show when={!isLoading()}>
            <For each={kanjiData()}>
              {(item) => (
                <div
                  class={`kg-cell ${hoveredLevel() !== null && !levelKanji()[hoveredLevel()!]?.has(item.kanji) ? 'dimmed' : ''}`}
                  style={{
                    background: getColorForKanji(item),
                    color: item.category !== 'unknown' ? '#111' : (settings.dark_mode ? '#ddd' : '#222'),
                  }}
                  onMouseEnter={() => setHoveredKanji(item)}
                  onMouseLeave={() => setHoveredKanji(null)}
                >
                  <span class="kanji-char">{item.kanji}</span>
                </div>
              )}
            </For>
          </Show>
          
          <Show when={isLoading()}>
            <div class="loading">Loading kanji data...</div>
          </Show>
        </div>

        <div class="kg-sidebar">
          {/* Legend */}
          <div class="kg-legend">
            <div class="legend-item">
              <span class="label">learning:</span>
              <span class="box" style={{ background: '#E65100' }} />
              <span class="arrow">→</span>
              <span class="box" style={{ background: '#FFEB3B' }} />
            </div>
            <div class="legend-item">
              <span class="label">known:</span>
              <span class="box" style={{ background: '#2E7D32' }} />
              <span class="arrow">→</span>
              <span class="box" style={{ background: '#81C784' }} />
            </div>
            <div class="legend-item">
              <span class="label">unknown:</span>
              <span class="box" style={{ background: '#616161' }} />
            </div>
          </div>

          {/* Stats */}
          <div class="kg-stats">
            <div>· Known: <b>{stats().known}</b> ({stats().total ? Math.round(stats().known / stats().total * 1000) / 10 : 0}%)</div>
            <div>· Learning: <b>{stats().learning}</b> ({stats().total ? Math.round(stats().learning / stats().total * 1000) / 10 : 0}%)</div>
            <div>· Unknown: <b>{stats().unknown}</b> ({stats().total ? Math.round(stats().unknown / stats().total * 1000) / 10 : 0}%)</div>
            <div>· Total Found: <b>{stats().total}</b></div>
          </div>

          {/* Level Pills */}
          <div class="kg-levels">
            <p>Kanji contained in words per levels:</p>
            <div class="level-pills">
              <For each={Object.entries(levelNames)}>
                {([level, name]) => (
                  <button
                    class="pill"
                    data-level={level}
                    onMouseEnter={() => setHoveredLevel(parseInt(level))}
                    onMouseLeave={() => setHoveredLevel(null)}
                  >
                    {name}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      <Show when={hoveredKanji()}>
        <div class="kg-tooltip">
          <div class="tooltip-title">
            Words containing {hoveredKanji()!.kanji}
            <span class="tooltip-meta">
              {hoveredKanji()!.category} (score {Math.round(hoveredKanji()!.score * 10) / 10},
              known: {hoveredKanji()!.knownCount}, learning: {hoveredKanji()!.learnCount})
            </span>
          </div>
          <div class="tooltip-words">
            <For each={hoveredKanji()!.wordsKnown.slice(0, 10)}>
              {(word) => <span class="word-pill known">{word}</span>}
            </For>
            <For each={hoveredKanji()!.wordsLearning.slice(0, 10)}>
              {(word) => <span class="word-pill learning">{word}</span>}
            </For>
            <For each={hoveredKanji()!.wordsUnknown.slice(0, 10)}>
              {(word) => <span class="word-pill unknown">{word}</span>}
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
