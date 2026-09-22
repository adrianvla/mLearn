import type { KnowledgeProjection } from './ipc';
import { relationsOf, type LingualGraph } from './load';
import {
  type CapabilityKey,
  type GraphEntity,
  type LearnableTarget,
  SURFACE_SCOPED_CAPABILITIES,
} from './types';
import type { LanguageData } from '../types';

/**
 * Target applicability derives from the graph — never from global language
 * name conditionals. A capability exists for an entity only when the graph
 * actually carries the structure that would be learned.
 */
export function applicableCapabilities(graph: LingualGraph, entity: GraphEntity): CapabilityKey[] {
  const relationTypes = new Set(relationsOf(graph, entity.id).map((relation) => relation.type));
  const coreCapabilities: CapabilityKey[] = (() => {
    switch (entity.kind) {
      case 'surface':
        return dedupe([
          'surface-recognition',
          ...(relationTypes.has('has-pronunciation') ? ['surface-reading' as const, 'pronunciation-production' as const, 'spoken-recognition' as const] : []),
          ...(relationTypes.has('has-prosodic-pattern') ? ['prosodic-pattern' as const] : []),
        ]);
      case 'sense':
        return ['sense-recognition'];
      case 'lexeme':
        return [];
      case 'character':
        return relationTypes.has('has-reading') ? ['character-recognition', 'character-reading'] : ['character-recognition'];
      case 'grammar-pattern':
        return entity.grammar
          ? ['grammar-recognition', 'grammar-comprehension', 'grammar-formation', 'grammar-production']
          : [];
      case 'dictionary-entry':
      case 'pronunciation':
      case 'analysis':
        return [];
      // Morphemes are explanatory structure unless the package/entity opts in.
      case 'morpheme':
        return entity.learnable === true ? ['morpheme-recognition'] : [];
      default:
        // Package-declared capabilities above enable learning for extension entities.
        return [];
    }
  })();
  return dedupe([...coreCapabilities, ...(entity.learnableCapabilities ?? [])]);
}

export function learnableTargetsFor(graph: LingualGraph, entities: readonly GraphEntity[]): LearnableTarget[] {
  const targets: LearnableTarget[] = [];
  for (const entity of entities) {
    for (const capability of applicableCapabilities(graph, entity)) {
      targets.push({ entityId: entity.id, capability });
    }
  }
  return targets;
}

/** Surface-scoped accesses resolve on the presented form's own hash only — family unification must never apply to them. */
export function isSurfaceScopedCapability(capability: CapabilityKey, languageData?: LanguageData | null): boolean {
  return (SURFACE_SCOPED_CAPABILITIES as readonly string[]).includes(capability)
    || languageData?.learning?.capabilities?.[capability]?.scope === 'surface';
}

/**
 * Firewall for identity edges: recognizing 食べた must never establish
 * 食べる's surface-recognition or surface-reading. Identity relations may
 * only unify non-surface-scoped capabilities; every surface-scoped capability
 * stays bound to the exact presented surface.
 * The projection layer MUST consult this before sharing any state across
 * identityNeighbors().
 */
export function isIdentityShareableCapability(capability: CapabilityKey, languageData?: LanguageData | null): boolean {
  return KNOWN_IDENTITY_SHAREABLE_CAPABILITIES.has(capability)
    || languageData?.learning?.capabilities?.[capability]?.shareAcrossIdentity === true
    || languageData?.learning?.capabilities?.[capability]?.scope === 'family';
}

/** Package-declared family accesses use graph identity transfer without adding a core capability id. */
export function isPackageFamilyCapability(capability: CapabilityKey, languageData?: LanguageData | null): boolean {
  const declaration = languageData?.learning?.capabilities?.[capability];
  return declaration?.scope === 'family' || declaration?.shareAcrossIdentity === true;
}

const KNOWN_IDENTITY_SHAREABLE_CAPABILITIES = new Set<CapabilityKey>([
  'sense-recognition',
  'spoken-recognition',
  'pronunciation-production',
  'prosodic-pattern',
  'character-recognition',
  'character-reading',
  'grammar-recognition',
  'grammar-comprehension',
  'grammar-formation',
  'grammar-production',
  'morpheme-recognition',
]);

function dedupe(values: readonly CapabilityKey[]): CapabilityKey[] {
  return [...new Set(values)];
}

/** Probe selection consumes projected classifications, never source-specific knowledge. */
export function unresolvedProjectionTargets(projection: KnowledgeProjection | undefined, testable: readonly string[]): LearnableTarget[] {
  if (projection?.status !== 'ready') return [];
  const allowed = new Set(testable);
  return projection.targets.flatMap(target => target.applicableCapabilities
    .filter(capability => allowed.has(capability)
      && target.states.find(state => state.capability === capability)?.classification !== 'known')
    .map(capability => ({ entityId: target.targetRef.id, capability })));
}

/** Presentation-only compact category. Prediction never becomes measured knowledge. */
export function projectedWordStatus(projection: KnowledgeProjection | undefined): {
  status: 'known' | 'learning' | 'unknown'; basis: 'claim' | 'evidence' | 'unmeasured';
} {
  const overall = projection?.status === 'ready' ? projection.lexical?.overall : undefined;
  return {
    status: overall?.classification === 'known' || overall?.classification === 'learning' ? overall.classification : 'unknown',
    basis: overall?.basis === 'claim' || overall?.basis === 'evidence' ? overall.basis : 'unmeasured',
  };
}
