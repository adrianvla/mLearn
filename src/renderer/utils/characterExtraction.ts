/**
 * Character Extraction Utility
 * Extracts character names from subtitle text to provide context to the AI agent.
 * Recognizes common subtitle patterns:
 *   - "(CharacterName) dialogue"
 *   - "CharacterName: dialogue"
 *   - "【CharacterName】dialogue"
 *   - "「CharacterName」dialogue" (less common, usually quotes)
 */

import type { LanguageData } from '../../shared/types';
import { languageSupportsCharacterNamePrefixes } from '../../shared/languageFeatures';
import { getResolvedScriptProfile, hasLettersInAnyScript, hasLettersInScript, normalizeScriptCodes } from '../../shared/languageScriptProfile';

/** Extracted character with line count */
interface ExtractedCharacter {
  name: string;
  lineCount: number;
}

export interface CharacterExtractionOptions {
  languageData?: LanguageData | null;
}

interface CharacterExtractionConfig {
  enabled: boolean;
  usesLanguageData: boolean;
  maxCodePoints: number;
  minLineCount: number;
  delimiters: string[];
  bracketPairs: Array<[string, string]>;
  scripts: string[];
  allowLatinFallback: boolean;
}

const LEGACY_BRACKET_PAIRS: Array<[string, string]> = [
  ['(', ')'],
  ['（', '）'],
  ['【', '】'],
];

function escapeRegexChar(char: string): string {
  return char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function getCharacterExtractionConfig(data?: LanguageData | null): CharacterExtractionConfig {
  const config = data?.textProcessing?.subtitle?.characterNamePrefix;
  if (!data) {
    return {
      enabled: false,
      usesLanguageData: false,
      maxCodePoints: 30,
      minLineCount: 2,
      delimiters: [':', '：'],
      bracketPairs: [],
      scripts: [],
      allowLatinFallback: false,
    };
  }
  if (data && !languageSupportsCharacterNamePrefixes(data)) {
    return {
      enabled: false,
      usesLanguageData: true,
      maxCodePoints: 30,
      minLineCount: 2,
      delimiters: [':', '：'],
      bracketPairs: LEGACY_BRACKET_PAIRS,
      scripts: [],
      allowLatinFallback: false,
    };
  }

  const configuredScripts = normalizeScriptCodes(config?.scripts);
  return {
    enabled: config?.enabled !== false,
    usesLanguageData: Boolean(data),
    maxCodePoints: config?.maxCodePoints ?? 30,
    minLineCount: config?.minLineCount ?? 2,
    delimiters: config?.delimiters?.length ? config.delimiters : [':', '：'],
    bracketPairs: config?.bracketPairs?.length ? config.bracketPairs : LEGACY_BRACKET_PAIRS,
    scripts: configuredScripts.length > 0
      ? configuredScripts
      : (data ? getResolvedScriptProfile('', data).acceptedScripts : []),
    allowLatinFallback: config?.allowLatinFallback === true,
  };
}

function isCharacterNameCandidate(name: string, config: CharacterExtractionConfig): boolean {
  const trimmed = name.trim();
  if (!trimmed || !/\p{L}/u.test(trimmed)) return false;
  if (Array.from(trimmed).length > config.maxCodePoints) return false;
  if (!/^[\p{L}\p{M}\p{N}\s.'’_\-・·ー]+$/u.test(trimmed)) return false;
  if (trimmed.split(/\s+/).filter(Boolean).length > 4) return false;

  if (config.scripts.length === 0) return true;
  if (hasLettersInAnyScript(trimmed, config.scripts)) return true;
  return config.allowLatinFallback && hasLettersInScript(trimmed, 'Latn');
}

function extractCharacterNameFromLine(line: string, config: CharacterExtractionConfig): string | null {
  if (!config.enabled) return null;

  for (const [open, close] of config.bracketPairs) {
    const pattern = new RegExp(`^\\s*${escapeRegexChar(open)}([^${escapeRegexChar(close)}]{1,${config.maxCodePoints}})${escapeRegexChar(close)}\\s*`, 'u');
    const match = line.match(pattern);
    if (match && isCharacterNameCandidate(match[1], config)) {
      return match[1].trim();
    }
  }

  for (const delimiter of config.delimiters) {
    const maxCodePoints = config.usesLanguageData ? config.maxCodePoints : Math.min(config.maxCodePoints, 20);
    const pattern = new RegExp(`^\\s*([^${escapeRegexChar(delimiter)}]{1,${maxCodePoints}})${escapeRegexChar(delimiter)}\\s*`, 'u');
    const match = line.match(pattern);
    if (match && isCharacterNameCandidate(match[1], config)) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract unique character names from an array of subtitle lines.
 * Returns characters sorted by frequency (most lines first).
 */
export function extractCharacters(subtitleLines: string[], options: CharacterExtractionOptions = {}): ExtractedCharacter[] {
  const config = getCharacterExtractionConfig(options.languageData);
  if (!config.enabled) return [];

  const counts = new Map<string, number>();

  for (const line of subtitleLines) {
    const name = extractCharacterNameFromLine(line, config);
    if (name) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, lineCount]) => ({ name, lineCount }))
    .filter((c) => c.lineCount >= config.minLineCount)
    .sort((a, b) => b.lineCount - a.lineCount);
}

/**
 * Build a character context string for the AI system prompt.
 * Returns null if no characters were detected.
 */
export function buildCharacterContext(subtitleLines: string[], options: CharacterExtractionOptions = {}): string | null {
  const characters = extractCharacters(subtitleLines, options);
  if (characters.length === 0) return null;

  const lines = characters
    .slice(0, 15) // Cap at 15 characters to avoid prompt bloat
    .map((c) => `- ${c.name} (${c.lineCount} lines)`);

  return `Characters detected in the media:\n${lines.join('\n')}`;
}
