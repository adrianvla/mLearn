import type { KnowledgeAspect, WordKnowledgeSource, WordStatus } from '../constants';
import { ASPECT_CAPABILITY, type CapabilityKind } from './types';
import type { PassiveWordKnowledge } from '../types';

/**
 * Learner-overlay access semantics.
 *
 * The canonical linguistic graph describes the LANGUAGE. The learner overlay
 * records which directed ACCESS PATHS work for this learner: a cue
 * (written form, spoken form, meaning, …) and what its successful retrieval
 * yields. Every CapabilityKind IS one such directed access — there is no
 * separate flat aspect vector underneath. Legacy `KnowledgeAspect`-keyed
 * evidence (journal events and materialized records written before this
 * model) maps onto accesses losslessly via CAPABILITY_ASPECT; new evidence is
 * addressed by capability directly (journal `targetRef.capability`,
 * materialized `access[capability]` records).
 *
 * The cue/retrieval decomposition is what lets the TeachingPolicy recognize
 * "almost everything needed is already present; only this bridge is missing":
 * a missing surface-recognition access for a word whose sense access and
 * spoken access are strong is a cheap bridge, not a novel lexical object.
 */

/** What the learner is cued with when the access is exercised. */
export type AccessCue =
  | 'written-form'   // the exact presented surface
  | 'spoken-form'    // the pronounced/heard form (TTS, media, recall)
  | 'lexical-item'   // the word itself (production/property retrieval)
  | 'character'      // a single graphemic component
  | 'morpheme'       // a meaningful sub-word unit
  | 'construction';  // a grammar pattern

/** What a successful retrieval of the access yields. */
export type AccessRetrieval =
  | 'lexical-identity'      // the word (lexeme) itself
  | 'meaning'               // a sense of the word
  | 'pronunciation'         // how it sounds
  | 'prosody'               // its accent/stress/tone pattern
  | 'gender'                // its lexical gender value
  | 'character-identity'    // a character as a familiar graphemic unit
  | 'character-reading'     // a character's reading
  | 'morpheme-meaning'      // a morpheme's meaning
  | 'grammar-recognition' | 'grammar-comprehension' | 'grammar-formation' | 'grammar-production';

export interface AccessPath {
  cue: AccessCue;
  retrieval: AccessRetrieval;
}

/**
 * Each capability is one directed learner access over the canonical graph.
 * `surface-recognition` is deliberately narrow: seeing the written surface
 * retrieves the lexical identity — nothing else. Surface familiarity is
 * exposure (timesSeen), surface→pronunciation is `surface-reading`, and
 * compositional decoding is SUPPORT-side (prediction), never a capability.
 */
export const CAPABILITY_ACCESS: Record<CapabilityKind, AccessPath> = {
  'sense-recognition': { cue: 'lexical-item', retrieval: 'meaning' },
  'surface-recognition': { cue: 'written-form', retrieval: 'lexical-identity' },
  'spoken-recognition': { cue: 'spoken-form', retrieval: 'lexical-identity' },
  'surface-reading': { cue: 'written-form', retrieval: 'pronunciation' },
  'pronunciation-production': { cue: 'lexical-item', retrieval: 'pronunciation' },
  'prosodic-pattern': { cue: 'lexical-item', retrieval: 'prosody' },
  'gender': { cue: 'lexical-item', retrieval: 'gender' },
  'character-recognition': { cue: 'character', retrieval: 'character-identity' },
  'character-reading': { cue: 'character', retrieval: 'character-reading' },
  'morpheme-recognition': { cue: 'morpheme', retrieval: 'morpheme-meaning' },
  'grammar-recognition': { cue: 'construction', retrieval: 'grammar-recognition' },
  'grammar-comprehension': { cue: 'construction', retrieval: 'grammar-comprehension' },
  'grammar-formation': { cue: 'construction', retrieval: 'grammar-formation' },
  'grammar-production': { cue: 'construction', retrieval: 'grammar-production' },
};

/**
 * Capabilities whose access constitutes the lexical object itself. The
 * word-level Unknown/Learning/Known summary projects the strongest of these —
 * a word known by sound and meaning with a missing written-form bridge is NOT
 * a wholly unknown word.
 */
export const LEXICAL_IDENTITY_CAPABILITIES: readonly CapabilityKind[] = [
  'sense-recognition',
  'surface-recognition',
  'spoken-recognition',
];

/**
 * Lossless legacy projection: aspect → capability for every pre-access
 * aspect. (The forward map lives in ASPECT_CAPABILITY.) Distinct aspects map
 * to distinct capabilities, so the inverse is total over KNOWLEDGE_ASPECTS.
 * New evidence for capabilities without a legacy aspect (spoken-recognition,
 * character-reading, morpheme-recognition) has NO aspect value — the journal
 * `targetRef.capability` is then the only address.
 */
export const CAPABILITY_ASPECT: Partial<Record<CapabilityKind, KnowledgeAspect>> = (() => {
  const inverse: Partial<Record<CapabilityKind, KnowledgeAspect>> = {};
  for (const aspect of ['meaning', 'reading', 'prosody', 'gender', 'pronunciation', 'orthography'] as const) {
    const capability = ASPECT_CAPABILITY[aspect];
    inverse[capability] = aspect;
  }
  return inverse;
})();

