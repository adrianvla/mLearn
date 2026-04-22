/**
 * Subtitle Hook
 * Manages subtitle parsing, timing, and display
 */

import { createSignal, createMemo } from 'solid-js';
import type { Subtitle, Token } from '../../shared/types';
import { useSettings } from '../context';
import { useTokenizer } from './useTranslation';
import { parseSubtitle } from '../utils/subtitleParsing';

// Parse SRT format subtitles
function parseSRT(content: string): Subtitle[] {
  const subtitles: Subtitle[] = [];
  const blocks = content.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const timeLine = lines[1];
    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );

    if (!timeMatch) continue;

    const start = 
      parseInt(timeMatch[1]) * 3600 +
      parseInt(timeMatch[2]) * 60 +
      parseInt(timeMatch[3]) +
      parseInt(timeMatch[4]) / 1000;

    const end = 
      parseInt(timeMatch[5]) * 3600 +
      parseInt(timeMatch[6]) * 60 +
      parseInt(timeMatch[7]) +
      parseInt(timeMatch[8]) / 1000;

    const text = lines.slice(2).join('\n').replace(/<[^>]*>/g, '');

    subtitles.push({ start, end, text });
  }

  return subtitles;
}

// Parse VTT format subtitles
function parseVTT(content: string): Subtitle[] {
  const subtitles: Subtitle[] = [];
  const lines = content.split('\n');
  let i = 0;

  // Skip header
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const timeLine = lines[i];
    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/
    );

    if (!timeMatch) {
      // Try shorter format HH:MM.mmm
      const shortMatch = timeLine.match(
        /(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2})[.,](\d{3})/
      );
      
      if (shortMatch) {
        const start = 
          parseInt(shortMatch[1]) * 60 +
          parseInt(shortMatch[2]) +
          parseInt(shortMatch[3]) / 1000;
        const end = 
          parseInt(shortMatch[4]) * 60 +
          parseInt(shortMatch[5]) +
          parseInt(shortMatch[6]) / 1000;

        i++;
        const textLines: string[] = [];
        while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
          textLines.push(lines[i].replace(/<[^>]*>/g, ''));
          i++;
        }
        
        if (textLines.length > 0) {
          subtitles.push({ start, end, text: textLines.join('\n') });
        }
        continue;
      }
      
      i++;
      continue;
    }

    const start = 
      parseInt(timeMatch[1]) * 3600 +
      parseInt(timeMatch[2]) * 60 +
      parseInt(timeMatch[3]) +
      parseInt(timeMatch[4]) / 1000;

    const end = 
      parseInt(timeMatch[5]) * 3600 +
      parseInt(timeMatch[6]) * 60 +
      parseInt(timeMatch[7]) +
      parseInt(timeMatch[8]) / 1000;

    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
      textLines.push(lines[i].replace(/<[^>]*>/g, ''));
      i++;
    }

    if (textLines.length > 0) {
      subtitles.push({ start, end, text: textLines.join('\n') });
    }
  }

  return subtitles;
}

// Parse ASS/SSA format subtitles
function parseASS(content: string): Subtitle[] {
  const subtitles: Subtitle[] = [];
  const lines = content.split('\n');
  
  let inEvents = false;
  let formatFields: string[] = [];

  for (const line of lines) {
    if (line.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }
    
    if (line.startsWith('[') && inEvents) {
      break;
    }

    if (inEvents) {
      if (line.startsWith('Format:')) {
        formatFields = line.substring(7).split(',').map(f => f.trim().toLowerCase());
        continue;
      }

      if (line.startsWith('Dialogue:')) {
        const parts = line.substring(9).split(',');
        const startIdx = formatFields.indexOf('start');
        const endIdx = formatFields.indexOf('end');
        const textIdx = formatFields.indexOf('text');

        if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

        const parseTime = (timeStr: string): number => {
          const match = timeStr.trim().match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
          if (!match) return 0;
          return (
            parseInt(match[1]) * 3600 +
            parseInt(match[2]) * 60 +
            parseInt(match[3]) +
            parseInt(match[4]) / 100
          );
        };

        const start = parseTime(parts[startIdx]);
        const end = parseTime(parts[endIdx]);
        
        // Text is everything after the last known field (can contain commas)
        let text = parts.slice(textIdx).join(',');
        // Remove ASS formatting tags
        text = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n');

        subtitles.push({ start, end, text: text.trim() });
      }
    }
  }

  return subtitles;
}

