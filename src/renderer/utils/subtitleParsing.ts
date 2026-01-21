/**
 * Subtitle Parsing Utilities
 * Handles Japanese furigana extraction, character name storage, and subtitle processing
 */

// ============================================================================
// Constants
// ============================================================================

// Japanese full-width parentheses
const JP_OPEN_PAREN = '（';
const JP_CLOSE_PAREN = '）';
// Normal ASCII parentheses
const ASCII_OPEN_PAREN = '(';
const ASCII_CLOSE_PAREN = ')';

// Storage key for character names
const CHARACTER_NAMES_KEY = 'mlearn_character_names';

// Kanji detection regex
const KANJI_REGEX = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const KANA_REGEX = /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff]+$/;

// ============================================================================
// Types
// ============================================================================

export interface CharacterName {
  /** Full name in kanji (e.g., "百夜優一郎") */
  name: string;
  /** Full reading in kana (e.g., "ひゃくやゆういちろう") */
  reading: string;
  /** First name in kanji (e.g., "優一郎") if split was possible */
  firstName?: string;
  /** First name reading (e.g., "ゆういちろう") */
  firstNameReading?: string;
  /** Last name in kanji (e.g., "百夜") */
  lastName?: string;
  /** Last name reading (e.g., "ひゃくや") */
  lastNameReading?: string;
  /** Timestamp when this name was saved */
  savedAt: number;
}

export interface ParsedSubtitle {
  /** The subtitle text with speaker name removed (if setting enabled) */
  text: string;
  /** Speaker name if detected (e.g., "百夜優一郎") */
  speaker?: string;
  /** Speaker reading if detected (e.g., "ひゃくやゆういちろう") */
  speakerReading?: string;
  /** Whether furigana was extracted from the speaker name */
  hasFurigana: boolean;
}

export interface FuriganaSegment {
  /** The kanji/base text */
  text: string;
  /** The reading (furigana) if available */
  reading?: string;
}

// ============================================================================
// Character Name Storage
// ============================================================================

/**
 * Load all stored character names from localStorage
 */
export function loadCharacterNames(): Map<string, CharacterName> {
  try {
    const stored = localStorage.getItem(CHARACTER_NAMES_KEY);
    if (!stored) return new Map();
    
    const parsed = JSON.parse(stored);
    const map = new Map<string, CharacterName>();
    
    for (const entry of parsed) {
      if (entry.name) {
        map.set(entry.name, entry);
        // Also store partial names for lookup
        if (entry.firstName) map.set(entry.firstName, entry);
        if (entry.lastName) map.set(entry.lastName, entry);
      }
    }
    
    return map;
  } catch (e) {
    console.error('Failed to load character names:', e);
    return new Map();
  }
}

/**
 * Save character names to localStorage
 */
function saveCharacterNames(names: Map<string, CharacterName>): void {
  try {
    // Deduplicate by full name
    const uniqueNames = new Map<string, CharacterName>();
    for (const entry of names.values()) {
      if (entry.name && !uniqueNames.has(entry.name)) {
        uniqueNames.set(entry.name, entry);
      }
    }
    
    localStorage.setItem(CHARACTER_NAMES_KEY, JSON.stringify(Array.from(uniqueNames.values())));
  } catch (e) {
    console.error('Failed to save character names:', e);
  }
}

// In-memory cache
let characterNamesCache: Map<string, CharacterName> | null = null;

/**
 * Get the character names cache, loading from storage if needed
 */
function getCharacterNamesCache(): Map<string, CharacterName> {
  if (!characterNamesCache) {
    characterNamesCache = loadCharacterNames();
  }
  return characterNamesCache;
}

/**
 * Store a character name with its reading
 * Automatically attempts to split into first/last names
 */
