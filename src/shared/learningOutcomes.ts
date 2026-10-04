import type { LanguageData } from './types';
import { buildWordFrequencyMapFromLanguageData, resolveLanguageFrequencyPayload } from './languageFeatures';

/** Core selects assets; packages own all category names, identifiers and success semantics. */
export interface LearningOutcomeSelector {
  source: string;
  provider?: string;
  levels?: number[];
  patterns?: string[];
  categories?: string[];
  words?: string[];
  [key: string]: unknown;
}

export interface LearningOutcomeDeclaration {
  label: string;
  provenance: 'package' | 'community' | 'authoritative';
  reference?: string;
  groups: Array<{ id: string; label?: string; selectors: LearningOutcomeSelector[]; [key: string]: unknown }>;
  /** Externally defined requirements retain their own schema/scale, never converted to practice percentages. */
  requirements?: Record<string, unknown>;
  assessment?: { reference: string; conditions: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ResolvedLearningOutcome {
  id: string;
  declaration: LearningOutcomeDeclaration;
  words: string[];
  patterns: string[];
  groups: Array<{ id: string; label?: string; words: string[]; patterns: string[] }>;
  complete: boolean;
  unavailable: string[];
}

/** Uses only loaded assets; unavailable providers/extensions must never fall back to a convenient list. */
export function resolveLearningOutcome(data: LanguageData | null | undefined, id: string): ResolvedLearningOutcome | null {
  const declaration = data?.learning?.outcomes?.[id];
  if (!declaration || typeof declaration.label !== 'string' || !declaration.label.trim() || !Array.isArray(declaration.groups)) return null;
  const groups = new Map<string, ResolvedLearningOutcome['groups'][number]>();
  const unavailable: string[] = [];
  for (const group of declaration.groups) {
    if (!group || typeof group.id !== 'string' || !group.id.trim() || !Array.isArray(group.selectors)) {
      unavailable.push('malformed-group'); continue;
    }
    const result = groups.get(group.id) ?? { id: group.id, ...(group.label ? { label: group.label } : {}), words: [], patterns: [] };
    for (const selector of group.selectors) {
      if (!selector || typeof selector.source !== 'string'
        || (selector.levels !== undefined && (!Array.isArray(selector.levels) || !selector.levels.every(level => typeof level === 'number' && Number.isFinite(level))))
        || ['patterns', 'categories', 'words'].some(key => selector[key] !== undefined
          && (!Array.isArray(selector[key]) || !(selector[key] as unknown[]).every(value => typeof value === 'string')))) {
        unavailable.push(`${group.id}:malformed-selector`); continue;
      }
      if (selector.source === 'frequency') {
        if (selector.provider && !Array.isArray(data?.frequencyProviders?.[selector.provider]?.freq)) {
          unavailable.push(`${group.id}:frequency:${selector.provider}`); continue;
        }
        const payload = resolveLanguageFrequencyPayload(data, selector.provider);
        if (!payload.rows.length) { unavailable.push(`${group.id}:frequency`); continue; }
        const frequency = buildWordFrequencyMapFromLanguageData(payload.languageData);
        result.words.push(...Object.entries(frequency).filter(([word, entry]) =>
          (!selector.levels || selector.levels.includes(entry.raw_level)) && (!selector.words || selector.words.includes(word))).map(([word]) => word));
      } else if (selector.source === 'grammar') {
        if (!data?.grammar?.length) { unavailable.push(`${group.id}:grammar`); continue; }
        result.patterns.push(...data.grammar.filter(point => (!selector.levels || selector.levels.includes(point.level))
          && (!selector.patterns || selector.patterns.includes(point.pattern))
          && (!selector.categories || (point.category !== undefined && selector.categories.includes(point.category)))).map(point => point.pattern));
      } else {
        // Unknown-but-valid selectors survive storage; UI cannot claim it can run them.
        unavailable.push(`${group.id}:${selector.source}`);
      }
    }
    result.words = [...new Set(result.words)]; result.patterns = [...new Set(result.patterns)];
    groups.set(group.id, result);
  }
  const resolved = [...groups.values()];
  return { id, declaration, groups: resolved, words: [...new Set(resolved.flatMap(group => group.words))],
    patterns: [...new Set(resolved.flatMap(group => group.patterns))], complete: unavailable.length === 0, unavailable };
}

export function learningOutcomeOptions(data: LanguageData | null | undefined): ResolvedLearningOutcome[] {
  return Object.keys(data?.learning?.outcomes ?? {}).flatMap(id => {
    const resolved = resolveLearningOutcome(data, id);
    return resolved?.complete && (resolved.words.length || resolved.patterns.length) ? [resolved] : [];
  });
}