export function useSubtitles() {
  const { settings } = useSettings();
  const { tokenize } = useTokenizer({ language: settings.language });

  const [subtitles, setSubtitles] = createSignal<Subtitle[]>([]);
  const [currentIndex, setCurrentIndex] = createSignal(-1);
  const [tokens, setTokens] = createSignal<Token[]>([]);
  const [isTokenizing, setIsTokenizing] = createSignal(false);

  // Load subtitles from text content
  const loadSubtitles = (content: string, format?: 'srt' | 'vtt' | 'ass') => {
    let parsed: Subtitle[];

    // Auto-detect format if not specified
    if (!format) {
      if (content.includes('WEBVTT')) {
        format = 'vtt';
      } else if (content.includes('[Script Info]') || content.includes('[V4+ Styles]')) {
        format = 'ass';
      } else {
        format = 'srt';
      }
    }

    switch (format) {
      case 'vtt':
        parsed = parseVTT(content);
        break;
      case 'ass':
        parsed = parseASS(content);
        break;
      default:
        parsed = parseSRT(content);
    }

    setSubtitles(parsed);
    setCurrentIndex(-1);
    setTokens([]);
  };

  // Load subtitles from file
  const loadSubtitleFile = async (file: File) => {
    const content = await file.text();
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    let format: 'srt' | 'vtt' | 'ass' | undefined;
    if (ext === 'vtt') format = 'vtt';
    else if (ext === 'ass' || ext === 'ssa') format = 'ass';
    else if (ext === 'srt') format = 'srt';

    loadSubtitles(content, format);
  };

  // Get current subtitle for a given time
  const getCurrentSubtitle = (time: number): { sub: Subtitle; idx: number } | null => {
    const adjustedTime = time + settings.subsOffsetTime;
    const subs = subtitles();
    if (subs.length === 0) return null;

    // Binary search: find the last subtitle where start <= adjustedTime
    let lo = 0;
    let hi = subs.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (subs[mid].start <= adjustedTime) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (found === -1) return null;
    if (adjustedTime > subs[found].end) return null;
    return { sub: subs[found], idx: found };
  };

  const updateTime = async (time: number) => {
    const result = getCurrentSubtitle(time);
    
    if (!result) {
      setCurrentIndex(-1);
      setTokens([]);
      return;
    }

    const { sub, idx } = result;
    if (idx === currentIndex()) return;

    setCurrentIndex(idx);
    setIsTokenizing(true);

    const buildFallbackTokens = (text: string): Token[] => {
      const trimmed = text.trim();
      if (!trimmed) return [];
      return trimmed
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ({
          word,
          actual_word: word,
          type: '',
          surface: word,
        }));
    };

    try {
      let rawText = sub.text;

      // Remove speaker name prefixes (e.g. "Speaker:" or "JOHN:")
      if (settings.removeSpeakerNames) {
        rawText = rawText.replace(/^[A-Za-z\u00C0-\u024F\s]+:\s*/gm, '');
      }

      // Remove all parenthesized content (must happen before parseSubtitle which handles furigana parens)
      if (settings.removeParentheses) {
        rawText = rawText.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').trim();
      }

      const { text: cleanedText, readingOverrides } = parseSubtitle(rawText, settings.language);
      
      const newTokens = await tokenize(cleanedText);
      if (Array.isArray(newTokens) && newTokens.length > 0) {
        if (readingOverrides.length > 0) {
          for (const token of newTokens) {
            const override = readingOverrides.find(o => 
              o.word === token.word || 
              o.word === token.surface || 
              o.word === token.actual_word
            );
            if (override) {
              token.reading = override.reading;
            }
          }
        }
        setTokens(newTokens);
      } else {
        setTokens(buildFallbackTokens(cleanedText));
      }
    } catch (e) {
      console.error('Tokenization failed:', e);
      setTokens(buildFallbackTokens(sub.text));
    } finally {
      setIsTokenizing(false);
    }
  };

  // Get current subtitle
  const currentSubtitle = createMemo(() => {
    const idx = currentIndex();
    if (idx === -1) return null;
    return subtitles()[idx] || null;
  });

  // Clear subtitles
  const clearSubtitles = () => {
    setSubtitles([]);
    setCurrentIndex(-1);
    setTokens([]);
  };

  return {
    subtitles,
    currentSubtitle,
    currentIndex,
    tokens,
    isTokenizing,
    loadSubtitles,
    loadSubtitleFile,
    updateTime,
    clearSubtitles,
    offset: () => settings.subsOffsetTime,
  };
}
