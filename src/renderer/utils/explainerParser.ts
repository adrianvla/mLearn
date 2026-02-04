/**
 * Explainer Parser Utility
 * Parses LLM responses for the word explainer feature
 * Extracts structured sections from various LLM response formats
 */

export type ExplainerSectionType = 'translation' | 'explanation' | 'grammar';

export interface GrammarPoint {
  /** The grammar item (e.g., 「申し立て」) */
  term: string;
  /** The explanation of the grammar point */
  description: string;
}

export interface ExplainerSection {
  type: ExplainerSectionType;
  /** Optional title for the section */
  title?: string;
  /** The word being explained (for 'explanation' type) */
  word?: string;
  /** Plain text content for translation/explanation sections */
  content?: string;
  /** Grammar points array (for 'grammar' type) */
  grammarPoints?: GrammarPoint[];
}

export interface ParsedExplainer {
  sections: ExplainerSection[];
  /** Raw text if parsing failed */
  rawText?: string;
}

/**
 * Remove the echoed prompt from the LLM response
 * The LLM often echoes back the entire prompt including "Task:", "Sentence:", etc.
 */
function stripEchoedPrompt(text: string): string {
  if (!text) return '';
  
  let cleaned = text;
  
  // Pattern 1: Remove everything up to and including "Sentence:\n{japanese text}\n"
  // This catches cases where the LLM echoed the entire prompt
  const sentenceMatch = cleaned.match(/Sentence:\s*\n[^\n]+\n+/i);
  if (sentenceMatch) {
    const idx = cleaned.indexOf(sentenceMatch[0]) + sentenceMatch[0].length;
    cleaned = cleaned.slice(idx);
  }
  
  // Pattern 2: Remove the "You are a X-only language assistant..." preamble
  const assistantMatch = cleaned.match(/^You are a[^.]+language assistant[^]*?(?=\n\n|\nHere|\nTask|\n1\.)/i);
  if (assistantMatch) {
    cleaned = cleaned.slice(assistantMatch[0].length);
  }
  
  // Pattern 3: Remove "Task:" block if present at the start
  const taskMatch = cleaned.match(/^Task:\s*\n(?:\d+\.[^\n]+\n)+/i);
  if (taskMatch) {
    cleaned = cleaned.slice(taskMatch[0].length);
  }
  
  return cleaned.trim();
}

/**
 * Extract the English translation from the response
 */
