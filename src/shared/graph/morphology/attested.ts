import { relationsOf, type LingualGraph } from '../load';
import type { CompoundAnalysis, CompoundPart } from './compounds';

/** Depth guard when resolving nested component-of trees (cycles, builder bugs). */
const MAX_DEPTH = 8;

function partsFromGraph(graph: LingualGraph, compoundId: string, depth: number): CompoundPart[] | null {
  if (depth > MAX_DEPTH) return null;
  // component-of relations are a SET — the graph carries no part ordering.
  // Resolve nodes first, then sort by part label (ID tie-breaker) so analysis
  // output is deterministic regardless of asset insertion order.
  const components = relationsOf(graph, compoundId, { direction: 'in' })
    .filter((relation) => relation.type === 'component-of')
    .map((relation) => ({ relation, node: graph.nodes.get(relation.from) }));
  if (components.length < 2 || components.some((component) => !component.node?.label)) return null;
  components.sort((a, b) =>
    a.node!.label!.localeCompare(b.node!.label!) || a.relation.from.localeCompare(b.relation.from));
  const parts: CompoundPart[] = [];
  for (const { relation, node } of components) {
    const nested = partsFromGraph(graph, relation.from, depth + 1);
    parts.push({
      lemma: node!.label!,
      entryId: relation.from,
      attested: true,
      ...(nested ? { parts: nested } : {}),
    });
  }
  return parts;
}

/**
 * Graph-first decomposition: an ATTESTED compound's structure is read straight
 * from the Tier-2 graph's component-of relations — no guessing, no lexicon.
 * This is the primary representation; the runtime concatenative splitter only
 * ever fills in genuinely unseen/productive forms that the graph does not
 * describe. Parts keep their graph entity ids in `entryId`, so the analysis
 * stays grounded in graph identity rather than a parallel model.
 */
export function attestedCompoundAnalysis(graph: LingualGraph, surfaceId: string): CompoundAnalysis | null {
  const compound = graph.nodes.get(surfaceId);
  if (!compound || compound.kind !== 'surface' || !compound.label) return null;
  const parts = partsFromGraph(graph, surfaceId, 1);
  if (!parts) return null;
  const leaves: CompoundPart[] = [];
  const walk = (list: readonly CompoundPart[]): void => {
    for (const part of list) {
      if (part.parts) walk(part.parts);
      else leaves.push(part);
    }
  };
  walk(parts);
  return {
    form: compound.label,
    lemma: compound.label,
    source: 'attested',
    confidence: 1,
    provenance: { source: 'attested', confidence: 1, lexiconBasis: leaves.map((leaf) => leaf.entryId ?? leaf.lemma) },
    parts,
    ambiguous: false,
    alternatives: [],
  };
}
