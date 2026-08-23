import type { KnowledgeAspect } from '../constants';
import { relationsOf, type LingualGraph } from './load';
import {
  ASPECT_CAPABILITY,
  type CapabilityKind,
  type GraphEntity,
  type LearnableTarget,
  SURFACE_SCOPED_CAPABILITIES,
} from './types';

/**
 * Target applicability derives from the graph — never from global language
 * name conditionals. A capability exists for an entity only when the graph
 * actually carries the structure that would be learned.
 */
export function applicableCapabilities(graph: LingualGraph, entity: GraphEntity): CapabilityKind[] {
  const relationTypes = new Set(relationsOf(graph, entity.id).map((relation) => relation.type));
  switch (entity.kind) {
    case 'surface':
      return dedupe([
        'surface-recognition',
        ...(relationTypes.has('has-pronunciation') ? ['surface-reading' as const, 'pronunciation-production' as const] : []),
        ...(relationTypes.has('has-prosodic-pattern') ? ['prosodic-pattern' as const] : []),
      ]);
    case 'sense':
      return ['sense-recognition'];
    case 'lexeme':
      return relationTypes.has('has-gender') ? ['gender'] : [];
    case 'character':
      return relationTypes.has('has-reading') ? ['character-reading'] : [];
    case 'grammar-pattern':
      return entity.grammar
        ? ['grammar-recognition', 'grammar-comprehension', 'grammar-formation', 'grammar-production']
        : [];
    case 'dictionary-entry':
    case 'morpheme':
    case 'pronunciation':
      return [];
  }
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

/** Current user-facing aspect vocabulary resolved to its typed capability. */
export function capabilityForAspect(aspect: KnowledgeAspect): CapabilityKind {
  return ASPECT_CAPABILITY[aspect];
}

/** Surface-scoped aspects resolve on the presented form's own hash only — family unification must never apply to them. */
export function isSurfaceScopedAspect(aspect: KnowledgeAspect): boolean {
  return SURFACE_SCOPED_CAPABILITIES.includes(ASPECT_CAPABILITY[aspect]);
}

/**
 * Firewall for identity edges: recognizing 食べた must never establish
 * 食べる's surface-recognition or surface-reading. Identity relations may
 * only unify LEXEME-level capabilities (sense recognition, gender); every
 * surface-scoped capability stays bound to the exact presented surface.
 * The projection layer MUST consult this before sharing any state across
 * identityNeighbors().
 */
export function isIdentityShareableCapability(capability: CapabilityKind): boolean {
  return !SURFACE_SCOPED_CAPABILITIES.includes(capability);
}

function dedupe(values: readonly CapabilityKind[]): CapabilityKind[] {
  return [...new Set(values)];
}