function extractTranslation(text: string): string | null {
  // Pattern 1: "The English translation of the sentence is:\n\n{translation}"
  const engTransMatch = text.match(/The English translation[^:]*is:\s*\n\n[""]?([^""]+?)[""]?(?=\n\n|$)/i);
  if (engTransMatch) {
    return engTransMatch[1].trim().replace(/^[""]|[""]$/g, '');
  }
  
  // Pattern 2: "Here is the translation..." followed by blank line then quoted translation
  const hereIsQuotedMatch = text.match(/Here is the translation[^:]*:\s*\n\n[""]([^""]+)[""]/i);
  if (hereIsQuotedMatch) {
    return hereIsQuotedMatch[1].trim();
  }
  
  // Pattern 3: "Here is the translation..." followed by blank line then the translation
  const hereIsMatch = text.match(/Here is the translation[^:]*:\s*\n\n([^\n]+(?:\n(?!Now|Explanation|Grammar|And here|\n\n)[^\n]+)*)/i);
  if (hereIsMatch) {
    let translation = hereIsMatch[1].trim();
    // Remove quotes if present
    translation = translation.replace(/^[""]|[""]$/g, '').trim();
    return translation;
  }
  
  // Pattern 4: "Here is the translation..." followed directly by text on next line
  const hereIsMatch2 = text.match(/Here is the translation[^:]*:\s*\n([^\n]+)/i);
  if (hereIsMatch2) {
    let translation = hereIsMatch2[1].trim();
    translation = translation.replace(/^[""]|[""]$/g, '').trim();
    // Make sure it's not just whitespace or Japanese
    if (translation && !/^[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+$/.test(translation)) {
      return translation;
    }
  }
  
  // Pattern 5: "Translation:\n{translation}" or "1. Translation: {translation}"
  const translationMatch = text.match(/(?:^|\n)\d*\.?\s*Translation[:\s]+\n?([^\n]+(?:\n(?!Explanation|Grammar|\d+\.)[^\n]+)*)/i);
  if (translationMatch) {
    let translation = translationMatch[1].trim();
    translation = translation.replace(/^[""]|[""]$/g, '').trim();
    return translation;
  }
  
  // Pattern 6: "Translated into English:\n{translation}"
  const translatedMatch = text.match(/Translated into English[:\s]+\n?[""]?([^""]+)[""]?/i);
  if (translatedMatch) {
    return translatedMatch[1].trim();
  }
  
  return null;
}

/**
 * Extract the word explanation from the response
 */
function extractExplanation(text: string, _targetWord?: string): { word: string; content: string } | null {
  // Pattern 1: "Explanation of the word 「word」:\n{explanation}" - remove "the word" prefix
  const explanationMatch = text.match(/Explanation of (?:the word\s*)?[「『]([^」』]+)[」』]:\s*\n?([^\n]+(?:\n(?!Grammar|Main grammar|And here|\d+\.\s*[「『]|\*\s*[「『])[^\n]+)*)/i);
  if (explanationMatch) {
    return {
      word: explanationMatch[1].trim(),
      content: explanationMatch[2].trim(),
    };
  }
  
  // Pattern 2: "Now, let's analyze the word 「word」" or "let's analyze the word 「word」 in this context:"
  const analyzeMatch = text.match(/(?:Now,?\s*)?let'?s analyze (?:the word\s*)?[「『]([^」』]+)[」』][^:]*:\s*\n\n?([^\n]+(?:\n(?!Grammar|Main grammar|And here|\d+\.\s*[「『]|\*\s*[「『])[^\n]+)*)/i);
  if (analyzeMatch) {
    return {
      word: analyzeMatch[1].trim(),
      content: analyzeMatch[2].trim(),
    };
  }
  
  // Pattern 3: "Explanation of word:\n{explanation}" (without brackets)
  const explanationMatch2 = text.match(/Explanation of ([^:]+):\s*\n?([^\n]+(?:\n(?!Grammar|Main grammar|And here|\d+\.\s*[「『]|\*\s*[「『])[^\n]+)*)/i);
  if (explanationMatch2) {
    let word = explanationMatch2[1].trim();
    // Clean up "the word" prefix if present
    word = word.replace(/^the word\s*/i, '').trim();
    // Remove brackets if present
    word = word.replace(/^[「『]|[」』]$/g, '').trim();
    return {
      word: word,
      content: explanationMatch2[2].trim(),
    };
  }
  
  // Pattern 4: "「word」 means/refers to..." at the start of a paragraph
  const wordMeansMatch = text.match(/(?:^|\n\n)[「『]([^」』]+)[」』]\s*(?:\([^)]*\)\s*)?(?:means|refers to|is\s)[^\n]+/i);
  if (wordMeansMatch) {
    // Get the full paragraph containing this
    const startIdx = text.indexOf(wordMeansMatch[0]);
    const adjustedStart = wordMeansMatch[0].startsWith('\n\n') ? startIdx + 2 : startIdx;
    const endIdx = text.indexOf('\n\n', adjustedStart + 1);
    const content = endIdx > adjustedStart 
      ? text.slice(adjustedStart, endIdx).trim()
      : wordMeansMatch[0].trim();
    return {
      word: wordMeansMatch[1].trim(),
      content: content,
    };
  }
  
  return null;
}

/**
 * Extract grammar points from the response
 * Handles both bullet points (-, *, •) and numbered lists (1., 2., etc.)
 */
function extractGrammarPoints(text: string): GrammarPoint[] {
  const points: GrammarPoint[] = [];
  
  // Find the grammar section - handle various formats:
  // "Grammar points:", "Main grammar points:", "And here are the main grammar points:"
  const grammarSectionMatch = text.match(/(?:And here are the\s+)?(?:Main\s+)?Grammar\s*points?:\s*\n+([\s\S]+?)(?=\n\n[A-Z]|\n\n$|$)/i);
  const grammarText = grammarSectionMatch ? grammarSectionMatch[1] : '';
  
  if (!grammarText) return points;
  
  // Split into lines and process each item
  const lines = grammarText.split('\n');
  
  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;
    
    // Pattern 1: "1. 「term」 (reading) - "description"" or "1. 「term」 (reading) - description"
    const numberedWithDash = line.match(/^\s*\d+\.\s*[「『]([^」』]+)[」』]\s*(?:\([^)]*\)\s*)?[-–—]\s*[""]?(.+?)[""]?$/);
    if (numberedWithDash) {
      const term = numberedWithDash[1].trim();
      let description = numberedWithDash[2].trim();
      description = description.replace(/^[""]|[""]$/g, '').trim();
      if (term && description) {
        points.push({ term, description });
      }
      continue;
    }
    
    // Pattern 2: "1. 「term」(reading) description" or "1. 「term」 description"
    const numberedMatch = line.match(/^\s*\d+\.\s*[「『]([^」』]+)[」』]\s*(?:\([^)]*\)\s*)?(.+)/);
    if (numberedMatch) {
      const term = numberedMatch[1].trim();
      let description = numberedMatch[2].trim();
      description = description.replace(/^[-–—]\s*/, '').replace(/^[""]|[""]$/g, '').trim();
      if (term && description) {
        points.push({ term, description });
      }
      continue;
    }
    
    // Pattern 3: "* 「term」 is/means/are description" (no colon, description follows directly)
    const bulletDescMatch = line.match(/^\s*[-•*]\s*[「『]([^」』]+)[」』]\s*(?:\([^)]*\)\s*)?(.+)/);
    if (bulletDescMatch) {
      const term = bulletDescMatch[1].trim();
      let description = bulletDescMatch[2].trim();
      description = description.replace(/^[""]|[""]$/g, '').trim();
      if (term && description) {
        points.push({ term, description });
      }
      continue;
    }
    
    // Pattern 4: "- 「term」: description" or "- term: description" (with colon separator)
    const bulletColonMatch = line.match(/^\s*[-•*]\s*[「『]?([^」』:：]+)[」』]?\s*[：:]\s*(.+)/);
    if (bulletColonMatch) {
      const term = bulletColonMatch[1].trim().replace(/^\*\*|\*\*$/g, '');
      let description = bulletColonMatch[2].trim();
      description = description.replace(/^[""]|[""]$/g, '').trim();
      if (term || description) {
        points.push({ term, description });
      }
      continue;
    }
    
    // Pattern 5: "- **term**: description" (markdown bold)
    const markdownMatch = line.match(/^\s*[-•*]\s*\*\*([^*]+)\*\*[：:]\s*(.+)/);
    if (markdownMatch) {
      const term = markdownMatch[1].trim();
      let description = markdownMatch[2].trim();
      description = description.replace(/^[""]|[""]$/g, '').trim();
      if (term && description) {
        points.push({ term, description });
      }
    }
  }
  
  // Deduplicate
  const seen = new Set<string>();
  return points.filter(p => {
    const key = `${p.term}::${p.description.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Check if a line/section should be skipped
 */
function shouldSkip(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower.includes('blank line') ||
    lower.includes('(blank)') ||
    /^\d*\.?\s*stop\.?$/i.test(lower) ||
    lower === ''
  );
}

/**
 * Main parser function - parses LLM response into structured sections
 */
export function parseExplainerResponse(text: string, targetWord?: string): ParsedExplainer {
  if (!text || typeof text !== 'string') {
    return { sections: [], rawText: text || '' };
  }
  
  const sections: ExplainerSection[] = [];
  
  // Step 1: Strip the echoed prompt
  let cleaned = stripEchoedPrompt(text);
  
  // Step 2: Remove STOP instructions and blank line markers
  cleaned = cleaned.replace(/^\d*\.?\s*STOP\.?\s*$/gim, '');
  cleaned = cleaned.replace(/\(Blank line\)/gi, '');
  cleaned = cleaned.replace(/Add a blank line\.?/gi, '');
  
  // Step 3: Extract translation
  const translation = extractTranslation(cleaned);
  if (translation && !shouldSkip(translation)) {
    sections.push({
      type: 'translation',
      title: 'Translation',
      content: translation,
    });
  }
  
  // Step 4: Extract word explanation
  const explanation = extractExplanation(cleaned, targetWord);
  if (explanation && !shouldSkip(explanation.content)) {
    sections.push({
      type: 'explanation',
      title: `Explanation of ${explanation.word} usage`,
      word: explanation.word,
      content: explanation.content,
    });
  }
  
  // Step 5: Extract grammar points
  const grammarPoints = extractGrammarPoints(cleaned);
  if (grammarPoints.length > 0) {
    sections.push({
      type: 'grammar',
      title: 'Main Grammar Points',
      grammarPoints: grammarPoints,
    });
  }
  
  // If parsing failed to extract any sections, return raw text
  if (sections.length === 0) {
    return { sections: [], rawText: cleaned };
  }
  
  return { sections };
}

/**
 * Filter and clean grammar points
 * Removes duplicates and empty points
 */
export function cleanGrammarPoints(points: GrammarPoint[]): GrammarPoint[] {
  const seen = new Set<string>();
  return points.filter(p => {
    const key = `${p.term}::${p.description}`;
    if (seen.has(key) || (!p.term && !p.description)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
