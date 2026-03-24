/**
 * Character Extraction Utility
 * Extracts character names from subtitle text to provide context to the AI agent.
 * Recognizes common subtitle patterns:
 *   - "(CharacterName) dialogue"
 *   - "CharacterName: dialogue"
 *   - "【CharacterName】dialogue"
 *   - "「CharacterName」dialogue" (less common, usually quotes)
 */

/** Extracted character with line count */
interface ExtractedCharacter {
  name: string;
  lineCount: number;
}

// Patterns for character identification in subtitles
const PATTERNS = [
  // (Name) at start of line
  /^\s*\(([^)]{1,30})\)\s*/,
  // （Name）full-width parentheses
  /^\s*（([^）]{1,30})）\s*/,
  // 【Name】lenticular brackets
  /^\s*【([^】]{1,30})】\s*/,
  // Name: at start of line (ASCII colon)
  /^\s*([A-Za-z\u3040-\u9FFF\uAC00-\uD7AF]{1,20}):\s+/,
  // Name： full-width colon
  /^\s*([A-Za-z\u3040-\u9FFF\uAC00-\uD7AF]{1,20})：\s*/,
];

/**
 * Extract unique character names from an array of subtitle lines.
 * Returns characters sorted by frequency (most lines first).
 */
export function extractCharacters(subtitleLines: string[]): ExtractedCharacter[] {
  const counts = new Map<string, number>();

  for (const line of subtitleLines) {
    for (const pattern of PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const name = match[1].trim();
        if (name.length > 0) {
          counts.set(name, (counts.get(name) || 0) + 1);
        }
        break; // Only match the first pattern per line
      }
    }
  }

  return Array.from(counts.entries())
    .map(([name, lineCount]) => ({ name, lineCount }))
    .filter((c) => c.lineCount >= 2) // Only include characters with 2+ lines
    .sort((a, b) => b.lineCount - a.lineCount);
}

/**
 * Build a character context string for the AI system prompt.
 * Returns null if no characters were detected.
 */
export function buildCharacterContext(subtitleLines: string[]): string | null {
  const characters = extractCharacters(subtitleLines);
  if (characters.length === 0) return null;

  const lines = characters
    .slice(0, 15) // Cap at 15 characters to avoid prompt bloat
    .map((c) => `- ${c.name} (${c.lineCount} lines)`);

  return `Characters detected in the media:\n${lines.join('\n')}`;
}