export function storeCharacterName(name: string, reading: string): void {
  if (!name || !reading) return;
  
  const cache = getCharacterNamesCache();
  
  // Try to split the name into first and last names
  const split = splitJapaneseName(name, reading);
  
  const entry: CharacterName = {
    name,
    reading,
    firstName: split.firstName,
    firstNameReading: split.firstNameReading,
    lastName: split.lastName,
    lastNameReading: split.lastNameReading,
    savedAt: Date.now(),
  };
  
  // Store by full name
  cache.set(name, entry);
  
  // Also store by partial names for quick lookup
  if (split.firstName) cache.set(split.firstName, entry);
  if (split.lastName) cache.set(split.lastName, entry);
  
  // Persist to storage
  saveCharacterNames(cache);
  
  console.log(`%cStored character name: ${name} (${reading})`, 'color: cyan;');
}

/**
 * Look up a character name to get its reading
 * Handles partial matches (first name only, last name only)
 */
export function lookupCharacterName(name: string): CharacterName | undefined {
  if (!name) return undefined;
  return getCharacterNamesCache().get(name);
}

/**
 * Get reading for a character name (full or partial)
 */
export function getCharacterReading(name: string): string | undefined {
  const entry = lookupCharacterName(name);
  if (!entry) return undefined;
  
  // If exact match to full name, return full reading
  if (entry.name === name) return entry.reading;
  
  // If match to first name, return first name reading
  if (entry.firstName === name) return entry.firstNameReading;
  
  // If match to last name, return last name reading
  if (entry.lastName === name) return entry.lastNameReading;
  
  // Otherwise return what we have
  return entry.reading;
}

// ============================================================================
// Japanese Name Splitting
// ============================================================================

/**
 * Attempt to split a Japanese name into first and last name
 * This is heuristic-based since Japanese names don't have spaces
 * 
 * Common patterns:
 * - 2 kanji last name + 3 kanji first name (e.g., 百夜優一郎)
 * - 2 kanji last name + 2 kanji first name (e.g., 百夜ミカエラ -> but this has katakana)
 * - etc.
 */
function splitJapaneseName(name: string, reading: string): {
  firstName?: string;
  firstNameReading?: string;
  lastName?: string;
  lastNameReading?: string;
} {
  if (!name || !reading) return {};
  
  // Heuristics for common Japanese name patterns
  // Most family names are 1-3 characters, most given names are 2-4 characters
  
  const nameChars = Array.from(name);
  const readingChars = Array.from(reading);
  
  if (nameChars.length < 3 || readingChars.length < 3) {
    // Name too short to split reliably
    return {};
  }
  
  // Try common split positions (2-char last name is most common)
  const splitPositions = [2, 3, 1];
  
  for (const splitPos of splitPositions) {
    if (splitPos >= nameChars.length) continue;
    
    const lastName = nameChars.slice(0, splitPos).join('');
    const firstName = nameChars.slice(splitPos).join('');
    
    // Try to split reading proportionally
    // This is rough - we assume reading length roughly correlates with kanji count
    // For more accuracy, we'd need a dictionary
    const readingSplitPos = Math.round((splitPos / nameChars.length) * readingChars.length);
    const lastNameReading = readingChars.slice(0, readingSplitPos).join('');
    const firstNameReading = readingChars.slice(readingSplitPos).join('');
    
    // Validate that both parts have content
    if (lastName && firstName && lastNameReading && firstNameReading) {
      return {
        firstName,
        firstNameReading,
        lastName,
        lastNameReading,
      };
    }
  }
  
  return {};
}

// ============================================================================
// Subtitle Parsing
// ============================================================================

/**
 * Parse a subtitle line to extract speaker name and furigana
 * 
 * Handles formats like:
 * - （百夜優一郎(ひゃくやゆういちろう)）あっ
 * - （優一郎）あっ
 * - 「百夜優一郎(ひゃくやゆういちろう)」あっ
 */