/**
 * Task-mediated traversal decomposition: measuring `capability` while cued by
 * `cue` proves the returned accesses were traversed (attribution-time
 * evidence only — never stored-state implication). Replaces the universal
 * meaning←reading←prosody prerequisite chain: what a task demonstrates
 * follows from the ACCESS PATH structure, not from a fixed linguistic
 * hierarchy. A written-form reading measurement proves the surface was
 * recognized, not that the meaning was traversed (a learner can read a word
 * they cannot translate); a written-cued sense measurement proves the
 * written-form bridge worked.
 */
const DEMONSTRATES_BY_CUE: Partial<Record<AccessCue, Partial<Record<CapabilityKind, readonly CapabilityKind[]>>>> = {
  'written-form': {
    'sense-recognition': ['surface-recognition'],
    'surface-reading': ['surface-recognition'],
    'prosodic-pattern': ['surface-recognition', 'surface-reading'],
    'pronunciation-production': ['surface-recognition', 'surface-reading'],
    'gender': ['surface-recognition'],
    'morpheme-recognition': ['surface-recognition'],
  },
  'spoken-form': {
    'sense-recognition': ['spoken-recognition'],
  },
};

export function demonstratesOf(capability: CapabilityKind, cue: AccessCue = 'written-form'): readonly CapabilityKind[] {
  return DEMONSTRATES_BY_CUE[cue]?.[capability] ?? [];
}

/**
 * Locale keys for capability display names — the single source for every
 * rating/inspector row. Keys are the capability IDS (mlearn.Knowledge.Capability.
 * <id>), matching the graph-projection surfaces; the four grammar accesses
 * share one label.
 */
export const CAPABILITY_LABEL_KEYS: Record<string, string> = (() => {
  const keys: Record<string, string> = {};
  for (const id of Object.keys(CAPABILITY_ACCESS) as CapabilityKind[]) {
    keys[id] = `mlearn.Knowledge.Capability.${id.startsWith('grammar-') ? 'grammar-recognition' : id}`;
  }
  return keys;
})();

/** Mnemonic chord letters per capability (quality number + letter, e.g. 1+M). */
export const CAPABILITY_MNEMONIC_KEYS: Record<CapabilityKind, string> = {
  'sense-recognition': 'm',
  'surface-recognition': 'w',
  'spoken-recognition': 'h',
  'surface-reading': 'r',
  'pronunciation-production': 'v',
  'prosodic-pattern': 'p',
  'gender': 'g',
  'character-recognition': 'k',
  'character-reading': 'c',
  'morpheme-recognition': 'z',
  'grammar-recognition': 'a',
  'grammar-comprehension': 'b',
  'grammar-formation': 'd',
  'grammar-production': 'q',
};

const CORE_CAPABILITY_IDS: Record<string, true> = {};
for (const id of Object.keys(CAPABILITY_ACCESS)) CORE_CAPABILITY_IDS[id] = true;

/**
 * Whether `value` is a well-formed capability id: a core CapabilityKind or a
 * namespaced package extension (`ns::local`). Package-declared capabilities
 * travel through journal targetRefs without core needing to know their
 * semantics; they match only exact-capability consumers.
 */
export function isValidCapabilityId(value: unknown): value is CapabilityKind | (string & {}) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (CORE_CAPABILITY_IDS[value]) return true;
  const separator = value.indexOf('::');
  return separator > 0 && separator < value.length - 2
    && /^[a-z][a-z0-9-]*$/.test(value.slice(0, separator))
    && /^[a-z][a-z0-9-]*$/i.test(value.slice(separator + 2));
}

interface LegacyAspectRecord {
  status: WordStatus;
  ease: number;
  source: WordKnowledgeSource;
  lastStatusChange: number;
  updatedAt: number;
  claim?: WordStatus;
  claimAt?: number;
}

/**
 * Load/merge-time overlay migration: legacy aspect-keyed records move to
 * capability keys (CAPABILITY_ASPECT). Unknown keys are preserved as-is —
 * unknown-but-valid data must survive round trips. Returns the entry
 * untouched when there is nothing to migrate.
 */
export function migrateAspectRecordsToAccess(entry: PassiveWordKnowledge): PassiveWordKnowledge {
  const carrier = entry as PassiveWordKnowledge & { aspects?: Partial<Record<string, LegacyAspectRecord>> };
  const legacy = carrier.aspects;
  if (!legacy) return entry;
  const { aspects: _legacy, ...rest } = carrier;
  const access: NonNullable<PassiveWordKnowledge['access']> = { ...(rest.access ?? {}) };
  for (const [aspect, record] of Object.entries(legacy)) {
    const capability = aspect === 'meaning' ? undefined : ASPECT_CAPABILITY[aspect as keyof typeof ASPECT_CAPABILITY] ?? aspect;
    if (capability !== undefined && !access[capability]) {
      access[capability] = record;
    }
  }
  return Object.keys(access).length > 0 ? { ...rest, access } : rest;
}
