import { grammarEntityId } from '../graph/load';
import { grammarTokenSequenceMatchStarts, getTokenJoinSeparator } from '../languageFeatures';
import type { GrammarPoint, LanguageData, Token } from '../types';

export const GRAMMAR_OCCURRENCE_CONFIDENCE = {
  morphological: 0.95,
  literal: 0.65,
  minimum: 0.6,
} as const;

export interface GrammarOccurrenceTokenEvidence {
  tokenIndex: number;
  matcher?: 'morphological' | 'literal';
  fields?: readonly string[];
}

/** Ephemeral sentence analysis. It is intentionally not a knowledge event or learner state. */
export interface GrammarOccurrence {
  patternId: string;
  targetRef: { kind: 'grammar-pattern'; id: string; capability: 'grammar-recognition' };
  sentenceSpan: { start: number; end: number };
  tokenEvidence: readonly GrammarOccurrenceTokenEvidence[];
  realizedForm: string;
  attachment?: string;
  confidence: number;
  provenance: 'morphological' | 'literal';
}

export interface GrammarOccurrenceDetector {
  detect(point: GrammarPoint, tokens: readonly Token[], language: string, data?: LanguageData | null): readonly GrammarOccurrence[];
}

function target(language: string, pattern: string): GrammarOccurrence['targetRef'] {
  return { kind: 'grammar-pattern', id: grammarEntityId(language, pattern), capability: 'grammar-recognition' };
}

function occurrence(
  point: GrammarPoint,
  language: string,
  tokens: readonly Token[],
  start: number,
  end: number,
  provenance: GrammarOccurrence['provenance'],
  fields?: readonly string[],
): GrammarOccurrence {
  return {
    patternId: point.pattern,
    targetRef: target(language, point.pattern),
    sentenceSpan: { start, end },
    tokenEvidence: tokens.slice(start, end).map((_, index) => ({ tokenIndex: start + index, matcher: provenance, fields })),
    realizedForm: tokens.slice(start, end).map((token) => token.surface ?? token.word).join(''),
    confidence: GRAMMAR_OCCURRENCE_CONFIDENCE[provenance],
    provenance,
  };
}

function literalSpan(text: string, tokens: readonly Token[], data?: LanguageData | null): { start: number; end: number } | null {
  const separator = getTokenJoinSeparator(data);
  const rendered = tokens.map((token) => token.surface ?? token.word);
  const fullText = rendered.join(separator);
  const offset = fullText.indexOf(text);
  if (offset < 0) return null;
  const endOffset = offset + text.length;
  let cursor = 0;
  let start = -1;
  let end = -1;
  for (let index = 0; index < rendered.length; index += 1) {
    const next = cursor + rendered[index].length;
    if (start < 0 && next > offset) start = index;
    if (next >= endOffset) { end = index + 1; break; }
    cursor = next + separator.length;
  }
  return start >= 0 && end > start ? { start, end } : null;
}

/** Default metadata-driven detector; language packages supply match rules and tokenizer capabilities. */
export const metadataGrammarOccurrenceDetector: GrammarOccurrenceDetector = {
  detect(point, tokens, language, data) {
    if (tokens.length === 0) return [];
    const matches = Array.isArray(point.match) ? point.match : point.match ? [point.match] : [];
    const occurrences: GrammarOccurrence[] = [];
    for (const match of matches) {
      if ((match.type ?? 'text') === 'token-sequence') {
        const length = match.tokens?.length ?? 0;
        const fields = match.tokens?.flatMap((matcher) => [matcher.field ?? 'word', ...(matcher.canonicalPartOfSpeech ? ['canonicalPartOfSpeech'] : []), ...(matcher.features ? ['features'] : [])]);
        for (const start of grammarTokenSequenceMatchStarts(tokens, match, data)) {
          occurrences.push(occurrence(point, language, tokens, start, start + length, 'morphological', fields));
        }
      } else {
        const span = literalSpan(match.text ?? point.pattern, tokens, data);
        if (span) occurrences.push(occurrence(point, language, tokens, span.start, span.end, 'literal'));
      }
    }
    if (matches.length === 0) {
      const span = literalSpan(point.pattern, tokens, data);
      if (span) occurrences.push(occurrence(point, language, tokens, span.start, span.end, 'literal'));
    }
    return occurrences.filter((item) => item.confidence >= GRAMMAR_OCCURRENCE_CONFIDENCE.minimum);
  },
};

export function detectGrammarOccurrences(params: {
  language: string;
  grammar: readonly GrammarPoint[];
  tokens: readonly Token[];
  languageData?: LanguageData | null;
  detectors?: readonly GrammarOccurrenceDetector[];
}): GrammarOccurrence[] {
  const detectors = params.detectors?.length ? params.detectors : [metadataGrammarOccurrenceDetector];
  const seen = new Set<string>();
  return params.grammar.flatMap((point) => detectors.flatMap((detector) => detector.detect(point, params.tokens, params.language, params.languageData)))
    .filter((item) => {
      const key = `${item.patternId}:${item.sentenceSpan.start}:${item.sentenceSpan.end}:${item.provenance}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
