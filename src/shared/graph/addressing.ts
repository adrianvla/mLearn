import { eventCapability, type KnowledgeEvent } from '../knowledgeEvents';
import { relationsOf, type LingualGraph } from './load';
import { isSurfaceScopedCapability } from './targets';
import type { CapabilityKey, LearnableTarget } from './types';

/**
 * Graph-relative access addressing.
 *
 * Evidence addresses a directed learner access: a cue entity, the access
 * semantic (capability), and — for capabilities whose retrieval IS a lexical
 * identity — the retrieved entity. The journal stays append-only and keyed by
 * surface hash for compatibility; this module is the ONE place that decides
 * which learnable target a journaled event is evidence for.
 *
 * Transfer rules (deliberately conservative):
 * - Surface-scoped accesses (surface-recognition, surface-reading) match ONLY
 *   the exact presented surface. Variants never share them.
 * - Lexical-identity accesses (sense, spoken, production, prosody, gender)
 *   transfer across surfaces that realize the SAME authoritative entry —
 *   knowing 名字 by sound is knowing 苗字 by sound, because both realize one
 *   entry with one pronunciation.
 * - Shared pronunciation alone transfers NOTHING: 橋/箸/端 share はし but
 *   realize different entries, so their evidence stays independent. The entry
 *   equality is the firewall.
 * - A presented surface that realizes several entries (homograph kanji) only
 *   speaks for itself — the writer could not have meant one specific entry.
 * - An explicit `targetRef.to` (writer knew the retrieved identity) overrides
 *   derivation and transfers to every surface realizing that entry.
 * - Legacy flat events (no targetRef) keep the caller's key scoping: they
 *   match capability-only and never cross surfaces.
 */

/**
 * Capabilities whose retrieval is the lexical object itself in the
 * entry-qualified sense: evidence for them is ABOUT the entry, so it applies
 * anywhere the same entry is realized. (surface-recognition also retrieves a
 * lexical identity, but through one written surface — it stays exact.)
 */
export const ENTRY_LEVEL_CAPABILITIES: Record<string, true> = {
  'sense-recognition': true,
  'spoken-recognition': true,
  'pronunciation-production': true,
  'prosodic-pattern': true,
  'gender': true,
};

/**
 * Legacy flat-event routing (pre-access journals): a meaning event feeds both
 * meaning-visible capabilities — the one conflation the pre-access model
 * carried, preserved ONLY for old journals. New writers address precisely.
 */
const MEANING_CAPABILITIES: Record<string, true> = {
  'sense-recognition': true,
  'surface-recognition': true,
};

/**
 * Capability-only event matching: `targetRef.capability` routes to its exact
 * capability; legacy flat events route through the aspect projection.
 * Address-aware matching (graph-relative) builds on this — see
 * eventAppliesToTarget.
 */
export function eventAppliesToCapability(event: KnowledgeEvent, capability: CapabilityKey): boolean {
  if (event.targetRef?.capability !== undefined) return event.targetRef.capability === capability;
  const legacyCapability = eventCapability(event);
  if (legacyCapability === undefined) return false;
  if (legacyCapability === 'sense-recognition') return MEANING_CAPABILITIES[capability] === true;
  return legacyCapability === capability;
}

/** Resolved semantic endpoints of one evidence event. */
export interface EventAddress {
  /** Exact presented surface entity id, when the event was surface-cued. */
  surfaceId?: string;
  /** The cue entity itself for non-surface cues (character, morpheme, grammar…). */
  entityId?: string;
  /** Retrieved lexical identity (entry) for entry-level capabilities. */
  entryId?: string;
  /** True when the entry was stated by the writer (`targetRef.to`), not derived. */
  entryExplicit?: boolean;
}

/** Entry ids realized by a surface (`realizes`; resolves either endpoint orientation). */
export function realizedEntryIds(graph: LingualGraph, surfaceId: string): string[] {
  return [...new Set(relationsOf(graph, surfaceId)
    .filter((relation) => relation.type === 'realizes')
    .flatMap((relation): string[] => {
      const candidate = relation.from === surfaceId ? relation.to : relation.to === surfaceId ? relation.from : undefined;
      if (candidate === undefined) return [];
      // Only the dictionary-entry endpoint names the lexical identity.
      return graph.nodes.get(candidate)?.kind === 'dictionary-entry' ? [candidate] : [];
    }))];
}

/** Surface ids realizing an entry — the authoritative variant family. */
export function surfacesRealizingEntry(graph: LingualGraph, entryId: string): string[] {
  return relationsOf(graph, entryId, { direction: 'in' })
    .filter((relation) => relation.type === 'realizes')
    .map((relation) => relation.from);
}

/**
 * Entry ids whose lexical identity a target entity belongs to: a surface's
 * realized entries, a sense's owning entry, an entry itself. Characters,
 * pronunciations, and other entities belong to none.
 */
