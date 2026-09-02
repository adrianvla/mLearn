import { grammarEntityId } from '../graph/load';
import type { GraphEntity } from '../graph/types';
import { getGrammarLevelLabel } from '../languageFeatures';
import type { GrammarMatchConfig, GrammarPoint, LanguageData } from '../types';

/**
 * First-class Tier-2 construction identity.
 *
 * Grammar targets are capability-scoped (recognition / comprehension /
 * formation / production); a construction is the shared linguistic identity
 * those targets point at — the entity behind `GrammarOccurrence.targetRef` and
 * `grammarTarget()`. Every field is populated from language-package data
 * (`LanguageData.grammar` / graph entity `grammar` metadata). Whatever the
 * package does not supply is left undefined — this layer never fabricates
 * linguistic facts.
 */
export interface GrammarConstruction {
  /** Persistent identity, equal to `grammarEntityId(language, pattern)`. */
  id: string;
  /** Canonical pattern text — the entity label, and the key into package lists. */
  pattern: string;
  /** Semantic family, e.g. "conditional", "aspect", "politeness". */
  category?: string;
  /** Meaning/explanation of the construction. */
  meaning?: string;
  /** Pragmatic function or use when it is richer than `meaning`. */
  function?: string;
  /** How the construction is formed (morphology, word order, particles). */
  formation?: string;
  /** Elements the construction attaches to or combines with, e.g. ["te-form"]. */
  attachments?: string[];
  /** Usage constraints, e.g. "not with imperative", "formal register only". */
  constraints?: string[];
  /** Recognized surface variants (spelling/contraction families). */
  variants?: string[];
  /** Social/functional register, e.g. "plain", "polite", "formal". */
  register?: string;
  /** Package-declared difficulty of the construction. */
  difficulty?: {
    /** Numeric level on the language's grammar scale (same scale as GrammarPoint.level). */
    level: number;
    /** Human-readable level name (e.g. "N4") when the package names it; never synthesized. */
    levelLabel?: string;
  };
  /** Constructions this one is commonly confused with (graph `contrasts-with`). */
  contrasts?: string[];
  /** Related constructions (graph `semantically-related`/`morphologically-related`). */
  related?: string[];
  /** Package match rules used for occurrence recognition (GrammarPoint.match). */
  recognitionRules?: GrammarMatchConfig | GrammarMatchConfig[];
}

/** String-valued construction fields forwarded from language-package grammar points. */
export const GRAMMAR_CONSTRUCTION_TEXT_FIELDS = [
  'category',
  'function',
  'formation',
  'register',
] as const;

/** String-array-valued construction fields forwarded from language-package grammar points. */
export const GRAMMAR_CONSTRUCTION_LIST_FIELDS = [
  'attachments',
  'constraints',
  'variants',
  'contrasts',
  'related',
] as const;

function packageLevelLabel(level: number, data?: LanguageData | null): string | undefined {
  const named = data?.grammarLevels?.names?.[String(level)];
  if (named) return named;
  return undefined;
}

/** Builds the construction record for a package grammar point, degrading honestly on missing fields. */
export function grammarConstructionFromPoint(
  language: string,
  point: GrammarPoint,
  languageData?: LanguageData | null,
): GrammarConstruction {
  return {
    id: grammarEntityId(language, point.pattern),
    pattern: point.pattern,
    ...(point.category !== undefined ? { category: point.category } : {}),
    ...(point.meaning !== undefined ? { meaning: point.meaning } : {}),
    ...(point.function !== undefined ? { function: point.function } : {}),
    ...(point.formation !== undefined ? { formation: point.formation } : {}),
    ...(point.attachments !== undefined ? { attachments: point.attachments } : {}),
    ...(point.constraints !== undefined ? { constraints: point.constraints } : {}),
    ...(point.variants !== undefined ? { variants: point.variants } : {}),
    ...(point.register !== undefined ? { register: point.register } : {}),
    difficulty: {
      level: point.level,
      ...(packageLevelLabel(point.level, languageData) !== undefined
        ? { levelLabel: getGrammarLevelLabel(point.level, languageData?.grammarLevels?.names, languageData) }
        : {}),
    },
    ...(point.contrasts !== undefined ? { contrasts: point.contrasts } : {}),
    ...(point.related !== undefined ? { related: point.related } : {}),
    ...(point.match !== undefined ? { recognitionRules: point.match } : {}),
  };
}

/**
 * Builds the construction record from a graph entity. Returns undefined for
 * non-grammar entities. `entity.grammar` carries what the graph builder
 * forward-copied from the language package; missing fields stay undefined.
 */
export function grammarConstructionFromEntity(
  entity: GraphEntity,
  languageData?: LanguageData | null,
): GrammarConstruction | undefined {
  if (entity.kind !== 'grammar-pattern' || !entity.grammar) return undefined;
  const meta = entity.grammar;
  return {
    id: entity.id,
    pattern: entity.label ?? '',
    ...(meta.category !== undefined ? { category: meta.category } : {}),
    ...(meta.meaning !== undefined ? { meaning: meta.meaning } : {}),
    ...(meta.function !== undefined ? { function: meta.function } : {}),
    ...(meta.formation !== undefined ? { formation: meta.formation } : {}),
    ...(meta.attachments !== undefined ? { attachments: meta.attachments } : {}),
    ...(meta.constraints !== undefined ? { constraints: meta.constraints } : {}),
    ...(meta.variants !== undefined ? { variants: meta.variants } : {}),
    ...(meta.register !== undefined ? { register: meta.register } : {}),
    difficulty: {
      level: meta.level,
      ...(packageLevelLabel(meta.level, languageData) !== undefined
        ? { levelLabel: getGrammarLevelLabel(meta.level, languageData?.grammarLevels?.names, languageData) }
        : {}),
    },
    ...(meta.contrasts !== undefined ? { contrasts: meta.contrasts } : {}),
    ...(meta.related !== undefined ? { related: meta.related } : {}),
    ...(meta.recognitionRules !== undefined ? { recognitionRules: meta.recognitionRules } : {}),
  };
}

/** Indexes package grammar points by pattern text, mirroring the LanguageContext grammar map. */
export function indexGrammarConstructions(
  language: string,
  points: readonly GrammarPoint[],
  languageData?: LanguageData | null,
): ReadonlyMap<string, GrammarConstruction> {
  const index = new Map<string, GrammarConstruction>();
  for (const point of points) {
    index.set(point.pattern, grammarConstructionFromPoint(language, point, languageData));
  }
  return index;
}