export function parseSubtitle(text: string, language: string, options: {
  removeParentheses?: boolean;
  removeSpeakerNames?: boolean;
} = {}): ParsedSubtitle {
  const { removeParentheses = false, removeSpeakerNames = false } = options;
  
  // Determine which parentheses to use based on language
  const isJapanese = language === 'ja';
  const openParen = isJapanese ? JP_OPEN_PAREN : ASCII_OPEN_PAREN;
  const closeParen = isJapanese ? JP_CLOSE_PAREN : ASCII_CLOSE_PAREN;
  
  let result: ParsedSubtitle = {
    text,
    hasFurigana: false,
  };
  
  // Try to extract speaker name from the beginning of the subtitle
  // Pattern: （名前）text or （名前(よみかた)）text
  const speakerMatch = text.match(new RegExp(
    `^${escapeRegex(openParen)}([^${escapeRegex(closeParen)}]+)${escapeRegex(closeParen)}(.*)$`
  ));
  
  if (speakerMatch) {
    const speakerPart = speakerMatch[1];
    const textPart = speakerMatch[2];
    
    // Check if speaker part contains furigana: 名前(よみかた)
    const furiganaMatch = speakerPart.match(/^([^(（]+)\(([^)）]+)\)$/);
    
    if (furiganaMatch) {
      const speakerName = furiganaMatch[1];
      const speakerReading = furiganaMatch[2];
      
      result.speaker = speakerName;
      result.speakerReading = speakerReading;
      result.hasFurigana = true;
      
      // Store the character name for future reference
      storeCharacterName(speakerName, speakerReading);
    } else {
      // No furigana in the speaker name, try to look up from stored names
      result.speaker = speakerPart;
      const storedReading = getCharacterReading(speakerPart);
      if (storedReading) {
        result.speakerReading = storedReading;
        result.hasFurigana = true;
      }
    }
    
    // Apply removal settings
    if (removeSpeakerNames || removeParentheses) {
      result.text = textPart.trim();
    }
  } else if (removeParentheses) {
    // Remove all parenthesized content
    const parenRegex = new RegExp(
      `${escapeRegex(openParen)}[^${escapeRegex(closeParen)}]*${escapeRegex(closeParen)}`,
      'g'
    );
    result.text = text.replace(parenRegex, '').trim();
  }
  
  return result;
}

/**
 * Extract furigana annotations from text
 * Handles patterns like: 百夜(ひゃくや)優一郎(ゆういちろう)
 * 
 * @returns Array of segments with text and optional reading
 */
export function extractFurigana(text: string): FuriganaSegment[] {
  if (!text) return [];
  
  const segments: FuriganaSegment[] = [];
  
  // Pattern: kanji(reading) or text without parentheses
  // Match: kanji followed by (reading) OR any other text
  const regex = /([^(（]+)\(([^)）]+)\)|([^(（]+)/g;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1] && match[2]) {
      // Kanji with furigana
      segments.push({
        text: match[1],
        reading: match[2],
      });
    } else if (match[3]) {
      // Text without furigana
      segments.push({
        text: match[3],
      });
    }
  }
  
  return segments;
}

/**
 * Build furigana ruby HTML from segments
 */
export function buildFuriganaHtml(segments: FuriganaSegment[]): string {
  return segments.map(segment => {
    if (segment.reading) {
      return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
    }
    return segment.text;
  }).join('');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if text contains kanji
 */
export function containsKanji(text: string): boolean {
  return KANJI_REGEX.test(text);
}

/**
 * Check if text is all kana (hiragana or katakana)
 */
export function isAllKana(text: string): boolean {
  return KANA_REGEX.test(text);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize reading by removing HTML and accent markers
 */
export function normalizeReading(raw: string): string {
  if (typeof raw !== 'string') return '';
  let text = raw;
  const markerIdx = text.indexOf('<!-- accent_start -->');
  if (markerIdx !== -1) text = text.substring(0, markerIdx);
  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/\u00a0/g, ' ').trim();
  return text.replace(/\s+/g, '');
}

/**
 * Extract only the kana reading from a translation entry
 * This is for the LiveWordTranslator which should show only kana, not kanji with ruby
 */
export function extractKanaReading(reading: string | undefined): string {
  if (!reading) return '';
  
  // Remove HTML tags and normalize
  let normalized = normalizeReading(reading);
  
  // If the reading is already all kana, return it
  if (isAllKana(normalized)) return normalized;
  
  // If it contains kanji, we need to extract the kana from ruby markup or return as-is
  // Try to extract from ruby: <ruby>漢字<rt>かんじ</rt></ruby>
  const rtMatch = reading.match(/<rt>([^<]+)<\/rt>/);
  if (rtMatch) return rtMatch[1];
  
  return normalized;
}
