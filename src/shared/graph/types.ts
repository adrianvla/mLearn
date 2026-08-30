import type { KnowledgeAspect } from '../constants';
import type { GrammarMatchConfig } from '../types';

/**
 * Tier-2 linguistic graph: the canonical representation of a language's
 * learnable structure. The graph describes the LANGUAGE — it never contains
 * learner history, predictions, or UI state.
 *
 * Identity semantics (hard invariant):
 * - Only `identity`-category relations define shared linguistic identity.
 * - Dictionary-entry grouping (e.g. JMdict ent_seq) is SOURCE provenance, not
 *   pedagogical identity: sibling surfaces of one entry stay independently
 *   learnable and may at most carry a `support` relation between them.
 * - Shared pronunciation never implies shared identity (橋/箸/端).
 */

export type GraphEntityKind =
  | 'dictionary-entry'
  | 'lexeme'
  | 'surface'
  | 'sense'
  | 'pronunciation'
  | 'character'
  | 'morpheme'
  | 'grammar-pattern';

export type GraphDomain = 'common' | 'names' | 'archaic' | 'technical' | 'dialectal';

/** Specialized domains (names etc.) are excluded from ordinary learning/prediction unless explicitly enabled. */
export const DEFAULT_ENABLED_DOMAINS: readonly GraphDomain[] = ['common'];


export interface GraphEntity {
  /** Persistent across graph rebuilds while the underlying identity is stable. Convention: `${language}:${kind}:${localId}`. */
  id: string;
  kind: GraphEntityKind;
  domain?: GraphDomain;
  label?: string;
  /** Existing language-package grammar metadata, present only on grammar patterns. */
  grammar?: {
    meaning: string;
    level: number;
    recognitionRules?: GrammarMatchConfig[];
    /** Semantic family, e.g. "conditional", "aspect". Forwarded from package data. */
    category?: string;
    /** Pragmatic function or use when richer than meaning. Forwarded from package data. */
    function?: string;
    /** How the construction is formed. Forwarded from package data. */
    formation?: string;
    /** Elements the construction attaches to or combines with. Forwarded from package data. */
    attachments?: string[];
    /** Usage constraints. Forwarded from package data. */
    constraints?: string[];
    /** Recognized surface variants. Forwarded from package data. */
    variants?: string[];
    /** Social/functional register, e.g. "plain", "polite". Forwarded from package data. */
    register?: string;
    /** Constructions this one is commonly confused with. Forwarded from package data. */
    contrasts?: string[];
    /** Related constructions. Forwarded from package data. */
    related?: string[];
  };
}

/**
 * A. identity — authoritative only; defines shared linguistic identity.
 * B. property — target-bearing; can generate learnable targets.
 * C. support — structure/transfer hints for prediction; NEVER knowledge identity.
 */
export type RelationCategory = 'identity' | 'property' | 'support';

export type GraphRelationType =
  // identity
  | 'inflection-of'
  | 'lemma-of'
  // property
  | 'realizes'
  | 'has-sense'
  | 'has-pronunciation'
  | 'has-gender'
  | 'has-prosodic-pattern'
  | 'has-character'
  | 'has-reading'
  | 'has-morpheme'
  // support
  | 'orthographic-variant-of'
  | 'component-of'
  | 'derived-from'
  | 'semantically-related'
  | 'morphologically-related'
  | 'contrasts-with';

export const RELATION_CATEGORY: Record<GraphRelationType, RelationCategory> = {
  'inflection-of': 'identity',
  'lemma-of': 'identity',
  'realizes': 'property',
  'has-sense': 'property',
  'has-pronunciation': 'property',
  'has-gender': 'property',
  'has-prosodic-pattern': 'property',
  'has-character': 'property',
  'has-reading': 'property',
  'has-morpheme': 'property',
  'orthographic-variant-of': 'support',
  'component-of': 'support',
  'derived-from': 'support',
  'semantically-related': 'support',
  'morphologically-related': 'support',
  'contrasts-with': 'support',
};

export interface GraphRelation {
  from: string;
  to: string;
  type: GraphRelationType;
  /** 0..1 structural confidence of the relation itself (source quality). */
  confidence?: number;
  /** 0..1 how often knowing the source predicts the target's MEANING (semantic transparency). */
  transparency?: number;
  /** 0..1 how often knowing the source predicts the target's FORM/pronunciation. */
  predictability?: number;
  provenance?: string;
}

export const GRAPH_SCHEMA_VERSION = 1;

export interface LinguisticGraphAsset {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  language: string;
  generatedAt: string;
  sourceVersions: Record<string, string>;
  entities: GraphEntity[];
  relations: GraphRelation[];
}

// ─── Learnable targets ───────────────────────────────────────────────

/**
 * Typed learner capabilities attached to graph entities. These replace
 * `wordHash + aspect` as the epistemic unit; the current user-facing aspects
 * map onto them via ASPECT_CAPABILITY.
 */
export type CapabilityKind =
  | 'sense-recognition'
  | 'surface-recognition'
  | 'surface-reading'
  | 'pronunciation-production'
  | 'prosodic-pattern'
  | 'gender'
  | 'character-reading'
  | 'grammar-recognition'
  | 'grammar-comprehension'
  | 'grammar-formation'
  | 'grammar-production';

export interface LearnableTarget {
  entityId: string;
  capability: CapabilityKind;
}

/** Current word-aspect vocabulary resolved to typed capabilities. */
export const ASPECT_CAPABILITY: Record<KnowledgeAspect, CapabilityKind> = {
  meaning: 'sense-recognition',
  reading: 'surface-reading',
  prosody: 'prosodic-pattern',
  gender: 'gender',
  pronunciation: 'pronunciation-production',
  orthography: 'surface-recognition',
};

/** Capabilities that belong to the exact presented surface — evidence must not fan out across form families. Replaces SURFACE_SCOPED_ASPECTS. */
export const SURFACE_SCOPED_CAPABILITIES: readonly CapabilityKind[] = [
  'surface-recognition',
  'surface-reading',
];