export function lexicalContextEntryIds(graph: LingualGraph, entityId: string): string[] {
  const entity = graph.nodes.get(entityId);
  if (!entity) return [];
  switch (entity.kind) {
    case 'surface':
      return realizedEntryIds(graph, entityId);
    case 'sense':
      return relationsOf(graph, entityId, { direction: 'in' })
        .filter((relation) => relation.type === 'has-sense')
        .map((relation) => relation.from);
    case 'dictionary-entry':
      return [entityId];
    default:
      return [];
  }
}

/**
 * Resolves an event's semantic address against the graph. Absent targetRef →
 * `{}` (legacy flat event; the caller's journal-key scoping is the address).
 */
export function resolveEventAddress(graph: LingualGraph, event: KnowledgeEvent): EventAddress {
  const ref = event.targetRef;
  if (!ref) return {};
  if (ref.kind === 'surface') {
    const address: EventAddress = { surfaceId: ref.id };
    if (ref.capability !== undefined && ENTRY_LEVEL_CAPABILITIES[ref.capability]) {
      if (ref.to !== undefined) {
        address.entryId = ref.to;
        address.entryExplicit = true;
      } else {
        const entries = realizedEntryIds(graph, ref.id);
        if (entries.length === 1) address.entryId = entries[0];
      }
    }
    return address;
  }
  return { entityId: ref.id, ...(ref.to !== undefined ? { entryId: ref.to, entryExplicit: true } : {}) };
}

/**
 * Whether one journaled event is evidence (or a claim) for one learnable
 * target. `queriedSurfaceId` is the projection root: an entry-ambiguous
 * presented surface speaks only for itself, never for siblings.
 *
 * The single authority for access matching — explanations, projections, and
 * inspectors must all route through this so claims cannot leak across
 * homophones or variant surfaces.
 */
export function eventAppliesToTarget(
  graph: LingualGraph,
  event: KnowledgeEvent,
  target: LearnableTarget,
  queriedSurfaceId: string,
): boolean {
  if (!eventAppliesToCapability(event, target.capability)) return false;
  const ref = event.targetRef;
  if (!ref) return true; // legacy flat event: capability routing only, caller scoped the key
  if (ENTRY_LEVEL_CAPABILITIES[target.capability]) {
    const context = lexicalContextEntryIds(graph, target.entityId);
    // No ontology entry means no transfer, but the exact authored surface
    // address still owns its evidence when a package drops that surface.
    if (context.length === 0) return ref.kind === 'surface' && ref.to === undefined
      && ref.id === target.entityId && ref.id === queriedSurfaceId;
    if (ref.to !== undefined) return context.includes(ref.to);
    if (ref.kind !== 'surface') return false;
    const entries = realizedEntryIds(graph, ref.id);
    if (!entries.some((entry) => context.includes(entry))) return false;
    // Unique shared entry → authoritative variant transfer. Ambiguous
    // homograph → only the surface the learner was actually presented.
    return entries.length === 1 || ref.id === queriedSurfaceId;
  }
  if (isSurfaceScopedCapability(target.capability)) {
    return ref.kind === 'surface' && ref.id === target.entityId;
  }
  return ref.id === target.entityId;
}

/**
 * Whether evidence about `fromSurfaceId` can speak for `toSurfaceId` through
 * the graph (used for sibling journal-key enumeration): true exactly when the
 * two surfaces share at least one realized entry and at least one side
 * resolves it uniquely. Pronunciation overlap alone never qualifies.
 */
export function sharesLexicalIdentity(graph: LingualGraph, fromSurfaceId: string, toSurfaceId: string): boolean {
  if (fromSurfaceId === toSurfaceId) return true;
  const from = realizedEntryIds(graph, fromSurfaceId);
  const to = realizedEntryIds(graph, toSurfaceId);
  return from.some((entry) => to.includes(entry)) && (from.length === 1 || to.length === 1);
}

/**
 * Legacy journal key for a surface entity id: `ja:surface:<hash>` →
 * `ja:<hash>`. Non-surface entity ids pass through unchanged (new
 * entity-keyed journals, when writers address them directly).
 */
export function journalKeyOfSurfaceEntity(entityId: string): string {
  const marker = ':surface:';
  const start = entityId.indexOf(marker);
  if (start <= 0) return entityId;
  const language = entityId.slice(0, start);
  const localId = entityId.slice(start + marker.length);
  return `${language}:${localId}`;
}

/**
 * Journal keys to consult for one surface's projection: its own key plus the
 * keys of every authoritative variant surface (unique shared entry). Events
 * resolved graph-relatively make sibling evidence visible without any state
 * copy.
 */
export function siblingJournalKeys(graph: LingualGraph, surfaceId: string): string[] {
  const keys = new Set<string>([journalKeyOfSurfaceEntity(surfaceId)]);
  const entries = realizedEntryIds(graph, surfaceId);
  if (entries.length !== 1) return [...keys]; // ambiguous homograph: no sibling keys
  for (const sibling of surfacesRealizingEntry(graph, entries[0])) {
    if (sibling !== surfaceId) keys.add(journalKeyOfSurfaceEntity(sibling));
  }
  return [...keys];
}
